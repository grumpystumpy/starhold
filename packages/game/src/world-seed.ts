import { MAP_GALAXIES, MAP_SYSTEMS, PIRATE_TARGET_BASE_COUNT } from "./catalog.js";
import type { UniverseSeedCursor, UniverseState } from "./types.js";
import { seedAsteroidsInSystem } from "./world-asteroids.js";
import { seedMinisInSystem } from "./world-mini.js";
import { pirateRankKey, placePiratesFromRanked } from "./world-pirates.js";

/** Bump when pirateRankKey changes so unfinished cursors re-rank. */
export const PIRATE_RANK_VERSION = 2;

export interface SeedSliceLimits {
  systems: number;
  minis: number;
  pirates: number;
}

function cursorOf(universe: UniverseState): UniverseSeedCursor | null {
  const cursor = universe.seedCursor;
  if (!cursor || cursor.done) return null;
  return cursor;
}

/**
 * Continue a lazy universe bootstrap. Same asteroid, mini, and pirate
 * placement as a full seed, spread across requests.
 * Returns true when this call finished the system scan and the caller
 * should not also run the rest of the tick (that pair exceeds 10 ms CPU).
 */
export function continueUniverseSeed(
  universe: UniverseState,
  now: number,
  limits: SeedSliceLimits,
): boolean {
  const cursor = cursorOf(universe);
  if (!cursor) return false;
  const total = MAP_GALAXIES * MAP_SYSTEMS;
  const seed = universe.seed ?? universe.id;
  if (!cursor.ranks) cursor.ranks = [];

  let systems = 0;
  let minis = 0;
  let finishedScan = false;
  while (cursor.at < total && systems < limits.systems && minis < limits.minis) {
    const galaxy = Math.floor(cursor.at / MAP_SYSTEMS) + 1;
    const system = (cursor.at % MAP_SYSTEMS) + 1;
    const key = `${galaxy}:${system}`;
    if (cursor.visited?.[key]) {
      cursor.at += 1;
      if (cursor.at >= total) finishedScan = true;
      continue;
    }
    seedAsteroidsInSystem(universe, galaxy, system);
    minis += seedMinisInSystem(universe, galaxy, system, now);
    cursor.ranks.push({
      g: galaxy,
      s: system,
      k: pirateRankKey(seed, galaxy, system),
    });
    cursor.at += 1;
    systems += 1;
    if (cursor.at >= total) finishedScan = true;
  }

  if (cursor.at < total) return false;
  // The request that finishes the scan stops here. Sorting and placing
  // pirates on that same call blows the Workers CPU budget.
  if (finishedScan) return true;

  // CI-02: rank keys changed. Re-rank every unplaced row once with the
  // current key, whether or not the cursor was sorted under the old one.
  // Rows before rankAt were already placed or skipped and stay as they are.
  if (!cursor.sorted || cursor.rankVersion !== PIRATE_RANK_VERSION) {
    const from = cursor.sorted ? (cursor.rankAt ?? 0) : 0;
    const tail = cursor.ranks.slice(from);
    for (const row of tail) row.k = pirateRankKey(seed, row.g, row.s);
    tail.sort((a, b) => a.k - b.k || a.g - b.g || a.s - b.s);
    cursor.ranks.splice(from, tail.length, ...tail);
    cursor.sorted = true;
    cursor.rankVersion = PIRATE_RANK_VERSION;
  }
  const start = cursor.rankAt ?? 0;
  const ranked = cursor.ranks.slice(start).map((row) => ({
    key: row.k,
    galaxy: row.g,
    system: row.s,
  }));
  const { placed, scanned } = placePiratesFromRanked(
    universe,
    ranked,
    limits.pirates,
    now,
  );
  cursor.rankAt = start + scanned;
  cursor.pirates += placed;
  const living = Object.values(universe.pirateBases ?? {}).filter(
    (base) => base.destroyedAt == null,
  ).length;
  // A zero pirate budget must not finish the cursor; the next request places them.
  if (
    living >= PIRATE_TARGET_BASE_COUNT ||
    (limits.pirates > 0 && placed === 0)
  ) {
    cursor.done = true;
    delete cursor.ranks;
  }
  return false;
}

/**
 * Seed one system the moment a player joins there or opens it.
 * The background cursor skips systems recorded on `seedCursor.visited`.
 * Returns true when this call created the system.
 */
export function ensureSystemVisited(
  universe: UniverseState,
  galaxy: number,
  system: number,
  now: number,
): boolean {
  const cursor = universe.seedCursor;
  if (!cursor || cursor.done) return false;
  const g = Math.min(MAP_GALAXIES, Math.max(1, Math.floor(galaxy)));
  const s = Math.min(MAP_SYSTEMS, Math.max(1, Math.floor(system)));
  const key = `${g}:${s}`;
  const index = (g - 1) * MAP_SYSTEMS + (s - 1);
  if (!cursor.visited) cursor.visited = {};
  if (cursor.visited[key] || cursor.at > index) {
    cursor.visited[key] = 1;
    return false;
  }
  const seed = universe.seed ?? universe.id;
  seedAsteroidsInSystem(universe, g, s);
  seedMinisInSystem(universe, g, s, now);
  if (!cursor.ranks) cursor.ranks = [];
  cursor.ranks.push({
    g,
    s,
    k: pirateRankKey(seed, g, s),
  });
  cursor.visited[key] = 1;
  return true;
}
