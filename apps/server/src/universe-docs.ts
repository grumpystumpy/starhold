/**
 * D1 stores the universe as rows, not one blob.
 * A player action rewrites that player's document. Asteroids, pirates, and
 * aliens are their own rows. Resource stocks, `lastTickAt`, and `lastAiSimAt`
 * are left out of the revision, so a quiet poll can skip every write and the
 * next cold load recomputes accrual from the clocks.
 */
import type {
  CombatReport,
  ExpeditionReport,
  FleetMission,
  PlanetState,
  PlayerState,
  EspionageReport,
  UniverseState,
} from "@starhold/game";
import { addCpu } from "./request-context.js";

export interface PlayerSlice {
  player: PlayerState;
  planets: Record<string, PlanetState>;
  fleets: Record<string, FleetMission>;
  reports: Record<string, CombatReport>;
  spyReports: Record<string, EspionageReport>;
  expeditionReports: Record<string, ExpeditionReport>;
}

export interface SliceStamps {
  world: string;
  asteroids: string;
  pirates: string;
  aliens: string;
  players: Record<string, string>;
}

export interface UniverseParts {
  world: UniverseState;
  asteroids: NonNullable<UniverseState["asteroids"]>;
  pirates: NonNullable<UniverseState["pirateBases"]>;
  aliens: NonNullable<UniverseState["alienBases"]>;
  players: Record<string, PlayerSlice>;
}

interface Hasher {
  mix: (n: number) => void;
  mixStr: (text: string) => void;
  hex: () => string;
}

function hasher(): Hasher {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  const mix = (n: number) => {
    h1 = Math.imul(h1 ^ (n | 0), 16777619);
    h2 = Math.imul(h2 ^ ((n * 13) | 0), 2246822519);
  };
  const mixStr = (text: string) => {
    mix(text.length);
    for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
  };
  return {
    mix,
    mixStr,
    hex: () => (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16),
  };
}

const SKIP_KEYS = new Set(["resources", "lastTickAt", "lastAiSimAt"]);

function hashValue(value: unknown, key: string | undefined, h: Hasher): void {
  if (key && SKIP_KEYS.has(key)) return;
  if (value == null) {
    h.mix(0);
    return;
  }
  if (typeof value === "number") {
    h.mix(Number.isInteger(value) ? value : Math.round(value * 1000));
    return;
  }
  if (typeof value === "string") {
    h.mixStr(value);
    return;
  }
  if (typeof value === "boolean") {
    h.mix(value ? 1 : 0);
    return;
  }
  if (Array.isArray(value)) {
    h.mix(value.length);
    for (const item of value) hashValue(item, undefined, h);
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    h.mix(keys.length);
    for (const child of keys) {
      h.mixStr(child);
      hashValue(obj[child], child, h);
    }
  }
}

function hashOf(value: unknown): string {
  const h = hasher();
  hashValue(value, undefined, h);
  return h.hex();
}

function emptySlice(player: PlayerState): PlayerSlice {
  return {
    player,
    planets: {},
    fleets: {},
    reports: {},
    spyReports: {},
    expeditionReports: {},
  };
}

function playerIdOf(players: UniverseState["players"], id: string | null | undefined): string | null {
  if (!id || !players[id]) return null;
  return id;
}

