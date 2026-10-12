import {
  BUILDINGS,
  MINE_BASE_PER_HOUR,
  MINE_GROWTH,
  MIN_FLIGHT_SECONDS,
  RAID_LOOT_SHARE,
  SHIPS,
} from "./catalog.js";
import type {
  BuildingId,
  CombatOutcome,
  Coordinates,
  EconomySnapshot,
  FleetShips,
  PlanetState,
  Resources,
  ShipId,
} from "./types.js";

function powGrowth(base: number, growth: number, level: number): number {
  if (level <= 0) return 0;
  return base * Math.pow(growth, level - 1);
}

/** Cost to go from `currentLevel` → `currentLevel + 1`. */
export function buildingUpgradeCost(
  buildingId: BuildingId,
  currentLevel: number,
): Resources {
  const def = BUILDINGS[buildingId];
  const factor = Math.pow(def.costGrowth, currentLevel);
  return {
    metal: Math.floor(def.baseCost.metal * factor),
    crystal: Math.floor(def.baseCost.crystal * factor),
    deuterium: Math.floor(def.baseCost.deuterium * factor),
  };
}

/** Build duration in seconds for the next level (before universe speed). */
export function buildingUpgradeSeconds(
  buildingId: BuildingId,
  currentLevel: number,
): number {
  const def = BUILDINGS[buildingId];
  return Math.max(
    1,
    Math.floor(def.baseBuildSeconds * Math.pow(def.costGrowth, currentLevel)),
  );
}

export function shipCost(shipId: ShipId, count: number): Resources {
  const def = SHIPS[shipId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count,
  };
}

export function shipBuildSeconds(
  shipId: ShipId,
  count: number,
  shipyardLevel: number,
): number {
  const def = SHIPS[shipId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  return Math.max(1, Math.ceil((def.buildSeconds * count) / speedFactor));
}

export function storageCap(level: number): number {
  // Level 0 still holds a starter pile; each vault level doubles capacity.
  return Math.floor(10_000 * Math.pow(2, level));
}

export function mineOutputPerHour(resource: keyof typeof MINE_BASE_PER_HOUR, level: number): number {
  if (level <= 0) return 0;
  return Math.floor(
    MINE_BASE_PER_HOUR[resource] * level * Math.pow(MINE_GROWTH, level),
  );
}

export function solarEnergy(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(20 * level * Math.pow(1.1, level));
}

export function energyUsed(planet: PlanetState): number {
  let used = 0;
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.energyUsePerLevel) continue;
    const level = planet.buildings[id as BuildingId] ?? 0;
    used += def.energyUsePerLevel * level;
  }
  return used;
}

export function energyProduced(planet: PlanetState): number {
  return solarEnergy(planet.buildings.solarPlant ?? 0);
}

/** 0..1 production multiplier from energy surplus/shortfall. */
export function energyFactor(planet: PlanetState): number {
  const used = energyUsed(planet);
  if (used <= 0) return 1;
  const produced = energyProduced(planet);
  return Math.min(1, produced / used);
}

export function storageFor(planet: PlanetState): Resources {
  return {
    metal: storageCap(planet.buildings.metalStorage ?? 0),
    crystal: storageCap(planet.buildings.crystalStorage ?? 0),
    deuterium: storageCap(planet.buildings.deutTank ?? 0),
  };
}

export function productionPerHour(
  planet: PlanetState,
  universeSpeed = 1,
): Resources {
  const factor = energyFactor(planet);
  return {
    metal:
      mineOutputPerHour("metal", planet.buildings.metalMine ?? 0) *
      factor *
      universeSpeed,
    crystal:
      mineOutputPerHour("crystal", planet.buildings.crystalMine ?? 0) *
      factor *
      universeSpeed,
    deuterium:
      mineOutputPerHour("deuterium", planet.buildings.deutSynth ?? 0) *
      factor *
      universeSpeed,
  };
}

