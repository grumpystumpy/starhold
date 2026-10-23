import type {
  BuildingDef,
  BuildingId,
  DefenseDef,
  DefenseId,
  GoalCadence,
  PlayerClassId,
  ResearchDef,
  ResearchId,
  ShipDef,
  ShipId,
} from "../types.js";

/** Flat hourly income for each owned planet body, independent of all multipliers. */
export const BASE_INCOME_PER_HOUR = {
  metal: 500,
  crystal: 250,
  deuterium: 100,
} as const;

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
    armor: 8,
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
    armor: 24,
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
    armor: 20,
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
    armor: 72,
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
    armor: 36,
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
    armor: 2,
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
    armor: 16,
    hull: 40,
    speed: 4_000,
    fuelPerDistance: 1.0,
  },
  colonyShip: {
    id: "colonyShip",
    name: "Colonizer",
    description: "Found a new colony on an empty planet slot. Consumed on landing.",
    cost: { metal: 800, crystal: 800, deuterium: 200 },
    buildSeconds: 50,
    shipyardLevel: 2,
    cargo: 500,
    attack: 0,
    shield: 20,
    armor: 40,
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
    armor: 400_000,
    hull: 1_000_000,
    speed: 100,
    fuelPerDistance: 5,
    researchReq: {
      weaponsTech: 10,
      shieldingTech: 10,
      armourTech: 10,
      gravityWell: 1,
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
    armor: 800_000,
    hull: 2_000_000,
    speed: 300,
    fuelPerDistance: 4,
    researchReq: {
      weaponsTech: 14,
      shieldingTech: 14,
      armourTech: 14,
      gravityWell: 1,
    },
  },
  swarmDrone: {
    id: "swarmDrone",
    name: "Swarm Drone",
    description:
      "Carried strike mite. Must ride a Mothership; intercepts fire aimed at the carrier.",
    cost: { metal: 50, crystal: 20, deuterium: 0 },
    buildSeconds: 2,
    shipyardLevel: 4,
    cargo: 0,
    attack: 6,
    shield: 40,
    armor: 3,
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
    armor: 12,
    hull: 30,
    speed: 15_000,
    fuelPerDistance: 0,
    swarmCarried: true,
  },
  swarmMothership: {
    id: "swarmMothership",
    name: "Mothership",
    description:
      "2nd-largest hull — very high shields, low attack. Carries 2,000 swarms; occupies mini planets; harvests debris.",
    cost: { metal: 2_500_000, crystal: 2_000_000, deuterium: 750_000 },
    buildSeconds: 80_000,
    shipyardLevel: 13,
    cargo: 150_050_000,
    attack: 3_000,
    shield: 450_000,
    armor: 40_000,
    hull: 100_000,
    speed: 2_500,
    fuelPerDistance: 2,
    researchReq: {
      weaponsTech: 11,
      shieldingTech: 11,
      armourTech: 11,
      gravityWell: 1,
    },
  },
  helioBuoy: {
    id: "helioBuoy",
    name: "Helio Buoy",
    description:
      "Orbital energy platform. Parks in hangar; does not fly missions. Energy scales with planet temperature.",
    cost: { metal: 0, crystal: 2000, deuterium: 500 },
    buildSeconds: 30,
    shipyardLevel: 3,
    cargo: 0,
    attack: 0,
    shield: 1,
    armor: 4,
    hull: 10,
    speed: 0,
    fuelPerDistance: 0,
    stationary: true,
    orbitalEnergy: true,
    noDebris: true,
  },
  keelSovereign: {
    id: "keelSovereign",
    name: "Keel Sovereign",
    description: "Fleet backbone — heavy line ship above Aegis Cruiser.",
    cost: { metal: 40_000, crystal: 20_000, deuterium: 10_000 },
    buildSeconds: 1800,
    shipyardLevel: 7,
    cargo: 1500,
    attack: 1000,
    shield: 400,
    armor: 1000,
    hull: 2500,
    speed: 2500,
    fuelPerDistance: 3,
    researchReq: {
      weaponsTech: 6,
      armourTech: 5,
      shieldingTech: 5,
      combustionDrive: 4,
    },
  },
  rakeCorsair: {
    id: "rakeCorsair",
    name: "Rake Corsair",
    description: "Fleet hunter — rapid fire vs light hulls.",
    cost: { metal: 30_000, crystal: 40_000, deuterium: 15_000 },
    buildSeconds: 1600,
    shipyardLevel: 7,
    cargo: 750,
    attack: 700,
    shield: 250,
    armor: 480,
    hull: 1200,
    speed: 6000,
    fuelPerDistance: 2.5,
    researchReq: {
      weaponsTech: 6,
      armourTech: 5,
      shieldingTech: 5,
      combustionDrive: 4,
    },
  },
  anvilDread: {
    id: "anvilDread",
    name: "Anvil Dread",
    description: "Mobile battle platform — heavy shields and hull.",
    cost: { metal: 60_000, crystal: 25_000, deuterium: 20_000 },
    buildSeconds: 2200,
    shipyardLevel: 8,
    cargo: 2000,
    attack: 500,
    shield: 800,
    armor: 1200,
    hull: 3000,
    speed: 2000,
    fuelPerDistance: 4,
    researchReq: {
      weaponsTech: 6,
      armourTech: 5,
      shieldingTech: 5,
      combustionDrive: 4,
    },
  },
  wardbreaker: {
    id: "wardbreaker",
    name: "Wardbreaker",
    description: "Anti-defense strike hull — shreds static guns.",
    cost: { metal: 50_000, crystal: 35_000, deuterium: 20_000 },
    buildSeconds: 2000,
    shipyardLevel: 8,
    cargo: 400,
    attack: 1200,
    shield: 150,
    armor: 360,
    hull: 900,
    speed: 3000,
    fuelPerDistance: 3.5,
    researchReq: {
      weaponsTech: 6,
      armourTech: 5,
      shieldingTech: 5,
      combustionDrive: 4,
    },
  },
  vaultScout: {
    id: "vaultScout",
    name: "Vault Scout",
    description: "Explorer exclusive — boosts expedition yield when in the fleet.",
    cost: { metal: 2000, crystal: 4000, deuterium: 1000 },
    buildSeconds: 120,
    shipyardLevel: 5,
    cargo: 200,
    attack: 20,
    shield: 40,
    armor: 32,
    hull: 80,
    speed: 18_000,
    fuelPerDistance: 1,
    classExclusive: "explorer",
  },
  astrolabeWing: {
    id: "astrolabeWing",
    name: "Astrolabe Wing",
    description:
      "Explorer exclusive — parked: −8% empire research time; spy escort +1 detail.",
    cost: { metal: 3000, crystal: 5000, deuterium: 1500 },
    buildSeconds: 150,
    shipyardLevel: 6,
    cargo: 100,
    attack: 10,
    shield: 60,
    armor: 40,
    hull: 100,
    speed: 14_000,
    fuelPerDistance: 1.2,
    classExclusive: "explorer",
  },
  spoilSkimmer: {
    id: "spoilSkimmer",
    name: "Spoil Skimmer",
    description:
      "Fleeter exclusive — on attacker victory, skims 15% of the debris field into cargo.",
    cost: { metal: 4000, crystal: 2000, deuterium: 2000 },
    buildSeconds: 140,
    shipyardLevel: 6,
    cargo: 25_000,
    attack: 5,
    shield: 30,
    armor: 48,
    hull: 120,
    speed: 5000,
    fuelPerDistance: 1.5,
    classExclusive: "fleeter",
  },
  lineDrummer: {
    id: "lineDrummer",
    name: "Line Drummer",
    description:
      "Fleeter exclusive — fleet-speed aura (+2%/hull, cap +20%) and light RF support.",
    cost: { metal: 5000, crystal: 4000, deuterium: 1000 },
    buildSeconds: 160,
    shipyardLevel: 6,
    cargo: 500,
    attack: 80,
    shield: 40,
    armor: 80,
    hull: 200,
    speed: 8000,
    fuelPerDistance: 2,
    classExclusive: "fleeter",
  },
  veinAnchor: {
    id: "veinAnchor",
    name: "Vein Anchor",
    description:
      "Miner exclusive — stationary mine booster (+3%/hull on that planet, cap +30%).",
    cost: { metal: 5000, crystal: 2500, deuterium: 0 },
    buildSeconds: 200,
    shipyardLevel: 4,
    cargo: 0,
    attack: 0,
    shield: 50,
    armor: 80,
    hull: 200,
    speed: 0,
    fuelPerDistance: 0,
    stationary: true,
    classExclusive: "miner",
  },
  gridStake: {
    id: "gridStake",
    name: "Grid Stake",
    description:
      "Miner exclusive — stationary energy booster (+4%/hull, cap +40%) and light defense.",
    cost: { metal: 4000, crystal: 4000, deuterium: 500 },
    buildSeconds: 180,
    shipyardLevel: 5,
    cargo: 0,
    attack: 40,
    shield: 80,
    armor: 100,
    hull: 250,
    speed: 0,
    fuelPerDistance: 0,
    stationary: true,
    classExclusive: "miner",
  },
  foundationArk: {
    id: "foundationArk",
    name: "Foundation Ark",
    description:
      "Expansionist exclusive — colonizer that bootstraps starting buildings (consumed on landing).",
    cost: { metal: 10_000, crystal: 10_000, deuterium: 5000 },
    buildSeconds: 600,
    shipyardLevel: 5,
    cargo: 2000,
    attack: 0,
    shield: 80,
    armor: 160,
    hull: 400,
    speed: 2500,
    fuelPerDistance: 2,
    classExclusive: "expansionist",
  },
  frontierBeacon: {
    id: "frontierBeacon",
    name: "Frontier Beacon",
    description:
      "Expansionist exclusive — +1 colony slot empire-wide; Fold Bridge cooldown ×0.75.",
    cost: { metal: 8000, crystal: 6000, deuterium: 4000 },
    buildSeconds: 400,
    shipyardLevel: 6,
    cargo: 1000,
    attack: 30,
    shield: 100,
    armor: 120,
    hull: 300,
    speed: 4000,
    fuelPerDistance: 1.5,
    classExclusive: "expansionist",
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
    armor: 12,
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
    armor: 40,
    hull: 100,
  },
  needleTurret: {
    id: "needleTurret",
    name: "Needle Turret",
    description: "Cheap mass DPS turret.",
    cost: { metal: 200, crystal: 0, deuterium: 0 },
    buildSeconds: 8,
    shipyardLevel: 1,
    attack: 12,
    shield: 2,
    armor: 10,
    hull: 25,
  },
  arcLattice: {
    id: "arcLattice",
    name: "Arc Lattice",
    description: "Light beam lattice.",
    cost: { metal: 150, crystal: 50, deuterium: 0 },
    buildSeconds: 10,
    shipyardLevel: 2,
    attack: 20,
    shield: 4,
    armor: 14,
    hull: 35,
  },
  pulseBastion: {
    id: "pulseBastion",
    name: "Pulse Bastion",
    description: "Mid-weight beam bastion.",
    cost: { metal: 600, crystal: 200, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 4,
    attack: 80,
    shield: 20,
    armor: 40,
    hull: 100,
  },
  gaussRail: {
    id: "gaussRail",
    name: "Gauss Rail",
    description: "Crystal-heavy pierce rail.",
    cost: { metal: 2000, crystal: 1500, deuterium: 0 },
    buildSeconds: 50,
    shipyardLevel: 6,
    attack: 180,
    shield: 30,
    armor: 72,
    hull: 180,
  },
  ionSheath: {
    id: "ionSheath",
    name: "Ion Sheath",
    description: "Shield-breaker ion wall.",
    cost: { metal: 1000, crystal: 500, deuterium: 200 },
    buildSeconds: 45,
    shipyardLevel: 6,
    attack: 120,
    shield: 80,
    armor: 60,
    hull: 150,
  },
  plasmaSpire: {
    id: "plasmaSpire",
    name: "Plasma Spire",
    description: "Late heavy DPS spire.",
    cost: { metal: 5000, crystal: 3000, deuterium: 1000 },
    buildSeconds: 90,
    shipyardLevel: 8,
    attack: 450,
    shield: 60,
    armor: 160,
    hull: 400,
  },
  flakCurtain: {
    id: "flakCurtain",
    name: "Flak Curtain",
    description: "Anti-fighter flak with rapid fire vs light hulls.",
    cost: { metal: 400, crystal: 200, deuterium: 50 },
    buildSeconds: 18,
    shipyardLevel: 3,
    attack: 30,
    shield: 10,
    armor: 24,
    hull: 60,
  },
  kineticFence: {
    id: "kineticFence",
    name: "Kinetic Fence",
    description: "Cheap hull wall.",
    cost: { metal: 400, crystal: 100, deuterium: 0 },
    buildSeconds: 12,
    shipyardLevel: 2,
    attack: 5,
    shield: 5,
    armor: 48,
    hull: 120,
  },
  emberMortar: {
    id: "emberMortar",
    name: "Ember Mortar",
    description: "Deut-hungry punch mortar.",
    cost: { metal: 800, crystal: 400, deuterium: 400 },
    buildSeconds: 35,
    shipyardLevel: 5,
    attack: 140,
    shield: 15,
    armor: 36,
    hull: 90,
  },
  rippleArray: {
    id: "rippleArray",
    name: "Ripple Array",
    description: "Mid soak shield array.",
    cost: { metal: 800, crystal: 600, deuterium: 0 },
    buildSeconds: 30,
    shipyardLevel: 4,
    attack: 4,
    shield: 120,
    armor: 60,
    hull: 150,
  },
  haloProjector: {
    id: "haloProjector",
    name: "Halo Projector",
    description: "Small cupola — soft-cap 1 per planet.",
    cost: { metal: 6000, crystal: 4000, deuterium: 0 },
    buildSeconds: 120,
    shipyardLevel: 5,
    attack: 1,
    shield: 400,
    armor: 80,
    hull: 200,
    uniqueHint: true,
  },
  crownAegis: {
    id: "crownAegis",
    name: "Crown Aegis",
    description: "Large cupola — soft-cap 1 per planet.",
    cost: { metal: 50_000, crystal: 40_000, deuterium: 10_000 },
    buildSeconds: 600,
    shipyardLevel: 8,
    attack: 1,
    shield: 5000,
    armor: 800,
    hull: 2000,
    uniqueHint: true,
  },
  siegeBlockade: {
    id: "siegeBlockade",
    name: "Siege Blockade",
    description: "Anti-capital soak wall.",
    cost: { metal: 3000, crystal: 2000, deuterium: 500 },
    buildSeconds: 70,
    shipyardLevel: 7,
    attack: 40,
    shield: 200,
    armor: 200,
    hull: 500,
  },
  frostLance: {
    id: "frostLance",
    name: "Frost Lance",
    description: "Cold-slot preferential (+10% attack on slots 12–15).",
    cost: { metal: 900, crystal: 300, deuterium: 300 },
    buildSeconds: 40,
    shipyardLevel: 5,
    attack: 100,
    shield: 25,
    armor: 44,
    hull: 110,
    slotAttackBonus: { slots: [12, 13, 14, 15], factor: 1.1 },
  },
  voidWard: {
    id: "voidWard",
    name: "Void Ward",
    description: "Elite late defense.",
    cost: { metal: 20_000, crystal: 15_000, deuterium: 5000 },
    buildSeconds: 300,
    shipyardLevel: 10,
    attack: 600,
    shield: 300,
    armor: 320,
    hull: 800,
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
    description:
      "Raises the metal storage cap. Capacity starts at 30,000 and doubles with each level.",
    baseCost: { metal: 1000, crystal: 0, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6,
  },
  crystalStorage: {
    id: "crystalStorage",
    name: "Crystal Vault",
    description:
      "Raises the crystal storage cap. Capacity starts at 30,000 and doubles with each level.",
    baseCost: { metal: 1000, crystal: 500, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6,
  },
  deutTank: {
    id: "deutTank",
    name: "Deut Tank",
    description:
      "Raises the deuterium storage cap. Capacity starts at 30,000 and doubles with each level.",
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
  mantleLoom: {
    id: "mantleLoom",
    name: "Mantle Loom",
    description:
      "Field expansion — occupies 1 field and adds 5 fields per level. Very high energy use. Planet only.",
    baseCost: { metal: 50_000, crystal: 100_000, deuterium: 30_000 },
    costGrowth: 2.0,
    baseBuildSeconds: 120,
    energyUsePerLevel: 80,
  },
  rigFoundry: {
    id: "rigFoundry",
    name: "Rig Foundry",
    description:
      "Construction plant — −15% build time per level for buildings/ships/defenses (floor ×0.10). Required for Chrono Lathe.",
    baseCost: { metal: 400, crystal: 200, deuterium: 100 },
    costGrowth: 2.0,
    baseBuildSeconds: 40,
    energyUsePerLevel: 15,
  },
  riftSiphon: {
    id: "riftSiphon",
    name: "Rift Siphon",
    description:
      "Mini-planet special — +15% all mine output on this body per level (max 5).",
    baseCost: { metal: 800, crystal: 400, deuterium: 200 },
    costGrowth: 1.8,
    baseBuildSeconds: 45,
    energyUsePerLevel: 25,
    maxLevel: 5,
  },
  echoVault: {
    id: "echoVault",
    name: "Echo Vault",
    description:
      "Mini-planet special — +25% storage caps per level (max 5).",
    baseCost: { metal: 1200, crystal: 800, deuterium: 0 },
    costGrowth: 1.9,
    baseBuildSeconds: 40,
    maxLevel: 5,
  },
  anomalyForge: {
    id: "anomalyForge",
    name: "Anomaly Forge",
    description:
      "Mini-planet special — −8% ship build time per level (max 5).",
    baseCost: { metal: 1000, crystal: 1000, deuterium: 400 },
    costGrowth: 1.9,
    baseBuildSeconds: 50,
    energyUsePerLevel: 30,
    maxLevel: 5,
  },
  driftBeacon: {
    id: "driftBeacon",
    name: "Drift Beacon",
    description:
      "Mini-planet special — +1 fleet slot and +1 expedition slot at level 1 (higher levels reserved).",
    baseCost: { metal: 2000, crystal: 1500, deuterium: 1000 },
    costGrowth: 2.0,
    baseBuildSeconds: 60,
    maxLevel: 5,
  },

};

export const ENERGY_TECH_ENERGY_PER_LEVEL = 0.05;

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  energyTech: {
    id: "energyTech",
    name: "Power Discipline",
    description: "+5% energy production per level.",
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
      "+15% of base (2,000) Mothership capacity per level.",
    baseCost: { metal: 200, crystal: 400, deuterium: 200 },
    costGrowth: 2,
    baseResearchSeconds: 40,
    labLevel: 4,
  },
  gravityWell: {
    id: "gravityWell",
    name: "Well Binding",
    description:
      "Gravity doctrine — required for Void Titan, Mothership, and World Eater.",
    baseCost: { metal: 0, crystal: 4000, deuterium: 2000 },
    costGrowth: 2.0,
    baseResearchSeconds: 120,
    labLevel: 6,
  },

};

/** Mothership base carry capacity (drones + harvesters). */
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
/**
 * World Eaters required to **destroy** a mini planet.
 * Direct capture on win: Void Titan / Mothership / World Eater (see canDirectCaptureMini).
 */
export const MINI_WORLD_EATER_MIN = 1;
/** Mini planets spawn outside normal slots 1–16. */
export const MINI_SLOT_MIN = 20;
export const MINI_SLOT_MAX = 29;
/** ~1 standard mini planet per N systems (multiple minis OK in same system). */
export const MINI_SYSTEMS_PER = 5;
/** Fields cap band for mini planets (v1). */
export const MINI_FIELDS_MIN = 80;
export const MINI_FIELDS_MAX = 140;
/** Rich output vs similar-size normals (slot-8 baseline). */
export const MINI_RICH_MINE_MULT = 1.75;
/** Destroy payout multiplier on remaining metal/crystal (never deut) — massive. */
export const MINI_DESTROY_RESOURCE_MULT = 5;
/** Debris fraction of cumulative building residual cost on destroy (metal/crystal). */
export const MINI_DESTROY_DEBRIS_FRAC = 0.75;
/** After first colonize, minis become galaxy-visible to all after this delay. */
export const MINI_GALAXY_VISIBLE_AFTER_MS = 8 * 60 * 60 * 1000;
/** Wall-clock between mini drift steps. */
export const MINI_DRIFT_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Max |Δsystem| per drift step (same galaxy). */
export const MINI_DRIFT_SYSTEM_STEP = 2;

/** Super-rare spawn: ~1 Ironwater per N systems. */
export const MINI_IRONWATER_SYSTEMS_PER = 2000;
/** Super-rare spawn: ~1 Moving Fortress per N systems. */
export const MINI_FORTRESS_SYSTEMS_PER = 2500;
/** Super-rare spawn: ~1 Relic World per N systems. */
export const MINI_RELIC_SYSTEMS_PER = 2500;
/**
 * Ironwater deut mult vs slot-8 baseline at same deutSynth.
 * Best normal slot deut mult is 1.3 (slot 15) × 10 = 13.
 */
export const MINI_IRONWATER_DEUT_MULT = 13;
/** Moving Fortress: max |Δgalaxy| per jump (current or one over). */
export const MINI_FORTRESS_RELOCATE_GALAXY_RANGE = 1;
/** Landing accuracy: final system is random within ±N of chosen (clamped 1–MAP_SYSTEMS). */
export const MINI_FORTRESS_RELOCATE_ACCURACY = 10;
/** Deut cost: base + per |Δgalaxy| + per |Δsystem| of the chosen aim. */
export const MINI_FORTRESS_RELOCATE_DEUT_BASE = 10_000;
export const MINI_FORTRESS_RELOCATE_DEUT_PER_GALAXY = 25_000;
export const MINI_FORTRESS_RELOCATE_DEUT_PER_SYSTEM = 200;
/** @deprecated Replaced by galaxy-range + accuracy jump model. */
export const MINI_FORTRESS_RELOCATE_SYSTEMS = 8;
/** Fortress battlefield combat mods (all fleets/defenses at body). */
export const MINI_FORTRESS_SHIELD_MULT = 3;
export const MINI_FORTRESS_ATTACK_MULT = 2;
export const MINI_FORTRESS_ARMOR_MULT = 0.25;
/** Relic World empire research time factor (×0.70 = +30% speed). */
export const MINI_RELIC_RESEARCH_TIME = 0.7;
/** Relic World expedition find multiplier. */
export const MINI_RELIC_EXPEDITION_FIND = 1.25;
/** Relic Worlds get this many extra lottery tickets in pirate raid targeting. */
export const MINI_RELIC_PIRATE_WEIGHT = 4;

/** Rift Siphon: +15% mine output per level. */
export const RIFT_SIPHON_MINE_PER = 0.15;
/** Echo Vault: +25% storage caps per level. */
export const ECHO_VAULT_STORAGE_PER = 0.25;
/**
 * Vault capacity before the level doubling: `STORAGE_CAP_BASE * 2^level`.
 * `STORAGE_CAP_MULT` is 3 — a 200% increase, so every level holds triple
 * the previous formula.
 */
export const STORAGE_CAP_BASE = 10_000;
export const STORAGE_CAP_MULT = 3;
/** Skills and officers each train from level 1 through this cap. */
export const SKILL_MAX_LEVEL = 10;
export const OFFICER_MAX_LEVEL = 10;
/**
 * Flat bonuses (fleet slots, espionage detail, queue slots) stay at the
 * level-1 amount for this many levels, then step up by the same amount.
 * Level 1 matches the old single unlock. Level 10 is four steps.
 */
export const FLAT_BONUS_LEVELS_PER_STEP = 3;
/** Anomaly Forge: −8% ship build time per level. */
export const ANOMALY_FORGE_SHIP_TIME_PER = 0.08;

/** Round 3 — Rig Foundry: −15% build time per level, floor ×0.10. */
export const RIG_FOUNDRY_TIME_PER_LEVEL = 0.15;
export const RIG_FOUNDRY_TIME_FLOOR = 0.1;
/** Chrono Lathe also requires Rig Foundry this level. */
export const CHRONO_LATHE_RIG_FOUNDRY_REQ = 10;
/** Mantle Loom: +fieldsCap per level; always occupies 1 field. */
export const MANTLE_LOOM_FIELDS_PER_LEVEL = 5;
export const MANTLE_LOOM_FIELDS_USED = 1;
/** Mantle Loom gates. */
export const MANTLE_LOOM_SOLAR_REQ = 5;
export const MANTLE_LOOM_LAB_REQ = 3;
/** Rig Foundry gate. */
export const RIG_FOUNDRY_SHIPYARD_REQ = 2;

/** Slot → temperature K (v1). Slot 8 = 90K baseline for solar. */
export const SLOT_TEMPERATURE_K: Readonly<Record<number, number>> = {
  1: 220,
  2: 200,
  3: 180,
  4: 160,
  5: 140,
  6: 120,
  7: 100,
  8: 90,
  9: 80,
  10: 70,
  11: 60,
  12: 50,
  13: 40,
  14: 30,
  15: 20,
};
export const SOLAR_TEMP_BASELINE_K = 90;

/** Class change Starshards: 200 + 100 × priorChangeCount. */
export const CLASS_CHANGE_BASE_COST = 200;
export const CLASS_CHANGE_COST_PER_PRIOR = 100;
/** 7-day wall-clock cooldown after a paid class change. */
export const CLASS_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const PLAYER_CLASS_ORDER: readonly PlayerClassId[] = [
  "miner",
  "explorer",
  "fleeter",
  "expansionist",
] as const;

export const PLAYER_CLASS_BONUSES: Readonly<
  Record<
    PlayerClassId,
    {
      name: string;
      mineOutput: number;
      energyOutput: number;
      defensePower: number;
      defenseBuildTime: number;
      expeditionYield: number;
      researchTime: number;
      probeSpeed: number;
      expeditionSlots: number;
      attack: number;
      fleetSpeed: number;
      shipBuildTime: number;
      fleetSlots: number;
      colonySlots: number;
      colonyShipSpeed: number;
      buildingBuildTime: number;
      jumpGateCooldown: number;
    }
  >
> = {
  miner: {
    name: "Miner",
    mineOutput: 1.12,
    energyOutput: 1.1,
    defensePower: 1.1,
    defenseBuildTime: 0.9,
    expeditionYield: 1,
    researchTime: 1,
    probeSpeed: 1,
    expeditionSlots: 0,
    attack: 1,
    fleetSpeed: 1,
    shipBuildTime: 1,
    fleetSlots: 0,
    colonySlots: 0,
    colonyShipSpeed: 1,
    buildingBuildTime: 1,
    jumpGateCooldown: 1,
  },
  explorer: {
    name: "Explorer",
    mineOutput: 1,
    energyOutput: 1,
    defensePower: 1,
    defenseBuildTime: 1,
    expeditionYield: 1.2,
    researchTime: 0.9,
    probeSpeed: 1.25,
    expeditionSlots: 1,
    attack: 1,
    fleetSpeed: 1,
    shipBuildTime: 1,
    fleetSlots: 0,
    colonySlots: 0,
    colonyShipSpeed: 1,
    buildingBuildTime: 1,
    jumpGateCooldown: 1,
  },
  fleeter: {
    name: "Fleeter",
    mineOutput: 1,
    energyOutput: 1,
    defensePower: 1,
    defenseBuildTime: 1,
    expeditionYield: 1,
    researchTime: 1,
    probeSpeed: 1,
    expeditionSlots: 0,
    attack: 1.08,
    fleetSpeed: 1.1,
    shipBuildTime: 0.9,
    fleetSlots: 2,
    colonySlots: 0,
    colonyShipSpeed: 1,
    buildingBuildTime: 1,
    jumpGateCooldown: 1,
  },
  expansionist: {
    name: "Expansionist",
    mineOutput: 1,
    energyOutput: 1,
    defensePower: 1,
    defenseBuildTime: 1,
    expeditionYield: 1,
    researchTime: 1,
    probeSpeed: 1,
    expeditionSlots: 0,
    attack: 1,
    fleetSpeed: 1,
    shipBuildTime: 1,
    fleetSlots: 0,
    colonySlots: 2,
    colonyShipSpeed: 1.15,
    buildingBuildTime: 0.95,
    jumpGateCooldown: 0.85,
  },
};

/** ========== Pirates + Aliens (Micah redesign 2026-10-14) ==========
 * Constant names fixed by docs/design/round2-contract.md §5–5b.
 * Magnitudes are v1 placeholders except Micah overrides (200 / hourly / 0 aliens).
 */

export const PIRATE_MAX_LEVEL = 100;
/** @deprecated Alias — prefer PIRATE_MAX_LEVEL. */
export const PIRATE_LEVEL_CAP = PIRATE_MAX_LEVEL;
/** @deprecated Alias of PIRATE_MAX_LEVEL (tier === level). */
export const PIRATE_TIER_CAP = PIRATE_MAX_LEVEL;

export const PIRATE_LEVEL_GROWTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** @deprecated Prefer PIRATE_LEVEL_GROWTH_INTERVAL_MS. */
export const PIRATE_GROWTH_INTERVAL_MS = PIRATE_LEVEL_GROWTH_INTERVAL_MS;

export const PIRATE_TARGET_BASE_COUNT = 200;

/** Once per 90 minutes; each base rolls nextRaidAt = periodStart + offset. */
export const PIRATE_RAID_PERIOD_MS = 90 * 60 * 1000;
/** Stretch / skip factor so pirate-vs-pirate is slightly less often. */
export const PIRATE_VS_PIRATE_RAID_PERIOD_MULT = 1.25;
/** @deprecated Prefer PIRATE_RAID_PERIOD_MS. */
export const NPC_RAID_PERIOD_MS = PIRATE_RAID_PERIOD_MS;
/** @deprecated */
export const PIRATE_RAID_INTERVAL_MIN_MS = PIRATE_RAID_PERIOD_MS;
/** @deprecated */
export const PIRATE_RAID_INTERVAL_MAX_MS = PIRATE_RAID_PERIOD_MS;

export const PIRATE_FREE_SPAWN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const PIRATE_FREE_SHIP_BASE = 10;
export const PIRATE_FREE_SHIP_PER_LEVEL = 5;
/** @deprecated Prefer PIRATE_FREE_SHIP_*. */
export const PIRATE_FREE_SPAWN_BASE = PIRATE_FREE_SHIP_BASE;
/** @deprecated Prefer PIRATE_FREE_SHIP_*. */
export const PIRATE_FREE_SPAWN_PER_LEVEL = PIRATE_FREE_SHIP_PER_LEVEL;

export const PIRATE_FREE_DEFENSE_BASE = 5;
export const PIRATE_FREE_DEFENSE_PER_LEVEL = 2;
export const PIRATE_LEVEL_DEFENSE_BASE = 3;
export const PIRATE_LEVEL_DEFENSE_PER_LEVEL = 1;

/** Composition weights (relative). Ids must be DefenseId / ShipId. */
export const PIRATE_FREE_SHIP_COMPOSITION: Readonly<Record<string, number>> = {
  scout: 7,
  interceptor: 3,
};
export const PIRATE_FREE_DEFENSE_COMPOSITION: Readonly<Record<string, number>> = {
  laserBattery: 5,
  needleTurret: 3,
  arcLattice: 1,
};
export const PIRATE_LEVEL_DEFENSE_COMPOSITION: Readonly<Record<string, number>> = {
  laserBattery: 4,
  needleTurret: 3,
  arcLattice: 2,
  kineticFence: 1,
  flakCurtain: 1,
  pulseBastion: 1,
  rippleArray: 1,
  gaussRail: 1,
  ionSheath: 1,
  emberMortar: 1,
  plasmaSpire: 1,
  siegeBlockade: 1,
  voidWard: 1,
  crownAegis: 1,
};

export const PIRATE_SPLIT_LEVEL = 25;
export const PIRATE_SPLIT_CHILD_COUNT = 2;
export const PIRATE_SPLIT_CHILD_LEVEL = 1;
export const PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS = 5;

export const PIRATE_EXCLUDED_SHIP_IDS = [
  "worldEater",
  "swarmMothership",
  "voidforgeTitan",
] as const;

/** After player destroy: respawn delay elsewhere (inclusive range). */
export const PIRATE_RESPAWN_DELAY_MIN_MS = 12 * 60 * 60 * 1000;
export const PIRATE_RESPAWN_DELAY_MAX_MS = 36 * 60 * 60 * 1000;

/** Starshards: destroy base = base + per-tier; win defense vs pirate raid. */
export const PIRATE_DESTROY_STARSHARDS_BASE = 40;
export const PIRATE_DESTROY_STARSHARDS_PER_TIER = 5;
export const PIRATE_DEFENSE_WIN_STARSHARDS = 10;

/**
 * Soft cap for NPC raid detachment vs small empires:
 * raid power ≤ defenderPower × factor + floor.
 */
export const PIRATE_RAID_POWER_FACTOR = 1.4;
export const PIRATE_RAID_POWER_FLOOR = 40;

/** Max catch-up raid firings per base per tick (lazy Hobby path). */
export const NPC_RAID_CATCHUP_MAX = 24;
/** Max AI bases processed per lazy tick batch (bounded Hobby maxDuration). */
export const NPC_AI_BATCH_SIZE = 200;

/**
 * Workers free plan allows 10ms of CPU per request. These caps spread a
 * long-idle catch-up across later requests. Vercel does not install a
 * tick budget, so it still runs the full tick. See docs/cloudflare.md.
 */
export const WORKERS_TICK_RAID_BUDGET = 2;
export const WORKERS_TICK_LEVELUP_BUDGET = 40;
export const WORKERS_TICK_FLEET_BUDGET = 2;
export const WORKERS_TICK_DRIFT_BUDGET = 8;
/** Systems of asteroids + minis visited per Workers request. */
export const WORKERS_TICK_SEED_SYSTEMS = 8;
/** Stop a seed slice after this many new mini bodies. */
export const WORKERS_TICK_SEED_MINIS = 1;
/** Pirate bases placed per Workers request once the map scan finishes. */
export const WORKERS_TICK_SEED_PIRATES = 4;

/**
 * 10-minute NPC job. 200 bases at one raid per 90 minutes is about 23 dues
 * per run, and a real day peaks around 31. 36 clears that bucket in one pass.
 */
export const NPC_JOB_RAID_BUDGET = 36;
export const NPC_JOB_LEVELUP_BUDGET = 80;
export const NPC_JOB_FLEET_BUDGET = 8;

/* ---- Aliens ---- */

export const ALIEN_INITIAL_BASE_COUNT = 0;
/** 0.001% per expedition. */
export const ALIEN_EXPEDITION_FIND_CHANCE = 0.00001;
export const ALIEN_SETTLE_SLOT = 1;
export const ALIEN_BUILDUP_MS = 4 * 60 * 60 * 1000;
export const ALIEN_MAX_LEVEL = 100;
export const ALIEN_SPLIT_LEVEL = 50;
export const ALIEN_SPLIT_CHILD_COUNT = 2;
export const ALIEN_SPLIT_CHILD_LEVEL = 1;
export const ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS = 5;
export const ALIEN_RAID_PERIOD_MS = 60 * 60 * 1000;
export const ALIEN_VS_ALIEN_RAID_PERIOD_MULT = 1.25;
export const ALIEN_FREE_SPAWN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const ALIEN_STRENGTH_MULT = 1.5;
export const ALIEN_FREE_SHIP_BASE = 15;
export const ALIEN_FREE_SHIP_PER_LEVEL = 8;
export const ALIEN_FREE_DEFENSE_BASE = 8;
export const ALIEN_FREE_DEFENSE_PER_LEVEL = 3;
export const ALIEN_LEVEL_DEFENSE_BASE = 5;
export const ALIEN_LEVEL_DEFENSE_PER_LEVEL = 2;
export const ALIEN_MAX_BASE_COUNT = 12;
export const ALIEN_TECH_ABOVE_TOP_PLAYER = 1;
export const ALIEN_EXCLUDED_SHIP_IDS = PIRATE_EXCLUDED_SHIP_IDS;

export const ALIEN_FREE_SHIP_COMPOSITION: Readonly<Record<string, number>> = {
  scout: 6,
  interceptor: 4,
};
export const ALIEN_FREE_DEFENSE_COMPOSITION: Readonly<Record<string, number>> = {
  laserBattery: 4,
  needleTurret: 3,
  arcLattice: 2,
  flakCurtain: 1,
};
export const ALIEN_LEVEL_DEFENSE_COMPOSITION: Readonly<Record<string, number>> =
  PIRATE_LEVEL_DEFENSE_COMPOSITION;

/** @deprecated Prefer ALIEN_EXPEDITION_FIND_CHANCE. */
export const ALIEN_FIND_CHANCE_DENOM = Math.round(1 / ALIEN_EXPEDITION_FIND_CHANCE);
/** @deprecated Prefer ALIEN_MAX_BASE_COUNT. */
export const ALIEN_MAX_LIVING = ALIEN_MAX_BASE_COUNT;
/** @deprecated Prefer ALIEN_STRENGTH_MULT. */
export const ALIEN_SHIP_MULT = ALIEN_STRENGTH_MULT;
/** @deprecated Prefer ALIEN_STRENGTH_MULT. */
export const ALIEN_DEFENSE_MULT = ALIEN_STRENGTH_MULT;
/** @deprecated Prefer ALIEN_STRENGTH_MULT. */
export const ALIEN_FREE_SPAWN_MULT = ALIEN_STRENGTH_MULT;
/** @deprecated Prefer ALIEN_TECH_ABOVE_TOP_PLAYER. */
export const ALIEN_TECH_TOP_PLUS = ALIEN_TECH_ABOVE_TOP_PLAYER;
/** @deprecated Prefer ALIEN_MAX_LEVEL. */
export const ALIEN_LEVEL_CAP = ALIEN_MAX_LEVEL;

/** Fold Bridge base cooldown (wall-clock). Class / Beacon multiply. */
export const JUMP_GATE_BASE_COOLDOWN_MS = 300_000;

/** Class ship effect constants. */
export const VAULT_SCOUT_YIELD_PER = 0.05;
export const VAULT_SCOUT_YIELD_CAP = 10;
export const ASTROLABE_RESEARCH_TIME = 0.92;
export const SPOIL_SKIMMER_DEBRIS_FRAC = 0.15;
export const LINE_DRUMMER_SPEED_PER = 0.02;
export const LINE_DRUMMER_SPEED_CAP = 10;
export const VEIN_ANCHOR_MINE_PER = 0.03;
export const VEIN_ANCHOR_MINE_CAP = 10;
export const GRID_STAKE_ENERGY_PER = 0.04;
export const GRID_STAKE_ENERGY_CAP = 10;
export const FRONTIER_BEACON_JUMP_CD = 0.75;

/** Monthly season scoring. Calendar month is UTC `YYYY-MM`. */
export const SEASON_COMBAT_WIN = 10;
export const SEASON_COMBAT_PVE_WIN = 3;
/** Economy points = resources spent on completed buildings, ships, defenses, and research / this. */
export const SEASON_ECONOMY_SPEND_DIV = 1000;
export const SEASON_LEADERBOARD_TOP = 20;
export const SEASON_REWARD_TOP_N = 5;

/** Foundation Ark bootstrap building levels on successful colonize. */
export const FOUNDATION_ARK_BOOTSTRAP: Readonly<
  Partial<Record<BuildingId, number>>
> = {
  metalMine: 5,
  crystalMine: 5,
  deutSynth: 5,
  solarPlant: 5,
  metalStorage: 5,
  crystalStorage: 5,
  deutTank: 5,
  rigFoundry: 6,
};

/** Alliances foundation (backlog #7) — friends-scale social groups. */
export const ALLIANCE_TAG_MIN = 2;
export const ALLIANCE_TAG_MAX = 4;
export const ALLIANCE_NAME_MIN = 3;
export const ALLIANCE_NAME_MAX = 30;
export const ALLIANCE_MAX_MEMBERS = 16;
export const ALLIANCE_MAX_OFFICERS = 3;
export const ALLIANCE_CREATE_MIN_POINTS = 0;
/** Default join mode when creating an alliance. */
export const ALLIANCE_JOIN_MODE_DEFAULT: "open" | "invite" = "open";

/**
 * Newbie protection (Micah CHANGE #15): empire points below this are
 * protected from player raids and pirate NPC raids. Ends permanently
 * once empire points reach the threshold (no re-entry).
 */
export const NEWBIE_PROTECTION_POINTS = 2500;

/**
 * Pirate raid fairness (Micah CHANGE #18): players under this empire
 * points total get a reduced pick weight after each successful pirate
 * raid that UTC day. Does not apply to aliens.
 */
export const PIRATE_FAIRNESS_POINTS_MAX = 100_000;
/** Additive penalty per successful pirate raid that day (1% of original). */
export const PIRATE_FAIRNESS_PENALTY_PER_RAID = 0.01;
/** ACS / Joint Strike (backlog #8) — same-alliance synced raids. */
export const ACS_MAX_FLEETS = 8;
export const ACS_JOIN_WINDOW_MS = 15 * 60 * 1000;
export const ACS_HOLD_MAX_MS = 30 * 60 * 1000;
export const ACS_MIN_FLEETS_TO_RESOLVE = 1;
/** Drop resolved/cancelled ACS groups after this age on tick. */
export const ACS_GROUP_PRUNE_MS = 24 * 60 * 60 * 1000;
/**
 * Daily / weekly goals. Targets and rewards live here so balance edits
 * do not touch rules code. Display titles are original (no underscores).
 */
export type GoalMetric = "pirateWin" | "expedition";

export interface GoalTuning {
  id: string;
  cadence: GoalCadence;
  metric: GoalMetric;
  title: string;
  detail: string;
  target: number;
  starshards: number;
  metal: number;
  crystal: number;
  deuterium: number;
}

export const GOAL_DAILY_PIRATE_WINS = 3;
export const GOAL_DAILY_PIRATE_STARSHARDS = 25;
export const GOAL_DAILY_EXPEDITIONS = 5;
export const GOAL_DAILY_EXPEDITION_METAL = 2_000;
export const GOAL_DAILY_EXPEDITION_CRYSTAL = 1_000;
export const GOAL_DAILY_EXPEDITION_DEUTERIUM = 500;

export const GOAL_WEEKLY_PIRATE_WINS = 12;
export const GOAL_WEEKLY_PIRATE_STARSHARDS = 100;
export const GOAL_WEEKLY_EXPEDITIONS = 20;
export const GOAL_WEEKLY_EXPEDITION_METAL = 12_000;
export const GOAL_WEEKLY_EXPEDITION_CRYSTAL = 6_000;
export const GOAL_WEEKLY_EXPEDITION_DEUTERIUM = 3_000;

export const GOALS: readonly GoalTuning[] = [
  {
    id: "dailyPirateWins",
    cadence: "daily",
    metric: "pirateWin",
    title: "Pirate victories",
    detail: "Win pirate fights today. A win is destroying a pirate base or holding your colony against a pirate raid.",
    target: GOAL_DAILY_PIRATE_WINS,
    starshards: GOAL_DAILY_PIRATE_STARSHARDS,
    metal: 0,
    crystal: 0,
    deuterium: 0,
  },
  {
    id: "dailyExpeditions",
    cadence: "daily",
    metric: "expedition",
    title: "Expedition runs",
    detail: "Finish expedition flights today. The outbound arrival counts, including an empty find.",
    target: GOAL_DAILY_EXPEDITIONS,
    starshards: 0,
    metal: GOAL_DAILY_EXPEDITION_METAL,
    crystal: GOAL_DAILY_EXPEDITION_CRYSTAL,
    deuterium: GOAL_DAILY_EXPEDITION_DEUTERIUM,
  },
  {
    id: "weeklyPirateWins",
    cadence: "weekly",
    metric: "pirateWin",
    title: "Weekly pirate victories",
    detail: "Win pirate fights this week. A win is destroying a pirate base or holding your colony against a pirate raid.",
    target: GOAL_WEEKLY_PIRATE_WINS,
    starshards: GOAL_WEEKLY_PIRATE_STARSHARDS,
    metal: 0,
    crystal: 0,
    deuterium: 0,
  },
  {
    id: "weeklyExpeditions",
    cadence: "weekly",
    metric: "expedition",
    title: "Weekly expedition runs",
    detail: "Finish expedition flights this week. The outbound arrival counts, including an empty find.",
    target: GOAL_WEEKLY_EXPEDITIONS,
    starshards: 0,
    metal: GOAL_WEEKLY_EXPEDITION_METAL,
    crystal: GOAL_WEEKLY_EXPEDITION_CRYSTAL,
    deuterium: GOAL_WEEKLY_EXPEDITION_DEUTERIUM,
  },
];

/** Per-player ring buffer for synthetic empire alerts (builds, returns, raids, minis). */
export const EVENT_LOG_MAX = 100;
/** Same-galaxy system distance that counts as “nearby” for mini-planet sightings. */
export const EVENT_LOG_MINI_NEARBY_SYSTEM_RADIUS = 5;
/** Show an unread count on the Messages nav item. */
export const EVENT_LOG_UNREAD_BADGE = true;
/** Alliance chat + shared intel (backlog #12). */
export const ALLIANCE_CHAT_MAX_MESSAGES = 200;
export const ALLIANCE_CHAT_MAX_CHARS = 500;
export const ALLIANCE_CHAT_RATE_PER_MIN = 20;
export const ALLIANCE_INTEL_MAX_REPORTS = 50;
export const ALLIANCE_MARKERS_MAX = 30;
/** Galaxy marker lifetime. Lazy purge on read — no cron. */
export const ALLIANCE_MARKER_TTL_MS = 72 * 60 * 60 * 1000;
/** Marker / strike note cap. */
export const ALLIANCE_MARKER_NOTE_MAX = 80;
