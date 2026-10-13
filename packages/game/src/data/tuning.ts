import type {
  BuildingDef,
  BuildingId,
  DefenseDef,
  DefenseId,
  ResearchDef,
  ResearchId,
  ShipDef,
  ShipId,
} from "../types.js";

/**
 * Lane-c balance / content tuning — single source for ship, defense,
 * building, and research numbers (plus Round 2 combat/economy constants).
 *
 * Catalog modules re-export these tables. Prefer editing here when changing
 * balance; follow-up can migrate remaining economy constants from catalog.ts.
 */

export const SHIPS: Record<ShipId, ShipDef> = {
  scout: {
    id: "scout",
    name: "Scout Skiff",
    description: "Fast recon hull. Light guns, tiny cargo.",
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
    description: "Bulk cargo for loot and transport runs.",
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
  cruiser: {
    id: "cruiser",
    name: "Aegis Cruiser",
    description: "Mid-weight combat hull — tougher line ship for contested raids.",
    cost: { metal: 2400, crystal: 1000, deuterium: 200 },
    buildSeconds: 70,
    shipyardLevel: 4,
    cargo: 400,
    attack: 90,
    shield: 50,
    hull: 180,
    speed: 5_000,
    fuelPerDistance: 1.5,
  },
  bomber: {
    id: "bomber",
    name: "Breach Bomber",
    description: "Heavy gunship — high attack, slow cruise, deut-hungry.",
    cost: { metal: 3200, crystal: 1800, deuterium: 400 },
    buildSeconds: 95,
    shipyardLevel: 5,
    cargo: 80,
    attack: 160,
    shield: 20,
    hull: 90,
    speed: 3_500,
    fuelPerDistance: 2.0,
  },
  probe: {
    id: "probe",
    name: "Whisper Probe",
    description: "Disposable sensor drone for espionage missions.",
    cost: { metal: 0, crystal: 100, deuterium: 0 },
    buildSeconds: 8,
    shipyardLevel: 1,
    cargo: 5,
    attack: 0,
    shield: 0,
    hull: 5,
    speed: 100_000,
    fuelPerDistance: 0.05,
  },
  recycler: {
    id: "recycler",
    name: "Salvage Trawler",
    description: "Harvests metal and crystal from debris fields.",
    cost: { metal: 400, crystal: 200, deuterium: 100 },
    buildSeconds: 30,
    shipyardLevel: 2,
    cargo: 20_000,
    attack: 2,
    shield: 8,
    hull: 40,
    speed: 4_000,
    fuelPerDistance: 1.0,
  },
  colonyShip: {
    id: "colonyShip",
    name: "Outpost Cradle",
    description: "Found a new outpost on an empty planet slot. Consumed on landing.",
    cost: { metal: 800, crystal: 800, deuterium: 200 },
    buildSeconds: 50,
    shipyardLevel: 2,
    cargo: 500,
    attack: 0,
    shield: 20,
    hull: 100,
    speed: 3_000,
    fuelPerDistance: 1.2,
  },
  voidforgeTitan: {
    id: "voidforgeTitan",
    name: "Void Titan",
    description:
      "3rd-largest hull — a bit faster than World Eater; very high attack and armor, low shields, large cargo.",
    cost: { metal: 1_500_000, crystal: 1_200_000, deuterium: 400_000 },
    buildSeconds: 90_000,
    shipyardLevel: 11,
    cargo: 1_000_000,
    attack: 200_000,
    shield: 50_000,
    hull: 1_000_000,
    speed: 100,
    fuelPerDistance: 5,
    researchReq: {
      weaponsTech: 10,
      shieldingTech: 10,
      armourTech: 10,
    },
  },
  worldEater: {
    id: "worldEater",
    name: "World Eater",
    description:
      "Slowest siege hull — strongest across the board. Destroys mini planets and moons. No cargo; cannot collect debris.",
    cost: { metal: 8_000_000, crystal: 6_500_000, deuterium: 2_500_000 },
    buildSeconds: 200_000,
    shipyardLevel: 15,
    cargo: 0,
    attack: 300_000,
    shield: 800_000,
    hull: 2_000_000,
    speed: 600,
    fuelPerDistance: 4,
    researchReq: {
      weaponsTech: 14,
      shieldingTech: 14,
      armourTech: 14,
    },
  },
  swarmDrone: {
    id: "swarmDrone",
    name: "Swarm Drone",
    description:
      "Carried strike mite. Must ride a Swarm Mothership; intercepts fire aimed at the carrier.",
    cost: { metal: 50, crystal: 20, deuterium: 0 },
    buildSeconds: 2,
    shipyardLevel: 4,
    cargo: 0,
    attack: 6,
    shield: 40,
    hull: 8,
    speed: 20_000,
    fuelPerDistance: 0,
    swarmCarried: true,
  },
  swarmHarvester: {
    id: "swarmHarvester",
    name: "Swarm Harvester",
    description:
      "Carried salvage mite. Loot feeds the mothership; kamikazes when the carrier is critical.",
    cost: { metal: 100, crystal: 75, deuterium: 25 },
    buildSeconds: 5,
    shipyardLevel: 5,
    cargo: 0,
    attack: 0,
    shield: 60,
    hull: 30,
    speed: 15_000,
    fuelPerDistance: 0,
    swarmCarried: true,
  },
  swarmMothership: {
    id: "swarmMothership",
    name: "Swarm Mothership",
    description:
      "2nd-largest hull — very high shields, low attack. Carries 2000 swarms; occupies mini planets; harvests debris.",
    cost: { metal: 2_500_000, crystal: 2_000_000, deuterium: 750_000 },
    buildSeconds: 80_000,
    shipyardLevel: 13,
    cargo: 150_050_000,
    attack: 3_000,
    shield: 450_000,
    hull: 100_000,
    speed: 2_500,
    fuelPerDistance: 2,
    researchReq: {
      weaponsTech: 11,
      shieldingTech: 11,
      armourTech: 11,
    },
  },
};

export const DEFENSES: Record<DefenseId, DefenseDef> = {
  laserBattery: {
    id: "laserBattery",
    name: "Beam Emplacement",
    description: "Static guns that fight with the hangar on raids.",
    cost: { metal: 150, crystal: 50, deuterium: 0 },
    buildSeconds: 10,
    shipyardLevel: 1,
    attack: 16,
    shield: 4,
    hull: 30,
  },
  shieldDome: {
    id: "shieldDome",
    name: "Aegis Cupola",
    description: "Planetary shield — soaks fire, low attack.",
    cost: { metal: 500, crystal: 300, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 2,
    attack: 2,
    shield: 80,
    hull: 100,
  },
};

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
    description: "Unlocks empire-wide research. Queue length grows with Yard Logistics.",
    // Metal/crystal only so mines-first sessions unlock research before Deut Still.
    baseCost: { metal: 180, crystal: 120, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 18,
  },
  lunarBase: {
    id: "lunarBase",
    name: "Crater Hab",
    description: "Expands moon fields so more lunar structures can be built.",
    baseCost: { metal: 2000, crystal: 4000, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 30,
  },
  sensorArray: {
    id: "sensorArray",
    name: "Horizon Scanner",
    description:
      "Scans nearby systems for outbound fleets headed this way (moon only). Range grows with level.",
    baseCost: { metal: 4000, crystal: 8000, deuterium: 2000 },
    costGrowth: 2,
    baseBuildSeconds: 40,
  },
  jumpGate: {
    id: "jumpGate",
    name: "Fold Bridge",
    description:
      "Links your moons for near-instant fleet hops. Both moons need a Fold Bridge (moon only).",
    baseCost: { metal: 8000, crystal: 16_000, deuterium: 8000 },
    costGrowth: 2,
    baseBuildSeconds: 60,
  },
  chronoLathe: {
    id: "chronoLathe",
    name: "Chrono Lathe",
    description:
      "Late-game assembler. Each level multiplies building, ship, and defense build times by 0.1^level. Does not affect research.",
    baseCost: { metal: 1_000_000, crystal: 500_000, deuterium: 200_000 },
    costGrowth: 2.5,
    baseBuildSeconds: 3_600,
  },
};

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  energyTech: {
    id: "energyTech",
    name: "Power Discipline",
    description: "+2% mine output per level (energy discipline).",
    baseCost: { metal: 0, crystal: 80, deuterium: 40 },
    costGrowth: 2,
    baseResearchSeconds: 20,
    labLevel: 1,
  },
  combustionDrive: {
    id: "combustionDrive",
    name: "Pulse Drive",
    description: "+10% fleet cruise speed per level.",
    baseCost: { metal: 40, crystal: 0, deuterium: 60 },
    costGrowth: 2,
    baseResearchSeconds: 22,
    labLevel: 1,
  },
  weaponsTech: {
    id: "weaponsTech",
    name: "Ordnance Doctrine",
    description: "+8% ship/defense attack per level.",
    baseCost: { metal: 80, crystal: 20, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 1,
  },
  armourTech: {
    id: "armourTech",
    name: "Hull Weave",
    description: "+8% hull integrity per level.",
    baseCost: { metal: 100, crystal: 0, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 1,
  },
  shieldingTech: {
    id: "shieldingTech",
    name: "Aegis Lattice",
    description: "+8% shields per level.",
    baseCost: { metal: 20, crystal: 60, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 2,
  },
  espionageTech: {
    id: "espionageTech",
    name: "Shadow Optics",
    description: "Deeper spy reports vs rival counter-intel.",
    baseCost: { metal: 20, crystal: 100, deuterium: 20 },
    costGrowth: 2,
    baseResearchSeconds: 20,
    labLevel: 1,
  },
  astrophysics: {
    id: "astrophysics",
    name: "Stellar Cartography",
    description:
      "Each level allows +1 colony (beyond home) and +1 concurrent expedition.",
    baseCost: { metal: 40, crystal: 80, deuterium: 40 },
    costGrowth: 1.8,
    baseResearchSeconds: 30,
    labLevel: 1,
  },
  computerTech: {
    id: "computerTech",
    name: "Fleet OS",
    description: "Each level allows +1 simultaneous fleet mission (base 1).",
    baseCost: { metal: 0, crystal: 40, deuterium: 80 },
    costGrowth: 2,
    baseResearchSeconds: 22,
    labLevel: 1,
  },
  queueLogistics: {
    id: "queueLogistics",
    name: "Yard Logistics",
    description:
      "+1 building/ship/defense queue slot per 2 levels; +1 research slot per 3 levels.",
    baseCost: { metal: 80, crystal: 120, deuterium: 40 },
    costGrowth: 2,
    baseResearchSeconds: 28,
    labLevel: 2,
  },
  swarmHold: {
    id: "swarmHold",
    name: "Swarm Hold",
    description:
      "+15% of base (2000) Swarm Mothership capacity per level.",
    baseCost: { metal: 200, crystal: 400, deuterium: 200 },
    costGrowth: 2,
    baseResearchSeconds: 40,
    labLevel: 4,
  },
};

/** Swarm Mothership base carry capacity (drones + harvesters). */
export const SWARM_CAPACITY_BASE = 2000;
/** +15% of base capacity per Swarm Hold level. */
export const SWARM_HOLD_BONUS_PER_LEVEL = 0.15;
/** Soft safety ceiling (base is already 2000; research grows past it). */
export const SWARM_CAPACITY_HARD_CAP = 100_000;
/** Chrono Lathe: build-time multiplier = 0.1^level (buildings/ships/defenses). */
export const CHRONO_LATHE_TIME_BASE = 0.1;
/** Shipyard level required to start Chrono Lathe. */
export const CHRONO_LATHE_SHIPYARD_REQ = 10;
/** Drones needed before swarm numbers attack bonus applies. */
export const SWARM_NUMBERS_THRESHOLD = 50;
/** Attack bonus per drone above threshold (capped). */
export const SWARM_NUMBERS_BONUS_PER = 0.002;
export const SWARM_NUMBERS_BONUS_CAP_COUNT = 2000;
/** Fraction of mothership-targeted damage intercepted by escorts. */
export const SWARM_INTERCEPT_FRACTION = 0.7;
/** When drones + harvesters both present, split intercepted damage 50/50. */
export const SWARM_INTERCEPT_SPLIT = 0.5;
/** Harvester kamikaze when mothership hull fraction falls below this. */
export const SWARM_KAMIKAZE_HULL_FRAC = 0.3;
export const SWARM_KAMIKAZE_SHIELD_DMG = 80;
export const SWARM_KAMIKAZE_HULL_DMG = 40;
/** Occupation duration (wall-clock). */
export const OCCUPATION_DURATION_MS = 2 * 24 * 60 * 60 * 1000;
/** Occupier / owner mine output split while occupied. */
export const OCCUPATION_OCCUPIER_SHARE = 0.3;
export const OCCUPATION_OWNER_SHARE = 0.7;
/** World Eaters required to capture/destroy a mini planet. */
export const MINI_WORLD_EATER_MIN = 5;