export function canAfford(have: Resources, cost: Resources): boolean {
  // Compare whole units so spend matches floored UI stocks.
  return (
    Math.floor(have.metal) >= cost.metal &&
    Math.floor(have.crystal) >= cost.crystal &&
    Math.floor(have.deuterium) >= cost.deuterium
  );
}

export function spend(have: Resources, cost: Resources): Resources {
  // Deduct from the live (possibly fractional) accumulator.
  return {
    metal: have.metal - cost.metal,
    crystal: have.crystal - cost.crystal,
    deuterium: have.deuterium - cost.deuterium,
  };
}

export function clampToStorage(resources: Resources, caps: Resources): Resources {
  return {
    metal: Math.min(resources.metal, caps.metal),
    crystal: Math.min(resources.crystal, caps.crystal),
    deuterium: Math.min(resources.deuterium, caps.deuterium),
  };
}

export function roughPoints(planet: PlanetState): number {
  let points = 0;
  for (const [id, level] of Object.entries(planet.buildings)) {
    for (let L = 0; L < level; L++) {
      const c = buildingUpgradeCost(id as BuildingId, L);
      points += (c.metal + c.crystal + c.deuterium) / 1000;
    }
  }
  for (const [id, count] of Object.entries(planet.ships)) {
    const c = SHIPS[id as ShipId].cost;
    points += ((c.metal + c.crystal + c.deuterium) * count) / 1000;
  }
  return Math.floor(points);
}

export function economySnapshot(
  planet: PlanetState,
  universeSpeed = 1,
): EconomySnapshot {
  return {
    productionPerHour: productionPerHour(planet, universeSpeed),
    energy: {
      produced: energyProduced(planet),
      used: energyUsed(planet),
      factor: energyFactor(planet),
    },
    storage: storageFor(planet),
  };
}

export function emptyFleetShips(): FleetShips {
  return { scout: 0, hauler: 0, interceptor: 0 };
}

export function normalizeFleetShips(ships: Partial<FleetShips>): FleetShips {
  return {
    scout: Math.max(0, Math.floor(ships.scout ?? 0)),
    hauler: Math.max(0, Math.floor(ships.hauler ?? 0)),
    interceptor: Math.max(0, Math.floor(ships.interceptor ?? 0)),
  };
}

export function fleetShipCount(ships: FleetShips): number {
  return ships.scout + ships.hauler + ships.interceptor;
}

export function fleetCargoCapacity(ships: FleetShips): number {
  let cap = 0;
  for (const id of Object.keys(SHIPS) as ShipId[]) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}

/**
 * Map distance in abstract units.
 * Formula: |Δgalaxy|×100 + |Δsystem|×10 + |Δslot|
 */
export function coordDistance(a: Coordinates, b: Coordinates): number {
  return (
    Math.abs(a.galaxy - b.galaxy) * 100 +
    Math.abs(a.system - b.system) * 10 +
    Math.abs(a.slot - b.slot)
  );
}

/** Slowest hull in the fleet sets cruise speed (empty fleet → 1). */
export function fleetCruiseSpeed(ships: FleetShips): number {
  let min = Infinity;
  for (const id of Object.keys(SHIPS) as ShipId[]) {
    const n = ships[id] ?? 0;
    if (n > 0) min = Math.min(min, SHIPS[id].speed);
  }
  return Number.isFinite(min) ? min : 1;
}

/**
 * One-way flight seconds.
 * time ≈ max(MIN, ceil(distance × 1_000_000 / (cruiseSpeed × fleetSpeed)))
 * fleetSpeed mirrors universe economy speed in the prototype (8×).
 */
export function flightSecondsOneWay(
  origin: Coordinates,
  target: Coordinates,
  ships: FleetShips,
  fleetSpeed: number,
): number {
  const distance = Math.max(1, coordDistance(origin, target));
  const cruise = fleetCruiseSpeed(ships);
  const raw = Math.ceil((distance * 1_000_000) / (cruise * Math.max(0.1, fleetSpeed)));
  return Math.max(MIN_FLIGHT_SECONDS, raw);
}

