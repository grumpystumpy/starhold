import {
  ANOMALY_FORGE_SHIP_TIME_PER,
  BUILDINGS,
  DEFENSES,
  ENERGY_TECH_ENERGY_PER_LEVEL,
  ECHO_VAULT_STORAGE_PER,
  MANTLE_LOOM_FIELDS_USED,
  MINE_BASE_PER_HOUR,
  MINE_GROWTH,
  MINI_BUILDING_ORDER,
  MINI_IRONWATER_DEUT_MULT,
  MINI_RICH_MINE_MULT,
  MOON_BUILDING_ORDER,
  MOON_FIELDS_BASE,
  MOON_FIELDS_PER_LUNAR_BASE,
  PLANET_BUILDING_ORDER,
  PRODUCTION_MULT,
  RESEARCH,
  RIFT_SIPHON_MINE_PER,
  SHIPS,
  STORAGE_CAP_BASE,
  STORAGE_CAP_MULT,
} from "./catalog.js";
import type {
  BuildingId,
  DefenseId,
  PlanetState,
  ResearchId,
  ResearchLevels,
  Resources,
  ShipId,
} from "./types.js";
import {
  productionMultForSlot,
  rollPlanetFields,
} from "./formulas-position.js";
import {
  gridStakeEnergyMult,
  helioBuoyEnergy,
  mantleLoomFieldsBonus,
  rigFoundryTimeFactor,
  solarTempFactor,
  veinAnchorMineMult,
} from "./formulas-round3.js";
import { BASE_INCOME_PER_HOUR } from "./data/tuning.js";

export function isMoon(planet: PlanetState): boolean {
  return planet.kind === "moon";
}

export function isMiniBody(planet: PlanetState): boolean {
  return Boolean(planet.flags?.mini);
}

export function buildingAllowedOn(
  planet: PlanetState,
  buildingId: BuildingId,
): boolean {
  if (isMiniBody(planet)) return MINI_BUILDING_ORDER.includes(buildingId);
  const order = isMoon(planet) ? MOON_BUILDING_ORDER : PLANET_BUILDING_ORDER;
  return order.includes(buildingId);
}

/** Rift Siphon mine-output multiplier (mini special). */
export function riftSiphonMineMult(planet: PlanetState): number {
  const level = Math.min(5, Math.max(0, planet.buildings.riftSiphon ?? 0));
  return 1 + RIFT_SIPHON_MINE_PER * level;
}

/** Echo Vault storage multiplier (mini special). */
export function echoVaultStorageMult(planet: PlanetState): number {
  const level = Math.min(5, Math.max(0, planet.buildings.echoVault ?? 0));
  return 1 + ECHO_VAULT_STORAGE_PER * level;
}

/** Anomaly Forge ship-build time factor (mini special). */
export function anomalyForgeShipTimeFactor(planet: PlanetState): number {
  const level = Math.min(5, Math.max(0, planet.buildings.anomalyForge ?? 0));
  return Math.max(0.2, 1 - ANOMALY_FORGE_SHIP_TIME_PER * level);
}

export function fieldsCap(planet: PlanetState): number {
  if (isMoon(planet)) {
    const lunar = planet.buildings.lunarBase ?? 0;
    const extra =
      typeof planet.fieldsCap === "number" && planet.fieldsCap > MOON_FIELDS_BASE
        ? planet.fieldsCap - MOON_FIELDS_BASE
        : 0;
    return MOON_FIELDS_BASE + lunar * MOON_FIELDS_PER_LUNAR_BASE + extra;
  }
  let rolled =
    typeof planet.fieldsCap === "number" && planet.fieldsCap > 0
      ? planet.fieldsCap
      : rollPlanetFields(
          planet.coords.slot,
          `${planet.id}:${planet.coords.galaxy}:${planet.coords.system}:${planet.coords.slot}`,
        );
  return rolled + mantleLoomFieldsBonus(planet);
}

