import { BUILDINGS, DEFENSES, RESEARCH, SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  clampToStorage,
  coordsKey,
  emptyDefenses,
  grantPlayerXp,
  productionPerHour,
  storageFor,
  xpForResearch,
} from "./formulas.js";
import {
  batchUnitsProduced,
} from "./formulas.js";
import type {
  Coordinates,
  DebrisField,
  DefenseQueueItem,
  EventLogEntry,
  FleetMission,
  FleetShips,
  PlanetState,
  PlayerState,
  Resources,
  ShipQueueItem,
  UniverseState,
} from "./types.js";
import { formatEventCount, pushEventLog } from "./world-event-log.js";
import { ensureQueueFrontStarted } from "./world-queue-normalize.js";

const MIN_UNIT_SECONDS = 1e-9;

function scalePaidCost(
  cost: Resources,
  remain: number,
  before: number,
): Resources {
  if (before <= 0) return { metal: 0, crystal: 0, deuterium: 0 };
  const ratio = Math.max(0, Math.min(1, remain / before));
  return {
    metal: Math.floor(cost.metal * ratio),
    crystal: Math.floor(cost.crystal * ratio),
    deuterium: Math.floor(cost.deuterium * ratio),
  };
}

/**
 * Ship / defense queues: when unit time is under 1s, deliver
 * `batch = floor(elapsed / unitTime)` units per tick (Micah amendment).
 * Never floors at 1s/unit.
 */
function advanceCountableQueue<T extends ShipQueueItem | DefenseQueueItem>(
  queue: T[],
  now: number,
  deliver: (item: T, batch: number) => void,
  onFinished?: (item: T, finishedCount: number) => void,
): void {
  ensureQueueFrontStarted(queue, now);
  while (queue.length > 0) {
    const front = queue[0]!;
    if (front.startedAt == null) break;
    const unit = Math.max(MIN_UNIT_SECONDS, front.unitSeconds);
    const elapsedSec = Math.max(0, (now - front.startedAt) / 1000);
    // completesAt is authoritative for finishing the remaining count (avoids float floor-to-0).
    let batch =
      front.completesAt <= now
        ? front.count
        : Math.floor(elapsedSec / unit + 1e-12);
    if (batch < 1) break;
    batch = Math.min(batch, front.count);
    const before = front.count;
    deliver(front, batch);
    front.count -= batch;
    front.paidCost = scalePaidCost(front.paidCost, front.count, before);
    if (front.count <= 0) {
      onFinished?.(front, before);
      const freedAt = Math.min(now, front.completesAt);
      queue.shift();
      ensureQueueFrontStarted(queue, now, freedAt);
      continue;
    }
    front.startedAt = front.startedAt + batch * unit * 1000;
    front.workSeconds = front.count * unit;
    front.completesAt = front.startedAt + front.workSeconds * 1000;
  }
}

/** Buildings share the same timer path: complete every front item whose completesAt <= now (may be many per tick when times are sub-second). */
function advanceBuildingQueue(
  queue: PlanetState["buildQueue"],
  now: number,
  apply: (item: PlanetState["buildQueue"][number]) => void,
): void {
  ensureQueueFrontStarted(queue, now);
  while (
    queue.length > 0 &&
    queue[0]!.startedAt != null &&
    queue[0]!.completesAt <= now
  ) {
    const freedAt = queue[0]!.completesAt;
    apply(queue[0]!);
    queue.shift();
    ensureQueueFrontStarted(queue, now, freedAt);
  }
}

/** Apply due queues + resource production up to `now` (tick-on-read). */
export function advancePlanet(
  planet: PlanetState,
  universeSpeed: number,
  now: number,
  energyTechLevel = 0,
  boosts?: { mineOutput?: number; energyOutput?: number },
  owner?: PlayerState,
): PlanetState {
  let state = {
    ...planet,
    resources: { ...planet.resources },
    buildings: { ...planet.buildings },
    ships: { ...planet.ships },
    defenses: { ...(planet.defenses ?? emptyDefenses()) },
    buildQueue: [...(planet.buildQueue ?? [])],
    shipQueue: [...(planet.shipQueue ?? [])],
    defenseQueue: [...(planet.defenseQueue ?? [])],
  };

  // Buildings grant no XP (Micah amendment / Round 2 rebalance).
  advanceBuildingQueue(state.buildQueue, now, (item) => {
    state.buildings[item.buildingId] = item.targetLevel;
    noteBuildComplete(
      owner,
      `${BUILDINGS[item.buildingId].name} → level ${formatEventCount(item.targetLevel)}`,
      `Finished on ${state.name}.`,
      item.completesAt,
      {
        buildingId: item.buildingId,
        targetLevel: item.targetLevel,
        planetId: state.id,
      },
    );
  });

  advanceCountableQueue(
    state.shipQueue,
    now,
    (item, batch) => {
      state.ships[item.shipId] = (state.ships[item.shipId] ?? 0) + batch;
    },
    (item, finished) => {
      noteBuildComplete(
        owner,
        `${SHIPS[item.shipId].name} × ${formatEventCount(finished)}`,
        `Shipyard finished on ${state.name}.`,
        item.completesAt,
        { shipId: item.shipId, count: finished, planetId: state.id },
      );
    },
  );

  advanceCountableQueue(
    state.defenseQueue,
    now,
    (item, batch) => {
      state.defenses[item.defenseId] =
        (state.defenses[item.defenseId] ?? 0) + batch;
    },
    (item, finished) => {
      noteBuildComplete(
        owner,
        `${DEFENSES[item.defenseId].name} × ${formatEventCount(finished)}`,
        `Shipyard finished on ${state.name}.`,
        item.completesAt,
        { defenseId: item.defenseId, count: finished, planetId: state.id },
      );
    },
  );

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
  const leftoverSec = elapsedSec - batch * unitSec;
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
  if (!player.researchQueue) player.researchQueue = [];
  ensureQueueFrontStarted(player.researchQueue, now);
  while (
    player.researchQueue.length > 0 &&
    player.researchQueue[0]!.startedAt != null &&
    player.researchQueue[0]!.completesAt <= now
  ) {
    const freedAt = player.researchQueue[0]!.completesAt;
    const { researchId, targetLevel } = player.researchQueue[0]!;
    player.research[researchId] = targetLevel;
    player.researchQueue.shift();
    grantPlayerXp(player, xpForResearch(targetLevel));
    pushEventLog(player, {
      kind: "buildComplete",
      createdAt: freedAt,
      title: `${RESEARCH[researchId].name} → level ${formatEventCount(targetLevel)}`,
      body: "Research finished.",
      meta: { researchId, targetLevel },
    });
    ensureQueueFrontStarted(player.researchQueue, now, freedAt);
  }
  universe.players[player.id] = player;
}

function noteBuildComplete(
  owner: PlayerState | undefined,
  title: string,
  body: string,
  createdAt: number,
  meta: EventLogEntry["meta"],
): void {
  if (!owner) return;
  pushEventLog(owner, {
    kind: "buildComplete",
    title,
    body,
    createdAt,
    meta,
  });
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
