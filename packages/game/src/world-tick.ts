import { SHIP_ORDER } from "./catalog.js";
import {
  batchUnitsProduced,
  clampToStorage,
  coordsKey,
  emptyDefenses,
  grantPlayerXp,
  productionPerHour,
  storageFor,
  xpForResearch,
} from "./formulas.js";
import type {
  Coordinates,
  DebrisField,
  DefenseQueueItem,
  FleetMission,
  FleetShips,
  PlanetState,
  PlayerState,
  Resources,
  ShipQueueItem,
  UniverseState,
} from "./types.js";

function advanceUnitQueue<T extends ShipQueueItem | DefenseQueueItem>(
  queue: T,
  now: number,
  onBatch: (n: number) => void,
): T | null {
  const unitSec = Math.max(1e-9, queue.unitSeconds);
  if (unitSec >= 1) {
    if (queue.completesAt > now) return queue;
    onBatch(queue.count);
    return null;
  }
  const progressAt =
    queue.progressAt ?? queue.completesAt - queue.count * unitSec * 1000;
  const elapsedSec = Math.max(0, (now - progressAt) / 1000);
  const batch = batchUnitsProduced(elapsedSec, unitSec, queue.count);
  if (batch <= 0) {
    return { ...queue, progressAt };
  }
  onBatch(batch);
  const remaining = queue.count - batch;
  if (remaining <= 0) return null;
  const leftoverSec = elapsedSec - batch * unitSec;
  const nextProgress = now - leftoverSec * 1000;
  return {
    ...queue,
    count: remaining,
    progressAt: nextProgress,
    completesAt: nextProgress + remaining * unitSec * 1000,
  };
}

/** Apply due queues + resource production up to `now` (tick-on-read). */
export function advancePlanet(
  planet: PlanetState,
  universeSpeed: number,
  now: number,
  energyTechLevel = 0,
  boosts?: { mineOutput?: number; energyOutput?: number },
  _owner?: PlayerState,
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
    // Buildings grant no XP (Micah amendment / Round 2 rebalance).
  }

  if (state.shipQueue) {
    const next = advanceUnitQueue(state.shipQueue, now, (n) => {
      const id = state.shipQueue!.shipId;
      state.ships[id] = (state.ships[id] ?? 0) + n;
    });
    state.shipQueue = next;
  }

  if (state.defenseQueue) {
    const next = advanceUnitQueue(state.defenseQueue, now, (n) => {
      const id = state.defenseQueue!.defenseId;
      state.defenses[id] = (state.defenses[id] ?? 0) + n;
    });
    state.defenseQueue = next;
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

/** Advance mothership in-flight drone production (sub-second batching). */
export function advanceFleetSwarmProduce(
  fleet: FleetMission,
  now: number,
): void {
  const job = fleet.swarmProduce;
  if (!job || job.remaining <= 0) {
    fleet.swarmProduce = null;
    return;
  }
  const unitSec = Math.max(1e-9, job.unitSeconds);
  const elapsedSec = Math.max(0, (now - job.progressAt) / 1000);
  let batch: number;
  if (unitSec < 1) {
    batch = batchUnitsProduced(elapsedSec, unitSec, job.remaining);
  } else if (elapsedSec >= unitSec * job.remaining) {
    batch = job.remaining;
  } else {
    batch = Math.floor(elapsedSec / unitSec);
  }
  if (batch <= 0) return;
  fleet.ships.swarmDrone = (fleet.ships.swarmDrone ?? 0) + batch;
  const remaining = job.remaining - batch;
  if (remaining <= 0) {
    fleet.swarmProduce = null;
    return;
  }
  const leftoverSec =
    unitSec < 1 ? elapsedSec - batch * unitSec : elapsedSec - batch * unitSec;
  fleet.swarmProduce = {
    remaining,
    unitSeconds: unitSec,
    progressAt: now - leftoverSec * 1000,
  };
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
  grantPlayerXp(player, xpForResearch(targetLevel));
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
