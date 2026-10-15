import { coordsKey } from "./formulas.js";
import type { Coordinates, PlanetState, UniverseState } from "./types.js";

/**
 * Coord → planet map for the hot path (galaxy view, pirate slot checks).
 * Rebuilt when the planet count changes. Call `notePlanetAdded` /
 * `notePlanetMoved` to keep it current without an O(n) rebuild.
 * Not serialized.
 */
interface CoordMaps {
  n: number;
  rev: number;
  planets: Map<string, PlanetState>;
  moons: Map<string, PlanetState>;
}

const coordRev = new WeakMap<UniverseState, number>();
const coordCache = new WeakMap<UniverseState, CoordMaps>();

export function invalidatePlanetIndex(universe: UniverseState): void {
  coordRev.set(universe, (coordRev.get(universe) ?? 0) + 1);
}

function buildMaps(universe: UniverseState, rev: number): CoordMaps {
  const planets = new Map<string, PlanetState>();
  const moons = new Map<string, PlanetState>();
  for (const planet of Object.values(universe.planets)) {
    const key = coordsKey(planet.coords);
    if (planet.kind === "moon") {
      if (!moons.has(key)) moons.set(key, planet);
    } else if (!planets.has(key)) {
      planets.set(key, planet);
    }
  }
  const built: CoordMaps = {
    n: Object.keys(universe.planets).length,
    rev,
    planets,
    moons,
  };
  coordCache.set(universe, built);
  return built;
}

function coordMaps(universe: UniverseState): CoordMaps {
  const rev = coordRev.get(universe) ?? 0;
  const n = Object.keys(universe.planets).length;
  const hit = coordCache.get(universe);
  if (hit && hit.rev === rev && hit.n === n) return hit;
  return buildMaps(universe, rev);
}

/** Keep the index in sync after `universe.planets[id] = planet` on a new id. */
export function notePlanetAdded(
  universe: UniverseState,
  planet: PlanetState,
): void {
  const maps = coordCache.get(universe);
  if (!maps) return;
  const rev = coordRev.get(universe) ?? 0;
  if (maps.rev !== rev) return;
  maps.n += 1;
  const key = coordsKey(planet.coords);
  if (planet.kind === "moon") {
    if (!maps.moons.has(key)) maps.moons.set(key, planet);
  } else if (!maps.planets.has(key)) {
    maps.planets.set(key, planet);
  }
}

/** Keep the index in sync after a planet changes coordinates in place. */
export function notePlanetMoved(
  universe: UniverseState,
  planet: PlanetState,
  prev: Coordinates,
): void {
  const maps = coordCache.get(universe);
  if (!maps) return;
  const prevKey = coordsKey(prev);
  if (maps.planets.get(prevKey)?.id === planet.id) maps.planets.delete(prevKey);
  if (maps.moons.get(prevKey)?.id === planet.id) maps.moons.delete(prevKey);
  const key = coordsKey(planet.coords);
  if (planet.kind === "moon") maps.moons.set(key, planet);
  else maps.planets.set(key, planet);
}

export function planetAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PlanetState | null {
  return coordMaps(universe).planets.get(coordsKey(coords)) ?? null;
}

export function moonAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PlanetState | null {
  return coordMaps(universe).moons.get(coordsKey(coords)) ?? null;
}
