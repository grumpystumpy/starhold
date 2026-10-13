import { SHIP_ORDER } from "./catalog.js";
import {
  clampToStorage,
  coordsKey,
  emptyDefenses,
  productionPerHour,
  storageFor,
} from "./formulas.js";
import type {
  Coordinates,
  DebrisField,
  FleetShips,
  PlanetState,
  PlayerState,
  Resources,
  UniverseState,
} from "./types.js";

/** Apply due queues + resource production up to `now` (tick-on-read). */
export function advancePlanet(
  planet: PlanetState,
  universeSpeed: number,
  now: number,
  energyTechLevel = 0,
  boosts?: { mineOutput?: number; energyOutput?: number },
): PlanetState {
  let state = {
    ...planet,
    resources: { ...planet.resources },
    buildings: { ...planet.buildings },
    ships: { ...planet.ships },
    defenses: { ...(planet.defenses ?? emptyDefenses()) },
  };

  if (state.buildQueue && state.buildQueue.completesAt <= now) {
    const { buildingId, targetLevel } = state.buildQueue;
    state.buildings[buildingId] = targetLevel;
    state.buildQueue = null;
  }

  if (state.shipQueue && state.shipQueue.completesAt <= now) {
    const { shipId, count } = state.shipQueue;
    state.ships[shipId] = (state.ships[shipId] ?? 0) + count;
    state.shipQueue = null;
  }

  if (state.defenseQueue && state.defenseQueue.completesAt <= now) {
    const { defenseId, count } = state.defenseQueue;
    state.defenses[defenseId] = (state.defenses[defenseId] ?? 0) + count;
    state.defenseQueue = null;
  }

  const elapsedMs = Math.max(0, now - state.lastTickAt);
  if (elapsedMs > 0) {
    const rates = productionPerHour(
      state,
      universeSpeed,
      energyTechLevel,
      boosts,
    );
    const hours = elapsedMs / 3_600_000;
    const caps = storageFor(state);
    state.resources = clampToStorage(
      {
        metal: state.resources.metal + rates.metal * hours,
        crystal: state.resources.crystal + rates.crystal * hours,
        deuterium: state.resources.deuterium + rates.deuterium * hours,
      },
      caps,
    );
    state.lastTickAt = now;
  }

  return state;
}

export function advanceResearch(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): void {
  if (!player.researchQueue || player.researchQueue.completesAt > now) return;
  const { researchId, targetLevel } = player.researchQueue;
  player.research[researchId] = targetLevel;
  player.researchQueue = null;
  universe.players[player.id] = player;
}

export function addShipsToPlanet(planet: PlanetState, ships: FleetShips): void {
  for (const id of SHIP_ORDER) {
    planet.ships[id] = (planet.ships[id] ?? 0) + (ships[id] ?? 0);
  }
}

export function addCargoToPlanet(planet: PlanetState, cargo: Resources): void {
  const caps = storageFor(planet);
  planet.resources = clampToStorage(
    {
      metal: planet.resources.metal + cargo.metal,
      crystal: planet.resources.crystal + cargo.crystal,
      deuterium: planet.resources.deuterium + cargo.deuterium,
    },
    caps,
  );
}

export function subtractCargo(planet: PlanetState, cargo: Resources): void {
  planet.resources = {
    metal: Math.max(0, planet.resources.metal - cargo.metal),
    crystal: Math.max(0, planet.resources.crystal - cargo.crystal),
    deuterium: Math.max(0, planet.resources.deuterium - cargo.deuterium),
  };
}

export function addDebris(universe: UniverseState, coords: Coordinates, add: Resources): void {
  const key = coordsKey(coords);
  const existing = universe.debris[key];
  if (!existing) {
    if (add.metal <= 0 && add.crystal <= 0) return;
    universe.debris[key] = {
      coords: { ...coords },
      metal: add.metal,
      crystal: add.crystal,
    };
    return;
  }
  existing.metal += add.metal;
  existing.crystal += add.crystal;
  if (existing.metal <= 0 && existing.crystal <= 0) {
    delete universe.debris[key];
  }
}

export function getDebris(
  universe: UniverseState,
  coords: Coordinates,
): DebrisField | null {
  return universe.debris[coordsKey(coords)] ?? null;
}
