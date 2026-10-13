import type { BuildingDef, BuildingId } from "./types.js";

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
    baseCost: { metal: 300, crystal: 150, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 20,
  },
  researchLab: {
    id: "researchLab",
    name: "Research Lab",
    description: "Unlocks empire-wide research. One project at a time.",
    // Metal/crystal only so mines-first sessions unlock research before Deut Still.
    baseCost: { metal: 180, crystal: 120, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 18,
  },
};