/** Deuterium fuel for one-way leg. */
export function fuelCostOneWay(
  origin: Coordinates,
  target: Coordinates,
  ships: FleetShips,
): number {
  const distance = Math.max(1, coordDistance(origin, target));
  let fuel = 0;
  for (const id of Object.keys(SHIPS) as ShipId[]) {
    fuel += (ships[id] ?? 0) * SHIPS[id].fuelPerDistance * distance;
  }
  return Math.max(1, Math.ceil(fuel));
}

/**
 * Combat power score (invented):
 * power = Σ count × (attack + 0.5×shield + 0.3×hull)
 */
export function fleetCombatPower(ships: FleetShips): number {
  let power = 0;
  for (const id of Object.keys(SHIPS) as ShipId[]) {
    const n = ships[id] ?? 0;
    if (n <= 0) continue;
    const d = SHIPS[id];
    power += n * (d.attack + 0.5 * d.shield + 0.3 * d.hull);
  }
  return power;
}

function scaleFleet(ships: FleetShips, keepRatio: number): FleetShips {
  const ratio = Math.min(1, Math.max(0, keepRatio));
  return {
    scout: Math.floor((ships.scout ?? 0) * ratio),
    hauler: Math.floor((ships.hauler ?? 0) * ratio),
    interceptor: Math.floor((ships.interceptor ?? 0) * ratio),
  };
}

export interface CombatResolution {
  outcome: CombatOutcome;
  attackerAfter: FleetShips;
  defenderAfter: FleetShips;
  summary: string;
}

/**
 * Deterministic raid resolution (basics-first):
 * - If attacker power ≥ defender × 1.1 → attacker win (defender keeps 30%, attacker 80%)
 * - If defender power ≥ attacker × 1.1 → defender win (attacker keeps 30%, defender 80%)
 * - Else draw (both keep 60%)
 * Empty defender hangar still allows an attacker win (garrison absent).
 */
export function resolveCombat(
  attacker: FleetShips,
  defender: FleetShips,
): CombatResolution {
  const atk = fleetCombatPower(attacker);
  const def = fleetCombatPower(defender);

  if (def <= 0 && atk > 0) {
    return {
      outcome: "attacker_win",
      attackerAfter: { ...attacker },
      defenderAfter: emptyFleetShips(),
      summary: `Unopposed landing (atk ${atk.toFixed(0)}). Hangar empty.`,
    };
  }

  if (atk >= def * 1.1) {
    return {
      outcome: "attacker_win",
      attackerAfter: scaleFleet(attacker, 0.8),
      defenderAfter: scaleFleet(defender, 0.3),
      summary: `Attacker breakthrough (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
    };
  }

  if (def >= atk * 1.1) {
    return {
      outcome: "defender_win",
      attackerAfter: scaleFleet(attacker, 0.3),
      defenderAfter: scaleFleet(defender, 0.8),
      summary: `Defenders held (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
    };
  }

  return {
    outcome: "draw",
    attackerAfter: scaleFleet(attacker, 0.6),
    defenderAfter: scaleFleet(defender, 0.6),
    summary: `Inconclusive clash (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
  };
}

/**
 * Loot on attacker win: RAID_LOOT_SHARE of each resource, capped by surviving cargo.
 * Priority fill: metal → crystal → deuterium.
 */
export function computeRaidLoot(
  defenderResources: Resources,
  survivingAttacker: FleetShips,
): Resources {
  const capacity = fleetCargoCapacity(survivingAttacker);
  if (capacity <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }

  const available = {
    metal: Math.floor(Math.floor(defenderResources.metal) * RAID_LOOT_SHARE),
    crystal: Math.floor(Math.floor(defenderResources.crystal) * RAID_LOOT_SHARE),
    deuterium: Math.floor(
      Math.floor(defenderResources.deuterium) * RAID_LOOT_SHARE,
    ),
  };

  let remaining = capacity;
  const loot: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  for (const key of ["metal", "crystal", "deuterium"] as const) {
    const take = Math.min(available[key], remaining);
    loot[key] = take;
    remaining -= take;
  }
  return loot;
}
