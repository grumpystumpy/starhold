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
    baseCost: { metal: 400, crystal: 200, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 20,
  },
};

export const SHIPS: Record<ShipId, ShipDef> = {
  scout: {
    id: "scout",
    name: "Scout Skiff",
    description: "Fast recon hull. Tiny cargo — fleet/raid path later.",
    cost: { metal: 3000, crystal: 1000, deuterium: 0 },
    buildSeconds: 15,
    shipyardLevel: 1,
    cargo: 50,
  },
  hauler: {
    id: "hauler",
    name: "Ore Hauler",
    description: "Moves resources between worlds (missions later).",
    cost: { metal: 2000, crystal: 2000, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 2,
    cargo: 5000,
  },
  interceptor: {
    id: "interceptor",
    name: "Interceptor",
    description: "Light combat hull for future raids.",
    cost: { metal: 6000, crystal: 1500, deuterium: 0 },
    buildSeconds: 40,
    shipyardLevel: 3,
    cargo: 100,
  },
};

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
  deuterium: 0,
} as const;

/** Base hourly rates at level 1 before energy factor (invented curve). */
export const MINE_BASE_PER_HOUR = {
  metal: 30,
  crystal: 20,
  deuterium: 10,
} as const;

export const MINE_GROWTH = 1.1;