/** Split a live universe into the rows D1 writes. Does not mutate `universe`. */
export function splitUniverse(universe: UniverseState): UniverseParts {
  const players: Record<string, PlayerSlice> = {};
  for (const player of Object.values(universe.players)) {
    players[player.id] = emptySlice(player);
  }

  const worldPlanets: Record<string, PlanetState> = {};
  for (const planet of Object.values(universe.planets)) {
    const owner = playerIdOf(universe.players, planet.ownerPlayerId);
    if (owner) players[owner]!.planets[planet.id] = planet;
    else worldPlanets[planet.id] = planet;
  }

  const worldFleets: Record<string, FleetMission> = {};
  for (const fleet of Object.values(universe.fleets ?? {})) {
    const owner = playerIdOf(universe.players, fleet.ownerPlayerId);
    if (owner) players[owner]!.fleets[fleet.id] = fleet;
    else worldFleets[fleet.id] = fleet;
  }

  const worldReports: Record<string, CombatReport> = {};
  for (const report of Object.values(universe.reports ?? {})) {
    const owner =
      playerIdOf(universe.players, report.attackerPlayerId) ??
      playerIdOf(universe.players, report.defenderPlayerId);
    if (owner) players[owner]!.reports[report.id] = report;
    else worldReports[report.id] = report;
  }

  const worldSpy: Record<string, EspionageReport> = {};
  for (const report of Object.values(universe.spyReports ?? {})) {
    const owner = playerIdOf(universe.players, report.spyPlayerId);
    if (owner) players[owner]!.spyReports[report.id] = report;
    else worldSpy[report.id] = report;
  }

  const worldExp: Record<string, ExpeditionReport> = {};
  for (const report of Object.values(universe.expeditionReports ?? {})) {
    const owner = playerIdOf(universe.players, report.playerId);
    if (owner) players[owner]!.expeditionReports[report.id] = report;
    else worldExp[report.id] = report;
  }

  const world: UniverseState = {
    ...universe,
    players: {},
    planets: worldPlanets,
    fleets: worldFleets,
    reports: worldReports,
    spyReports: worldSpy,
    expeditionReports: worldExp,
    asteroids: {},
    pirateBases: {},
    alienBases: {},
  };

  return {
    world,
    asteroids: universe.asteroids ?? {},
    pirates: universe.pirateBases ?? {},
    aliens: universe.alienBases ?? {},
    players,
  };
}

export function sliceStamps(universe: UniverseState): SliceStamps {
  const started = performance.now();
  try {
    const parts = splitUniverse(universe);
    const players: Record<string, string> = {};
    for (const [id, slice] of Object.entries(parts.players)) {
      players[id] = hashOf(slice);
    }
    return {
      world: hashOf(parts.world),
      asteroids: hashOf(parts.asteroids),
      pirates: hashOf(parts.pirates),
      aliens: hashOf(parts.aliens),
      players,
    };
  } finally {
    addCpu(performance.now() - started);
  }
}

export function stampsEqual(a: SliceStamps, b: SliceStamps): boolean {
  if (
    a.world !== b.world ||
    a.asteroids !== b.asteroids ||
    a.pirates !== b.pirates ||
    a.aliens !== b.aliens
  ) {
    return false;
  }
  const aIds = Object.keys(a.players);
  const bIds = Object.keys(b.players);
  if (aIds.length !== bIds.length) return false;
  for (const id of aIds) {
    if (a.players[id] !== b.players[id]) return false;
  }
  return true;
}

export function emptyStamps(): SliceStamps {
  return { world: "", asteroids: "", pirates: "", aliens: "", players: {} };
}

/** Structural fingerprint. Resource floats and `lastTickAt` do not affect it. */
export function structuralStamp(universe: UniverseState): string {
  const stamps = sliceStamps(universe);
  const h = hasher();
  h.mixStr(stamps.world);
  h.mixStr(stamps.asteroids);
  h.mixStr(stamps.pirates);
  h.mixStr(stamps.aliens);
  const ids = Object.keys(stamps.players).sort();
  h.mix(ids.length);
  for (const id of ids) {
    h.mixStr(id);
    h.mixStr(stamps.players[id] ?? "");
  }
  return h.hex();
}

export function assembleUniverse(
  world: UniverseState,
  asteroids: UniverseState["asteroids"],
  pirates: UniverseState["pirateBases"],
  aliens: UniverseState["alienBases"],
  slices: PlayerSlice[],
): UniverseState {
  const universe: UniverseState = {
    ...world,
    players: {},
    planets: { ...(world.planets ?? {}) },
    fleets: { ...(world.fleets ?? {}) },
    reports: { ...(world.reports ?? {}) },
    spyReports: { ...(world.spyReports ?? {}) },
    expeditionReports: { ...(world.expeditionReports ?? {}) },
    asteroids: asteroids ?? {},
    pirateBases: pirates ?? {},
    alienBases: aliens ?? {},
  };
  for (const slice of slices) {
    universe.players[slice.player.id] = slice.player;
    Object.assign(universe.planets, slice.planets);
    Object.assign(universe.fleets, slice.fleets);
    Object.assign(universe.reports, slice.reports);
    Object.assign(universe.spyReports, slice.spyReports);
    Object.assign(universe.expeditionReports, slice.expeditionReports);
  }
  return universe;
}

export function isUniverseDocumentKey(key: string): boolean {
  return /^starhold:universe:v\d+$/.test(key);
}
