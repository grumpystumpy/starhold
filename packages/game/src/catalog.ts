import type { BuildingId, DefenseId, ResearchId, ShipId } from "./types.js";

export { BUILDINGS } from "./catalog-buildings.js";
export { SHIPS, DEFENSES } from "./catalog-units.js";
export { RESEARCH } from "./catalog-research.js";

/** Share of defender stockpile eligible for loot on an attacker win. */
export const RAID_LOOT_SHARE = 0.5;

/** Fraction of destroyed ship metal/crystal that becomes debris. */
export const DEBRIS_FROM_SHIPS = 0.3;

/** Minimum one-way flight seconds after speed scaling. */
export const MIN_FLIGHT_SECONDS = 8;

/** Soft building-field budget (levels sum toward this). */
export const PLANET_FIELDS = 200;

export const BUILDING_ORDER: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
  "researchLab",
];

export const SHIP_ORDER: ShipId[] = [
  "scout",
  "hauler",
  "interceptor",
  "probe",
  "recycler",
  "colonyShip",
];

export const DEFENSE_ORDER: DefenseId[] = ["laserBattery", "shieldDome"];

export const RESEARCH_ORDER: ResearchId[] = [
  "energyTech",
  "combustionDrive",
  "weaponsTech",
  "armourTech",
  "shieldingTech",
  "espionageTech",
  "astrophysics",
  "computerTech",
];

export const STARTING_RESOURCES = {
  metal: 500,
  crystal: 500,
  /** Enough for a few early fleet launches before Deut Still comes online. */
  deuterium: 100,
} as const;

/**
 * Temporary playtest tuning: multiplies mine income only (not build/fleet timers).
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

/** Map bounds for the prototype galaxy browser. */
export const MAP_GALAXIES = 1;
export const MAP_SYSTEMS = 9;
export const MAP_SLOTS = 8;
