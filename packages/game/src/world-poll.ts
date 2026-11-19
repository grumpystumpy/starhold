import { MAP_SLOTS } from "./catalog.js";
import { planetAtCoords, moonAtCoords } from "./planet-index.js";
import type {
  PlanetState,
  Resources,
  StatePollSection,
  UniverseState,
} from "./types.js";
import { advancePlanetNow } from "./world-arrival.js";
import { getDebris } from "./world-tick.js";

/**
 * Which heavy slices this poll must build. A missing flag means leave that
 * slice out. A full read (no `page` query) uses {@link FULL_STATE_POLL_INCLUDE}.
 */
export interface StatePollInclude {
  galaxy?: boolean;
  messages?: boolean;
  highscores?: boolean;
  roster?: boolean;
  shop?: boolean;
  alliances?: boolean;
}

export const FULL_STATE_POLL_INCLUDE: StatePollInclude = {
  galaxy: true,
  messages: true,
  highscores: true,
  roster: true,
  shop: true,
  alliances: true,
};

const SECTION_FLAG: Record<StatePollSection, keyof StatePollInclude> = {
  galaxy: "galaxy",
  messages: "messages",
  highscores: "highscores",
  roster: "roster",
  shop: "shop",
  alliances: "alliances",
};

/** Pages that need a slice the overview poll leaves out. */
export function statePollIncludeForPage(page: string): StatePollInclude {
  switch (page) {
    case "messages":
    case "seasons":
      return { messages: true };
    case "galaxy":
      return { galaxy: true };
    case "fleet":
      return { galaxy: true, roster: true };
    case "highscore":
      return { highscores: true, roster: true };
    case "shop":
      return { shop: true };
    case "alliances":
      return { alliances: true };
    default:
      return {};
  }
}

export function omittedStateSections(include: StatePollInclude): StatePollSection[] {
  const omitted: StatePollSection[] = [];
  const sections = Object.keys(SECTION_FLAG) as StatePollSection[];
  for (const section of sections) {
    const flag = SECTION_FLAG[section];
    if (include[flag] !== true) omitted.push(section);
  }
  return omitted;
}

/**
 * Advance mine output for this commander's worlds and return the active
 * stock. Does not build a player view. Structural queues are untouched
 * when `playerStateTickDue` is false.
 */
export function refreshOwnedPlanetResources(
  universe: UniverseState,
  playerId: string,
  now: number,
): Resources | null {
  const player = universe.players[playerId];
  if (!player) return null;
  const ids = new Set<string>();
  for (const id of player.planetIds ?? []) {
    if (id) ids.add(id);
  }
  if (player.homePlanetId) ids.add(player.homePlanetId);
  if (player.activePlanetId) ids.add(player.activePlanetId);
  for (const id of ids) advancePlanetNow(universe, id, now);
  const activeId = player.activePlanetId || player.homePlanetId;
  const planet =
    (activeId ? universe.planets[activeId] : undefined) ??
    universe.planets[player.homePlanetId];
  if (!planet) return null;
  return { ...planet.resources };
}

function fnv(): { mix: (n: number) => void; mixStr: (text: unknown) => void; hex: () => string } {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  const mix = (n: number) => {
    h1 = Math.imul(h1 ^ (n | 0), 16777619);
    h2 = Math.imul(h2 ^ ((Math.floor(n) * 13) | 0), 2246822519);
  };
  const mixStr = (text: unknown) => {
    const value = text == null ? "" : String(text);
    mix(value.length);
    for (let i = 0; i < value.length; i++) mix(value.charCodeAt(i));
  };
  return {
    mix,
    mixStr,
    hex: () => (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16),
  };
}

function planetStamp(planet: PlanetState): string {
  const { resources: _resources, lastTickAt: _lastTickAt, ...rest } = planet;
  return JSON.stringify(rest);
}

/**
 * Fingerprint of this commander's view, excluding resource stocks and the
 * clock. Cheap enough to compare with `If-None-Match` before `playerView`.
 */
