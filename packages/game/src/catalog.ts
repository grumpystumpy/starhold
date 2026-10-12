import type { BuildingDef, BuildingId, ShipDef, ShipId } from "./types.js";

/**
 * Original Starhold catalog — inspired genre shape, invented numbers/names.
 * Do not treat these as scraped OGame values.
 */

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  metalMine: {
    id: "metalMine",
    name: "Ore Extractor",
    description: "Pulls metal from the crust. Needs energy.",
    baseCost: { metal: 60, crystal: 15, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 8,
    energyUsePerLevel: 10,
    produces: "metal",
  },
  crystalMine: {
    id: "crystalMine",
    name: "Crystal Lattice",
    description: "Grows crystal veins. Needs energy.",
    baseCost: { metal: 48, crystal: 24, deuterium: 0 },
    costGrowth: 1.6,
    baseBuildSeconds: 10,
    energyUsePerLevel: 12,
    produces: "crystal",
  },
  deutSynth: {
    id: "deutSynth",
    name: "Deut Still",
    description: "Condenses deuterium from the atmosphere. Needs energy.",
    baseCost: { metal: 225, crystal: 75, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 12,
    energyUsePerLevel: 20,
    produces: "deuterium",
  },
  solarPlant: {
    id: "solarPlant",
    name: "Solar Array",
    description: "Produces energy for mines and industry.",
    baseCost: { metal: 75, crystal: 30, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 8,
    energyProdFormula: "solar",
  },
  metalStorage: {
    id: "metalStorage",
    name: "Metal Vault",
    description: "Raises metal storage cap.",
    baseCost: { metal: 1000, crystal: 0, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6,
  },
  crystalStorage: {
    id: "crystalStorage",
    name: "Crystal Vault",
    description: "Raises crystal storage cap.",
    baseCost: { metal: 1000, crystal: 500, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6,
  },
  deutTank: {
    id: "deutTank",
    name: "Deut Tank",
    description: "Raises deuterium storage cap.",
    baseCost: { metal: 1000, crystal: 1000, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6,
  },
  shipyard: {
    id: "shipyard",
    name: "Shipyard",
    description: "Unlocks and speeds hull construction.",
    // Metal/crystal only at L1 so the ships path is reachable before Deut Still.
    // 300/150 leaves starter metal just short of Scout — needs a few minutes of mining.
    baseCost: { metal: 300, crystal: 150, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 20,
  },
};

export const SHIPS: Record<ShipId, ShipDef> = {
  scout: {
    id: "scout",
    name: "Scout Skiff",
    description: "Fast recon hull. Light guns, tiny cargo.",
    // Session-tuned: after Shipyard L1, banking at early mines @ 8× — not sub-minute.
    cost: { metal: 220, crystal: 80, deuterium: 0 },
    buildSeconds: 15,
    shipyardLevel: 1,
    cargo: 50,
    attack: 8,
    shield: 4,
    hull: 20,
    speed: 12_000,
    fuelPerDistance: 0.2,
  },
  hauler: {
    id: "hauler",
    name: "Ore Hauler",
    description: "Bulk cargo for loot and peaceful deploy runs.",
    cost: { metal: 480, crystal: 480, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 2,
    cargo: 5000,
    attack: 4,
    shield: 10,
    hull: 60,
    speed: 6_000,
    fuelPerDistance: 0.8,
  },
  interceptor: {
    id: "interceptor",
    name: "Interceptor",
    description: "Light combat hull — main raid striker.",
    cost: { metal: 900, crystal: 250, deuterium: 0 },
    buildSeconds: 40,
    shipyardLevel: 3,
    cargo: 100,
    attack: 40,
    shield: 16,
    hull: 50,
    speed: 9_000,
    fuelPerDistance: 0.5,
  },
};

/** Share of defender stockpile eligible for loot on an attacker win (inspired, not cloned). */
export const RAID_LOOT_SHARE = 0.5;

/** Minimum one-way flight seconds after speed scaling (keeps ETA readable in playtests). */
export const MIN_FLIGHT_SECONDS = 8;

export const BUILDING_ORDER: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
];

export const SHIP_ORDER: ShipId[] = ["scout", "hauler", "interceptor"];

export const STARTING_RESOURCES = {
  metal: 500,
  crystal: 500,
  /** Enough for a few early fleet launches before Deut Still comes online. */
  deuterium: 100,
} as const;

/**
 * Temporary playtest tuning: multiplies mine income only (not build/fleet timers).
 * 4 = +300% on tip-95b98bc9 rates (4× metal/crystal/deut per hour at the same universe.speed).
 * Remove or set to 1 when session economy no longer needs the boost.
 */
export const PRODUCTION_MULT = 4;

/** Base hourly rates at level 1 before energy factor (invented curve). */
export const MINE_BASE_PER_HOUR = {
  metal: 30,
  crystal: 20,
  deuterium: 10,
} as const;

export const MINE_GROWTH = 1.1;
