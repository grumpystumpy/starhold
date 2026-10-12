import {
  BUILDINGS,
  MINE_BASE_PER_HOUR,
  MINE_GROWTH,
  SHIPS,
} from "./catalog.js";
import type {
  BuildingId,
  EconomySnapshot,
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
