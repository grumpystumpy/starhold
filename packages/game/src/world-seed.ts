import { MAP_GALAXIES, MAP_SYSTEMS, PIRATE_TARGET_BASE_COUNT } from "./catalog.js";
import type { UniverseSeedCursor, UniverseState } from "./types.js";
import { seedAsteroidsInSystem } from "./world-asteroids.js";
import { seedMinisInSystem } from "./world-mini.js";
import { pirateRankKey, placePiratesFromRanked } from "./world-pirates.js";

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

  if (!cursor.sorted) {
    cursor.ranks.sort(
      (a, b) => a.k - b.k || a.g - b.g || a.s - b.s,
    );
    cursor.sorted = true;
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
