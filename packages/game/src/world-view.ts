import {
  DEEP_SPACE_SLOT,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  OFFICER_ORDER,
  OFFICERS,
  SKILL_ORDER,
  SKILLS,
  STARSHARDS_HIGHSCORE_TOP3,
} from "./catalog.js";
import {
  classBonuses,
  empireExpeditionCap,
  economySnapshot,
  empirePoints,
  levelBonuses,
  maxExpeditions,
  maxFleetSlots,
  planetPoints,
  playerProgressView,
} from "./formulas.js";
import {
  artForBody,
  createPlanetArtContext,
  isMiniBody,
  normalArtAt,
  type PlanetArtContext,
} from "./planet-art.js";
import type {
  GalaxyMiniBody,
  GalaxySlot,
  GalaxyView,
  HighscoreEntry,
  PlanetArtFields,
  PlayerView,
  PublicPlayer,
  UniverseState,
} from "./types.js";
import {
  allianceDirectory,
  allianceTagForPlayer,
  allianceViewFor,
} from "./world-alliances.js";
import { galaxyMarkerOverlay } from "./world-alliance-intel.js";
import { listOpenAcsForAlliance } from "./world-acs.js";
import { advanceUniverse } from "./world-arrival.js";
import { asteroidsInSystem } from "./world-asteroids.js";
import {
  canClaimDailyLogin,
  grantStarshards,
  playerBoosts,
  pruneExpiredOfficers,
} from "./world-boosts.js";
import {
  activePlanet,
  ensureUniverseShape,
  moonAtCoords,
  planetAtCoords,
} from "./world-bootstrap.js";
import { stampQueueView } from "./world-queue-manage.js";
import { inSensorPhalanxRange, ownedPlanetCount } from "./world-moons.js";
import { goalsView } from "./world-goals.js";
import { occupationForPlanet } from "./world-occupation.js";
import { empireDriftBeaconExpeditionBonus, playerKnowsMini } from "./world-mini.js";
import { seasonLeaderboardView } from "./world-seasons.js";
import { getDebris } from "./world-tick.js";

export { empirePoints };

function artFields(
  universe: UniverseState,
  planet: UniverseState["planets"][string] | undefined,
  ctx: PlanetArtContext,
): PlanetArtFields {
  if (planet) return artForBody(universe, planet, ctx);
  return normalArtAt({ galaxy: 1, system: 1, slot: 8 });
}