export function playerPollRevision(
  universe: UniverseState,
  playerId: string,
  now: number,
  include: StatePollInclude,
  galaxy?: number,
  system?: number,
): string {
  const { mix, mixStr, hex } = fnv();
  const player = universe.players[playerId];
  if (!player) return "missing";
  mix(Math.floor(now / 86_400_000));
  mix(include.galaxy ? 1 : 0);
  mix(include.messages ? 1 : 0);
  mix(include.highscores ? 1 : 0);
  mix(include.roster ? 1 : 0);
  mix(include.shop ? 1 : 0);
  mix(include.alliances ? 1 : 0);

  const { eventLog, ...playerRest } = player;
  mixStr(JSON.stringify(playerRest));
  for (const entry of eventLog ?? []) {
    mixStr(entry.id);
    mix(entry.createdAt);
    mix(entry.readAt ?? 0);
    mixStr(entry.kind);
  }

  const owned = new Set<string>();
  for (const id of player.planetIds ?? []) {
    if (id) owned.add(id);
  }
  if (player.homePlanetId) owned.add(player.homePlanetId);
  if (player.activePlanetId) owned.add(player.activePlanetId);
  for (const id of owned) {
    const planet = universe.planets[id];
    if (!planet) continue;
    mixStr(planetStamp(planet));
  }

  for (const fleet of Object.values(universe.fleets ?? {})) {
    const involved =
      fleet.ownerPlayerId === playerId ||
      fleet.targetPlayerId === playerId ||
      (fleet.targetPlanetId != null && owned.has(fleet.targetPlanetId));
    if (!involved) continue;
    mixStr(fleet.id);
    mixStr(fleet.mission);
    mixStr(fleet.phase);
    mix(fleet.arrivesAt);
    mixStr(fleet.reportId ?? "");
    mixStr(fleet.acsGroupId ?? "");
    mixStr(JSON.stringify(fleet.ships ?? {}));
  }

  const hidden = new Set(player.hiddenReportIds ?? []);
  for (const report of Object.values(universe.reports ?? {})) {
    const involved =
      report.attackerPlayerId === playerId ||
      report.defenderPlayerId === playerId ||
      report.acsParticipantIds?.includes(playerId) === true;
    if (!involved || hidden.has(report.id)) continue;
    mixStr(report.id);
    mix(report.at);
    mixStr(report.outcome);
  }
  for (const report of Object.values(universe.spyReports ?? {})) {
    if (report.spyPlayerId !== playerId) continue;
    mixStr(report.id);
    mix(report.at);
  }
  for (const report of Object.values(universe.expeditionReports ?? {})) {
    if (report.playerId !== playerId) continue;
    mixStr(report.id);
    mix(report.at);
  }

  for (const [planetId, occupation] of Object.entries(universe.occupations ?? {})) {
    const ownerId = universe.planets[planetId]?.ownerPlayerId;
    if (occupation.occupierPlayerId !== playerId && ownerId !== playerId) continue;
    mixStr(planetId);
    mixStr(occupation.occupierPlayerId);
    mix(occupation.endsAt);
  }

  if (player.allianceId) {
    for (const group of Object.values(universe.acsGroups ?? {})) {
      if (group.allianceId !== player.allianceId) continue;
      mixStr(group.id);
      mixStr(group.status);
      mix(group.joinClosesAt);
      mix(group.fleetIds.length);
    }
    const alliance = universe.alliances?.[player.allianceId];
    if (alliance && (include.alliances || include.galaxy)) {
      const chat = alliance.chat ?? [];
      const last = chat[chat.length - 1];
      mixStr(alliance.name);
      mixStr(alliance.tag);
      mixStr(alliance.joinMode);
      mix(Object.keys(alliance.members).length);
      mix(chat.length);
      mixStr(last?.id ?? "");
      mix(last?.createdAt ?? 0);
      mix((alliance.pendingRequests ?? []).length);
      for (const stamp of alliance.intel ?? []) {
        mixStr(stamp.id);
        mix(stamp.createdAt);
        mix(stamp.expiresAt ?? 0);
      }
      for (const marker of alliance.markers ?? []) {
        if (
          include.galaxy &&
          !include.alliances &&
          (marker.coords.galaxy !== (galaxy ?? marker.coords.galaxy) ||
            marker.coords.system !== (system ?? marker.coords.system))
        ) {
          continue;
        }
        mixStr(marker.id);
        mix(marker.coords.galaxy);
        mix(marker.coords.system);
        mix(marker.coords.slot);
        mixStr(marker.note);
        mix(marker.createdAt);
      }
    }
  }

  mixStr(universe.pirateBossBaseId ?? "");
  mix(universe.pirateBossActiveUntil ?? 0);
  mix(universe.pirateBossNextSpawnAt ?? 0);
  mix(universe.seedCursor?.done ? 1 : 0);

  if (include.galaxy) {
    const home =
      universe.planets[player.activePlanetId] ??
      universe.planets[player.homePlanetId];
    const g = galaxy ?? home?.coords.galaxy ?? 1;
    const s = system ?? home?.coords.system ?? 1;
    mix(g);
    mix(s);
    for (let slot = 1; slot <= MAP_SLOTS; slot++) {
      const coords = { galaxy: g, system: s, slot };
      const body = planetAtCoords(universe, coords);
      const moon = moonAtCoords(universe, coords);
      mixStr(body?.id ?? "");
      mixStr(body?.ownerPlayerId ?? "");
      mixStr(body?.name ?? "");
      mixStr(moon?.id ?? "");
      const debris = getDebris(universe, coords);
      mix(Math.floor(debris?.metal ?? 0));
      mix(Math.floor(debris?.crystal ?? 0));
    }
    for (const base of Object.values(universe.pirateBases ?? {})) {
      if (base.destroyedAt != null) continue;
      if (base.coords.galaxy !== g || base.coords.system !== s) continue;
      mixStr(base.id);
      mix(base.level ?? 0);
    }
    for (const base of Object.values(universe.alienBases ?? {})) {
      if (base.destroyedAt != null) continue;
      if (base.coords.galaxy !== g || base.coords.system !== s) continue;
      mixStr(base.id);
      mix(base.level ?? 0);
    }
  }

  return hex();
}