/** Read-time field cap. Never written back onto planet.fieldsCap. */
export interface FieldCapMods {
  homePlanetId?: string | null;
  colonyFields?: number;
  colonyFieldMult?: number;
}

export function effectiveFieldsCap(
  planet: PlanetState,
  mods?: FieldCapMods,
): number {
  const base = fieldsCap(planet);
  if (isMoon(planet)) return base;
  const home = mods?.homePlanetId;
  if (!home || planet.id === home) return base;
  const withClass = base + (mods?.colonyFields ?? 0);
  const mult = mods?.colonyFieldMult ?? 1;
  if (mult === 1) return withClass;
  return Math.floor(withClass * mult);
}

export function scaleResourceCost(cost: Resources, mult: number): Resources {
  if (mult === 1) return cost;
  return {
    metal: Math.floor(cost.metal * mult),
    crystal: Math.floor(cost.crystal * mult),
    deuterium: Math.floor(cost.deuterium * mult),
  };
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

/**
 * Nanite Factory (Round 2 / Thread J) construction speed hook.
 * × 0.1^level for buildings / ships / defenses. Research is exempt.
 * Returns 1 when level is 0 or missing (no Nanite yet).
 */
export function constructionTimeMultiplier(naniteLevel = 0): number {
  const level = Math.max(0, Math.floor(naniteLevel));
  if (level <= 0) return 1;
  return Math.pow(0.1, level);
}

/** Chrono Lathe alias — same `0.1^level` curve as constructionTimeMultiplier. */
export function chronoLatheTimeFactor(chronoLatheLevel: number): number {
  return constructionTimeMultiplier(chronoLatheLevel);
}

/**
 * Combined construction time factor: Rig Foundry then Chrono Lathe.
 * Order (Round 3): rigFoundry × chronoLathe.
 */
export function constructionSpeedFactor(
  rigFoundryLevel = 0,
  chronoLatheLevel = 0,
): number {
  return (
    rigFoundryTimeFactor(rigFoundryLevel) *
    chronoLatheTimeFactor(chronoLatheLevel)
  );
}

/**
 * Sub-second batch helper (Micah): when unitSeconds < 1, return
 * floor(elapsed / unitSeconds) capped by remaining; otherwise 0 (use completesAt).
 */
export function batchUnitsProduced(
  elapsedSec: number,
  unitSeconds: number,
  remaining: number,
): number {
  if (unitSeconds >= 1) return 0;
  if (elapsedSec <= 0 || remaining <= 0) return 0;
  const unit = Math.max(1e-9, unitSeconds);
  return Math.min(remaining, Math.floor(elapsedSec / unit + 1e-12));
}

/** Tiny epsilon so sub-second unit times never divide by zero. */
const MIN_UNIT_SECONDS = 1e-9;

/**
 * Build duration in seconds for the next level (before universe speed).
 * May be < 1 — do not floor at 1s (Micah: batch completions per tick).
 */
export function buildingUpgradeSeconds(
  buildingId: BuildingId,
  currentLevel: number,
  naniteLevel = 0,
  rigFoundryLevel = 0,
): number {
  const def = BUILDINGS[buildingId];
  const raw =
    def.baseBuildSeconds *
    Math.pow(def.costGrowth, currentLevel) *
    constructionSpeedFactor(rigFoundryLevel, naniteLevel);
  return Math.max(MIN_UNIT_SECONDS, raw);
}

export function shipCost(shipId: ShipId, count: number): Resources {
  const def = SHIPS[shipId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count,
  };
}

/** Per-unit ship build seconds (may be < 1). No 1s/unit floor. */
export function shipUnitBuildSeconds(
  shipId: ShipId,
  shipyardLevel: number,
  naniteLevel = 0,
  rigFoundryLevel = 0,
  anomalyForgeLevel = 0,
): number {
  const def = SHIPS[shipId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  const anomaly = Math.min(5, Math.max(0, Math.floor(anomalyForgeLevel)));
  const anomalyFactor = Math.max(
    0.2,
    1 - ANOMALY_FORGE_SHIP_TIME_PER * anomaly,
  );
  const raw =
    (def.buildSeconds / speedFactor) *
    constructionSpeedFactor(rigFoundryLevel, naniteLevel) *
    anomalyFactor;
  return Math.max(MIN_UNIT_SECONDS, raw);
}

export function shipBuildSeconds(
  shipId: ShipId,
  count: number,
  shipyardLevel: number,
  naniteLevel = 0,
  rigFoundryLevel = 0,
  anomalyForgeLevel = 0,
): number {
  return (
    shipUnitBuildSeconds(
      shipId,
      shipyardLevel,
      naniteLevel,
      rigFoundryLevel,
      anomalyForgeLevel,
    ) * count
  );
}

export function defenseCost(defenseId: DefenseId, count: number): Resources {
  const def = DEFENSES[defenseId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count,
  };
}

/** Per-unit defense build seconds (may be < 1). No 1s/unit floor. */
export function defenseUnitBuildSeconds(
  defenseId: DefenseId,
  shipyardLevel: number,
  naniteLevel = 0,
  rigFoundryLevel = 0,
): number {
  const def = DEFENSES[defenseId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  const raw =
    (def.buildSeconds / speedFactor) *
    constructionSpeedFactor(rigFoundryLevel, naniteLevel);
  return Math.max(MIN_UNIT_SECONDS, raw);
}

export function defenseBuildSeconds(
  defenseId: DefenseId,
  count: number,
  shipyardLevel: number,
  naniteLevel = 0,
  rigFoundryLevel = 0,
): number {
  return (
    defenseUnitBuildSeconds(
      defenseId,
      shipyardLevel,
      naniteLevel,
      rigFoundryLevel,
    ) * count
  );
}

export function researchUpgradeCost(
  researchId: ResearchId,
  currentLevel: number,
  labLevel = 0,
): Resources {
  const def = RESEARCH[researchId];
  const factor =
    Math.pow(def.costGrowth, currentLevel) *
    Math.max(0, 1 - 0.01 * Math.max(0, labLevel));
  return {
    metal: Math.max(0, Math.floor(def.baseCost.metal * factor)),
    crystal: Math.max(0, Math.floor(def.baseCost.crystal * factor)),
    deuterium: Math.max(0, Math.floor(def.baseCost.deuterium * factor)),
  };
}

export function researchUpgradeSeconds(
  researchId: ResearchId,
  currentLevel: number,
  labLevel: number,
): number {
  const def = RESEARCH[researchId];
  return Math.max(
    1,
    Math.floor(
      def.baseResearchSeconds *
        Math.pow(def.costGrowth, currentLevel) *
        Math.pow(0.97, Math.max(0, labLevel)),
    ),
  );
}

export function storageCap(level: number): number {
  // Level 0 still holds a starter pile; each vault level doubles capacity.
  // STORAGE_CAP_MULT (3) is a 200% increase over the previous base.
  return Math.floor(
    STORAGE_CAP_BASE * Math.pow(2, Math.max(0, level)) * STORAGE_CAP_MULT,
  );
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

export function energyProduced(
  planet: PlanetState,
  energyOutputMult = 1,
): number {
  const slot = planet.coords.slot;
  const base = solarEnergy(planet.buildings.solarPlant ?? 0);
  const posMult = productionMultForSlot(slot).energy;
  const temp = solarTempFactor(slot);
  const solar =
    base * posMult * temp * Math.max(0, energyOutputMult) * gridStakeEnergyMult(planet);
  const buoy = helioBuoyEnergy(planet) * Math.max(0, energyOutputMult);
  return Math.floor(solar + buoy);
}

/** 0..1 production multiplier from energy surplus/shortfall. */
export function energyFactor(
  planet: PlanetState,
  energyOutputMult = 1,
): number {
  const used = energyUsed(planet);
  if (used <= 0) return 1;
  const produced = energyProduced(planet, energyOutputMult);
  return Math.min(1, produced / used);
}

export function storageFor(planet: PlanetState, capacityMult = 1): Resources {
  const vault = echoVaultStorageMult(planet);
  const multiplier = Math.max(0, capacityMult);
  return {
    metal: Math.floor(storageCap(planet.buildings.metalStorage ?? 0) * vault * multiplier),
    crystal: Math.floor(
      storageCap(planet.buildings.crystalStorage ?? 0) * vault * multiplier,
    ),
    deuterium: Math.floor(storageCap(planet.buildings.deutTank ?? 0) * vault * multiplier),
  };
}

export function fieldsUsed(planet: PlanetState): number {
  let used = 0;
  for (const [id, level] of Object.entries(planet.buildings)) {
    if (id === "mantleLoom") {
      // Mantle Loom always occupies 1 field regardless of level.
      if ((level ?? 0) > 0) used += MANTLE_LOOM_FIELDS_USED;
      continue;
    }
    used += level ?? 0;
  }
  return used;
}

export function fieldsRemaining(
  planet: PlanetState,
  mods?: FieldCapMods,
): number {
  return Math.max(0, effectiveFieldsCap(planet, mods) - fieldsUsed(planet));
}

export interface ProductionBoosts {
  mineOutput?: number;
  energyOutput?: number;
}

export function productionPerHour(
  planet: PlanetState,
  universeSpeed = 1,
  energyTechLevel = 0,
  boosts?: ProductionBoosts,
  research?: Partial<ResearchLevels>,
): Resources {
  const energyMult =
    (boosts?.energyOutput ?? 1) *
    (1 + energyTechLevel * ENERGY_TECH_ENERGY_PER_LEVEL);
  const mineMult = boosts?.mineOutput ?? 1;
  const factor = energyFactor(planet, energyMult);
  // universe.speed scales timers + income; PRODUCTION_MULT is income-only test tuning.
  const vein = veinAnchorMineMult(planet);
  const rift = riftSiphonMineMult(planet);
  const rich = isMiniBody(planet) ? MINI_RICH_MINE_MULT : 1;
  const incomeScale =
    universeSpeed * PRODUCTION_MULT * mineMult * vein * rift * rich;
  // Mini planets use slot-8 neutral mults (out-of-band slots already neutral).
  const pos = productionMultForSlot(planet.coords.slot);
  const ironwaterDeut =
    isMiniBody(planet) && planet.flags?.miniKind === "ironwater"
      ? MINI_IRONWATER_DEUT_MULT
      : 1;
  const baseIncome = isMoon(planet) || !planet.ownerPlayerId
    ? { metal: 0, crystal: 0, deuterium: 0 }
    : BASE_INCOME_PER_HOUR;

  const metTechMult = 1 + (research?.metallurgistTech ?? 0) * 0.05;
  const cryTechMult = 1 + (research?.crystalizerTech ?? 0) * 0.05;
  const deutTechMult = 1 + (research?.deutSynthesisTech ?? 0) * 0.05;

  return {
    metal:
      mineOutputPerHour("metal", planet.buildings.metalMine ?? 0) *
      factor *
      incomeScale *
      pos.metal *
      metTechMult +
      baseIncome.metal,
    crystal:
      mineOutputPerHour("crystal", planet.buildings.crystalMine ?? 0) *
      factor *
      incomeScale *
      pos.crystal *
      cryTechMult +
      baseIncome.crystal,
    deuterium:
      mineOutputPerHour("deuterium", planet.buildings.deutSynth ?? 0) *
      factor *
      incomeScale *
      pos.deuterium *
      ironwaterDeut *
      deutTechMult +
      baseIncome.deuterium,
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