export function highscoresBoard(universe: UniverseState): HighscoreEntry[] {
  const artCtx = createPlanetArtContext(universe);
  const rows = Object.values(universe.players).map((p) => {
    const home = universe.planets[p.homePlanetId];
    return {
      playerId: p.id,
      name: p.name,
      points: empirePoints(universe, p),
      coords: home?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      planetCount: ownedPlanetCount(universe, p.id),
      planetName: home?.name ?? "",
      homePlanetId: p.homePlanetId,
      level: p.level ?? 1,
      xpTotal: p.xpTotal ?? 0,
      allianceTag: allianceTagForPlayer(universe, p),
      ...artFields(universe, home, artCtx),
    };
  });
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.level - a.level ||
      b.xpTotal - a.xpTotal ||
      a.playerId.localeCompare(b.playerId),
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function publicRoster(
  universe: UniverseState,
  pointsById?: ReadonlyMap<string, number>,
): PublicPlayer[] {
  const artCtx = createPlanetArtContext(universe);
  return Object.values(universe.players).map((p) => {
    const planet = universe.planets[p.homePlanetId];
    return {
      id: p.id,
      name: p.name,
      coords: planet?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      pointsHint: pointsById?.get(p.id) ?? empirePoints(universe, p),
      planetId: p.homePlanetId,
      planetName: planet?.name ?? "",
      allianceTag: allianceTagForPlayer(universe, p),
      ...artFields(universe, planet, artCtx),
    };
  });
}

export function galaxyViewFor(
  universe: UniverseState,
  playerId: string,
  galaxy: number,
  system: number,
  now = Date.now(),
): GalaxyView {
  ensureUniverseShape(universe);
  const g = Math.min(MAP_GALAXIES, Math.max(1, Math.floor(galaxy)));
  const s = Math.min(MAP_SYSTEMS, Math.max(1, Math.floor(system)));
  const artCtx = createPlanetArtContext(universe);
  const slots: GalaxySlot[] = [];
  for (let slot = 1; slot <= MAP_SLOTS; slot++) {
    const coords = { galaxy: g, system: s, slot };
    const planet = planetAtCoords(universe, coords);
    const moon = moonAtCoords(universe, coords);
    const debris = getDebris(universe, coords);
    const owner = planet
      ? universe.players[planet.ownerPlayerId]
      : undefined;
    const art = planet
      ? artForBody(universe, planet, artCtx)
      : normalArtAt(coords);
    slots.push({
      coords,
      planetId: planet?.id ?? null,
      playerId: owner?.id ?? null,
      playerName: owner?.name ?? null,
      allianceTag: allianceTagForPlayer(universe, owner),
      pointsHint: planet ? Math.floor(planetPoints(planet)) : 0,
      debris: debris
        ? { metal: debris.metal, crystal: debris.crystal }
        : null,
      isOwn: owner?.id === playerId,
      hasMoon: Boolean(moon),
      moonId: moon?.id ?? null,
      isMini: planet ? isMiniBody(universe, planet) : false,
      activity: planet ? "planet" : "empty",
      ...art,
    });
  }

  const minis: GalaxyMiniBody[] = [];
  for (const planet of Object.values(universe.planets)) {
    if (!isMiniBody(universe, planet)) continue;
    if (planet.coords.galaxy !== g || planet.coords.system !== s) continue;
    if (planet.coords.slot >= 1 && planet.coords.slot <= MAP_SLOTS) continue;
    if (!playerKnowsMini(universe, playerId, planet.id, now)) continue;
    const owner = planet.ownerPlayerId
      ? universe.players[planet.ownerPlayerId]
      : undefined;
    const debris = getDebris(universe, planet.coords);
    const art = artForBody(universe, planet, artCtx);
    minis.push({
      planetId: planet.id,
      name: planet.name,
      coords: planet.coords,
      isOwn: planet.ownerPlayerId === playerId,
      playerName: owner?.name ?? (planet.ownerPlayerId ? null : "Unclaimed"),
      debris: debris
        ? { metal: debris.metal, crystal: debris.crystal }
        : null,
      ...art,
    });
  }
  minis.sort(
    (a, b) => a.coords.slot - b.coords.slot || a.planetId.localeCompare(b.planetId),
  );

  const pirate = Object.values(universe.pirateBases ?? {}).find(
    (b) =>
      b.destroyedAt == null &&
      b.coords.galaxy === g &&
      b.coords.system === s,
  );
  if (pirate) {
    const slot = slots.find((row) => row.coords.slot === pirate.coords.slot);
    if (slot && slot.activity === "empty") {
      slot.activity = "pirate";
    }
  }

  const alien = Object.values(universe.alienBases ?? {}).find(
    (b) =>
      b.destroyedAt == null &&
      b.coords.galaxy === g &&
      b.coords.system === s,
  );
  if (alien) {
    const slot = slots.find((row) => row.coords.slot === alien.coords.slot);
    if (slot && (slot.activity === "empty" || slot.activity == null)) {
      slot.activity = "alien";
    }
  }

  const pirateLevel = pirate ? (pirate.level ?? pirate.tier) : 0;
  const alienLevel = alien ? (alien.level ?? alien.tier) : 0;

  const markerOverlay = galaxyMarkerOverlay(universe, playerId, g, s, now);
  for (const slot of slots) {
    slot.allianceMarker = markerOverlay.get(slot.coords.slot) ?? null;
  }

  return {
    galaxy: g,
    system: s,
    slots,
    minis,
    deepSpace: { coords: { galaxy: g, system: s, slot: DEEP_SPACE_SLOT } },
    asteroids: asteroidsInSystem(universe, g, s),
    pirateBase: pirate
      ? {
          id: pirate.id,
          coords: pirate.coords,
          name: pirate.name,
          tier: pirate.tier,
          level: pirateLevel,
          threatHint:
            pirateLevel >= 50 ? "high" : pirateLevel >= 15 ? "medium" : "low",
        }
      : null,
    alienBase: alien
      ? {
          id: alien.id,
          coords: alien.coords,
          name: alien.name,
          tier: alien.tier,
          level: alienLevel,
          threatHint:
            alienLevel >= 50 ? "high" : alienLevel >= 15 ? "medium" : "low",
          active: Date.now() >= (alien.buildupEndsAt ?? 0),
        }
      : null,
  };
}

/** Once-only +50 Starshards the first time a player reaches top 3 (needs rivals). */
function maybeGrantHighscoreStarshards(
  universe: UniverseState,
  playerId: string,
  board: HighscoreEntry[],
): void {
  const player = universe.players[playerId];
  if (!player || player.highscoreStarshardsClaimed) return;
  if (Object.keys(universe.players).length < 2) return;
  const row = board.find((e) => e.playerId === playerId);
  if (!row || row.rank > 3) return;
  player.highscoreStarshardsClaimed = true;
  grantStarshards(player, STARSHARDS_HIGHSCORE_TOP3);
  universe.players[player.id] = player;
}

export function playerView(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
  galaxy?: number,
  system?: number,
): PlayerView {
  advanceUniverse(universe, now);
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) throw new Error("Unknown player.");
  pruneExpiredOfficers(player, now);
  const highscores = highscoresBoard(universe);
  maybeGrantHighscoreStarshards(universe, playerId, highscores);
  const pointsById = new Map(
    highscores.map((row) => [row.playerId, row.points]),
  );
  const planet = activePlanet(universe, player);
  if (!planet) throw new Error("Planet missing.");
  stampQueueView(player, planet, now);
  universe.planets[planet.id] = planet;
  universe.players[player.id] = player;
  const boosts = playerBoosts(player, now);
  const cls = classBonuses(player.playerClass?.classId);
  const fleetSlotCap =
    maxFleetSlots(player.research.computerTech ?? 0) +
    boosts.fleetSlots +
    cls.fleetSlots;
  const expeditionSlotCap =
    empireExpeditionCap(player, maxExpeditions) +
    empireDriftBeaconExpeditionBonus(universe, player.id);

  const fleets = Object.values(universe.fleets)
    .filter((f) => f.ownerPlayerId === playerId)
    .sort((a, b) => a.arrivesAt - b.arrivesAt);

  const hiddenReports = new Set(player.hiddenReportIds ?? []);
  const reports = Object.values(universe.reports)
    .filter(
      (r) =>
        (r.attackerPlayerId === playerId || r.defenderPlayerId === playerId) &&
        !hiddenReports.has(r.id),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const spyReports = Object.values(universe.spyReports)
    .filter((r) => r.spyPlayerId === playerId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const expeditionReports = Object.values(universe.expeditionReports ?? {})
    .filter((r) => r.playerId === playerId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const g = galaxy ?? planet.coords.galaxy;
  const s = system ?? planet.coords.system;
  const artCtx = createPlanetArtContext(universe);
  const planetArt = artForBody(universe, planet, artCtx);

  const sensorLevel = planet.buildings.sensorArray ?? 0;
  const sensorContacts =
    planet.kind === "moon" && sensorLevel >= 1
      ? Object.values(universe.fleets)
          .filter(
            (f) =>
              f.phase === "outbound" &&
              inSensorPhalanxRange(planet.coords, f.targetCoords, sensorLevel),
          )
          .sort((a, b) => a.arrivesAt - b.arrivesAt)
          .slice(0, 20)
      : [];

  // Hostile inbound to owned worlds — suppressed for Moving Fortress targets.
  const hostileInbound = Object.values(universe.fleets)
    .filter((f) => {
      if (f.ownerPlayerId === playerId) return false;
      if (f.phase !== "outbound") return false;
      if (f.targetPlayerId !== playerId) return false;
      const mission = f.mission;
      if (mission !== "raid" && mission !== "espionage") {
        return false;
      }
      const target = f.targetPlanetId
        ? universe.planets[f.targetPlanetId]
        : null;
      if (target?.flags?.mini && target.flags.miniKind === "fortress") {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.arrivesAt - b.arrivesAt)
    .slice(0, 20);

  return {
    now,
    universe: {
      id: universe.id,
      name: universe.name,
      speed: universe.speed,
      fleetSpeed: universe.fleetSpeed,
    },
    player,
    planet,
    planetArt,
    ownedPlanets: player.planetIds
      .map((id) => {
        const p = universe.planets[id];
        if (!p) return null;
        const art = artForBody(universe, p, artCtx);
        return {
          id: p.id,
          name: p.name,
          coords: p.coords,
          isHome: p.id === player.homePlanetId,
          isActive: p.id === player.activePlanetId,
          isMoon: p.kind === "moon",
          isMini: isMiniBody(universe, p),
          jumpGateLevel: p.buildings.jumpGate ?? 0,
          researchLab: p.buildings.researchLab ?? 0,
          ...art,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    economy: economySnapshot(
      planet,
      universe.speed,
      player.research.energyTech ?? 0,
      {
        mineOutput:
          levelBonuses(player.level ?? 1).production *
          boosts.mineOutput *
          classBonuses(player.playerClass?.classId).mineOutput,
        energyOutput: boosts.energyOutput,
      },
    ),
    roster: publicRoster(universe, pointsById),
    highscores,
    galaxy: galaxyViewFor(universe, playerId, g, s, now),
    fleets,
    fleetSlotCap,
    expeditionSlotCap,
    reports,
    spyReports,
    expeditionReports,
    sensorContacts,
    hostileInbound,
    starshards: player.starshards ?? 0,
    officers: player.officers ?? [],
    skillsUnlocked: player.skillsUnlocked ?? [],
    skillLevels: { ...(player.skillLevels ?? {}) },
    officerLevels: { ...(player.officerLevels ?? {}) },
    officerCatalog: OFFICER_ORDER.map((id) => OFFICERS[id]),
    skillCatalog: SKILL_ORDER.map((id) => SKILLS[id]),
    dailyLoginAvailable: canClaimDailyLogin(player, now),
    progress: playerProgressView(player),
    occupation: occupationForPlanet(universe, planet.id, now),
    alliance: allianceViewFor(universe, playerId, now),
    allianceDirectory: allianceDirectory(universe),
    openAcsGroups: listOpenAcsForAlliance(universe, player.allianceId),
    goals: goalsView(player, now),
    seasonLeaderboard: seasonLeaderboardView(universe, player, now),
  };
}
