import {
  BUILDINGS,
  DEFENSES,
  MINE_BASE_PER_HOUR,
  MINE_GROWTH,
  MOON_BUILDING_ORDER,
  MOON_FIELDS_BASE,
  MOON_FIELDS_PER_LUNAR_BASE,
  PLANET_BUILDING_ORDER,
  PRODUCTION_MULT,
  RESEARCH,
  SHIPS,
} from "./catalog.js";
import type {
  BuildingId,
  DefenseId,
  PlanetState,
  ResearchId,
  Resources,
  ShipId,
} from "./types.js";
import {
  productionMultForSlot,
  rollPlanetFields,
} from "./formulas-position.js";

export function isMoon(planet: PlanetState): boolean {
  return planet.kind === "moon";
}

export function buildingAllowedOn(
  planet: PlanetState,
  buildingId: BuildingId,
): boolean {
  const order = isMoon(planet) ? MOON_BUILDING_ORDER : PLANET_BUILDING_ORDER;
  return order.includes(buildingId);
}

export function fieldsCap(planet: PlanetState): number {
  if (isMoon(planet)) {
    const lunar = planet.buildings.lunarBase ?? 0;
    return MOON_FIELDS_BASE + lunar * MOON_FIELDS_PER_LUNAR_BASE;
  }
  if (typeof planet.fieldsCap === "number" && planet.fieldsCap > 0) {
    return planet.fieldsCap;
  }
  // Deterministic backfill for blobs missing fieldsCap.
  return rollPlanetFields(
    planet.coords.slot,
    `${planet.id}:${planet.coords.galaxy}:${planet.coords.system}:${planet.coords.slot}`,
  );
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

export function defenseCost(defenseId: DefenseId, count: number): Resources {
  const def = DEFENSES[defenseId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count,
  };
}

export function defenseBuildSeconds(
  defenseId: DefenseId,
  count: number,
  shipyardLevel: number,
): number {
  const def = DEFENSES[defenseId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  return Math.max(1, Math.ceil((def.buildSeconds * count) / speedFactor));
}

export function researchUpgradeCost(
  researchId: ResearchId,
  currentLevel: number,
): Resources {
  const def = RESEARCH[researchId];
  const factor = Math.pow(def.costGrowth, currentLevel);
  return {
    metal: Math.floor(def.baseCost.metal * factor),
    crystal: Math.floor(def.baseCost.crystal * factor),
    deuterium: Math.floor(def.baseCost.deuterium * factor),
  };
}

export function researchUpgradeSeconds(
  researchId: ResearchId,
  currentLevel: number,
  labLevel: number,
): number {
  const def = RESEARCH[researchId];
  const labFactor = 1 + Math.max(0, labLevel - 1) * 0.15;
  return Math.max(
    1,
    Math.floor(
      (def.baseResearchSeconds * Math.pow(def.costGrowth, currentLevel)) /
        labFactor,
    ),
  );
}

export function storageCap(level: number): number {
  // Level 0 still holds a starter pile; each vault level doubles capacity.
  return Math.floor(10_000 * Math.pow(2, level));
}

export function mineOutputPerHour(
  resource: keyof typeof MINE_BASE_PER_HOUR,
  level: number,
): number {
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
  const base = solarEnergy(planet.buildings.solarPlant ?? 0);
  const mult = productionMultForSlot(planet.coords.slot).energy;
  return Math.floor(base * mult);
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

export function fieldsUsed(planet: PlanetState): number {
  let used = 0;
  for (const level of Object.values(planet.buildings)) {
    used += level;
  }
  return used;
}

export function fieldsRemaining(planet: PlanetState): number {
  return Math.max(0, fieldsCap(planet) - fieldsUsed(planet));
}

export function productionPerHour(
  planet: PlanetState,
  universeSpeed = 1,
  energyTechLevel = 0,
): Resources {
  const factor = energyFactor(planet);
  const techBonus = 1 + energyTechLevel * 0.02;
  // universe.speed scales timers + income; PRODUCTION_MULT is income-only test tuning.
  const incomeScale = universeSpeed * PRODUCTION_MULT * techBonus;
  const pos = productionMultForSlot(planet.coords.slot);
  return {
    metal:
      mineOutputPerHour("metal", planet.buildings.metalMine ?? 0) *
      factor *
      incomeScale *
      pos.metal,
    crystal:
      mineOutputPerHour("crystal", planet.buildings.crystalMine ?? 0) *
      factor *
      incomeScale *
      pos.crystal,
    deuterium:
      mineOutputPerHour("deuterium", planet.buildings.deutSynth ?? 0) *
      factor *
      incomeScale *
      pos.deuterium,
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
