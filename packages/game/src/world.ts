import { BUILDINGS, SHIPS, STARTING_RESOURCES } from "./catalog.js";
import {
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  clampToStorage,
  economySnapshot,
  productionPerHour,
  roughPoints,
  shipBuildSeconds,
  shipCost,
  spend,
  storageFor,
} from "./formulas.js";
import type {
  BuildingId,
  PlanetState,
  PlayerState,
  PlayerView,
  PublicPlayer,
  ShipId,
  UniverseState,
} from "./types.js";

function emptyBuildings(): PlanetState["buildings"] {
  return {
    metalMine: 0,
    crystalMine: 0,
    deutSynth: 0,
    solarPlant: 0,
    metalStorage: 0,
    crystalStorage: 0,
    deutTank: 0,
    shipyard: 0,
  };
}

function emptyShips(): PlanetState["ships"] {
  return { scout: 0, hauler: 0, interceptor: 0 };
}

export function createUniverse(name = "Alpha Drift", speed = 1): UniverseState {
  const now = Date.now();
  return {
    id: `uni_${now.toString(36)}`,
    name,
    speed,
    createdAt: now,
    players: {},
    planets: {},
  };
}

function nextCoords(universe: UniverseState): PlanetState["coords"] {
  const used = new Set(
    Object.values(universe.planets).map(
      (p) => `${p.coords.galaxy}:${p.coords.system}:${p.coords.slot}`,
    ),
  );
  // Small starter map: galaxy 1, systems 1–5, slots 1–8 — room for multiplayer later.
  for (let system = 1; system <= 5; system++) {
    for (let slot = 1; slot <= 8; slot++) {
      const key = `1:${system}:${slot}`;
      if (!used.has(key)) {
        return { galaxy: 1, system, slot };
      }
    }
  }
  throw new Error("Universe planet slots are full (prototype map).");
}

export function joinUniverse(
  universe: UniverseState,
  playerName: string,
  now = Date.now(),
): { player: PlayerState; planet: PlanetState } {
  const trimmed = playerName.trim().slice(0, 24);
  if (!trimmed) {
    throw new Error("Commander name is required.");
  }
  const existing = Object.values(universe.players).find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) {
    const planet = universe.planets[existing.homePlanetId];
    if (!planet) throw new Error("Player home planet missing.");
    return { player: existing, planet };
  }

  const playerId = `plyr_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const planetId = `plnt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const coords = nextCoords(universe);

  const planet: PlanetState = {
    id: planetId,
    name: `${trimmed}'s Outpost`,
    coords,
    resources: { ...STARTING_RESOURCES },
    lastTickAt: now,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    buildQueue: null,
    shipQueue: null,
  };

  // Gentle kickstart so first upgrades feel reachable without a long wait.
  planet.buildings.metalMine = 1;
  planet.buildings.crystalMine = 1;
  planet.buildings.solarPlant = 1;

  const player: PlayerState = {
    id: playerId,
    name: trimmed,
    homePlanetId: planetId,
    createdAt: now,
  };

  universe.players[playerId] = player;
  universe.planets[planetId] = planet;
  return { player, planet };
}

/** Apply due queues + resource production up to `now` (tick-on-read). */
export function advancePlanet(
  planet: PlanetState,
  universeSpeed: number,
  now: number,
): PlanetState {
  let state = { ...planet, resources: { ...planet.resources }, buildings: { ...planet.buildings }, ships: { ...planet.ships } };

  // Complete building queue if due.
  if (state.buildQueue && state.buildQueue.completesAt <= now) {
    const { buildingId, targetLevel } = state.buildQueue;
    state.buildings[buildingId] = targetLevel;
    state.buildQueue = null;
  }

  // Complete ship queue if due.
  if (state.shipQueue && state.shipQueue.completesAt <= now) {
    const { shipId, count } = state.shipQueue;
    state.ships[shipId] = (state.ships[shipId] ?? 0) + count;
    state.shipQueue = null;
  }

  const elapsedMs = Math.max(0, now - state.lastTickAt);
  if (elapsedMs > 0) {
    const rates = productionPerHour(state, universeSpeed);
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
    // Keep displayed stockpiles stable; production still accrues via lastTickAt.
    state.resources = {
      metal: Math.floor(state.resources.metal),
      crystal: Math.floor(state.resources.crystal),
      deuterium: Math.floor(state.resources.deuterium),
    };
    state.lastTickAt = now;
  }

  return state;
}

export function advanceUniverse(universe: UniverseState, now = Date.now()): void {
  for (const id of Object.keys(universe.planets)) {
    universe.planets[id] = advancePlanet(
      universe.planets[id],
      universe.speed,
      now,
    );
  }
}

export type ActionResult =
  | { ok: true; planet: PlanetState }
  | { ok: false; error: string };

export function queueBuildingUpgrade(
  universe: UniverseState,
  playerId: string,
  buildingId: BuildingId,
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!BUILDINGS[buildingId]) return { ok: false, error: "Unknown building." };

  advanceUniverse(universe, now);
  const planet = universe.planets[player.homePlanetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.buildQueue) {
    return { ok: false, error: "A building is already under construction." };
  }

  const current = planet.buildings[buildingId] ?? 0;
  const cost = buildingUpgradeCost(buildingId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const seconds = Math.max(
    1,
    Math.ceil(buildingUpgradeSeconds(buildingId, current) / universe.speed),
  );

  planet.resources = spend(planet.resources, cost);
  planet.buildQueue = {
    kind: "building",
    buildingId,
    targetLevel: current + 1,
    completesAt: now + seconds * 1000,
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

export function queueShipBuild(
  universe: UniverseState,
  playerId: string,
  shipId: ShipId,
  count: number,
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = SHIPS[shipId];
  if (!def) return { ok: false, error: "Unknown ship." };
  const qty = Math.floor(count);
  if (qty < 1 || qty > 50) {
    return { ok: false, error: "Build between 1 and 50 ships at a time." };
  }

  advanceUniverse(universe, now);
  const planet = universe.planets[player.homePlanetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.shipQueue) {
    return { ok: false, error: "Shipyard is already busy." };
  }

  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`,
    };
  }

  const cost = shipCost(shipId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const seconds = Math.max(
    1,
    Math.ceil(shipBuildSeconds(shipId, qty, yard) / universe.speed),
  );

  planet.resources = spend(planet.resources, cost);
  planet.shipQueue = {
    kind: "ship",
    shipId,
    count: qty,
    completesAt: now + seconds * 1000,
    unitSeconds: Math.ceil(seconds / qty),
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

function publicRoster(universe: UniverseState): PublicPlayer[] {
  return Object.values(universe.players).map((p) => {
    const planet = universe.planets[p.homePlanetId];
    return {
      id: p.id,
      name: p.name,
      coords: planet?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      pointsHint: planet ? roughPoints(planet) : 0,
    };
  });
}

export function playerView(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): PlayerView {
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) throw new Error("Unknown player.");
  const planet = universe.planets[player.homePlanetId];
  if (!planet) throw new Error("Planet missing.");

  return {
    now,
    universe: {
      id: universe.id,
      name: universe.name,
      speed: universe.speed,
    },
    player,
    planet,
    economy: economySnapshot(planet, universe.speed),
    roster: publicRoster(universe),
  };
}
