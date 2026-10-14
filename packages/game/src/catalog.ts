import type { BuildingId, DefenseId, ResearchId, ShipId } from "./types.js";

export { BUILDINGS } from "./catalog-buildings.js";
export { SHIPS, DEFENSES } from "./catalog-units.js";
export { RESEARCH } from "./catalog-research.js";
export {
  RAPID_FIRE,
  rapidFireFactor,
  type CombatUnitId,
} from "./catalog-rapid-fire.js";
export {
  OFFICERS,
  OFFICER_ORDER,
  OFFICER_DURATION_MS,
} from "./catalog-officers.js";
export { SKILLS, SKILL_ORDER } from "./catalog-skills.js";

/** Starshards earn (non-pirate; pirate amounts live next to PIRATE_* below). */
export const STARSHARDS_DAILY_LOGIN = 15;
export const STARSHARDS_HIGHSCORE_TOP3 = 50;
/** Expedition table: 5% chance of a Starshard find. */
export const EXPEDITION_STARSHARDS_CHANCE_PCT = 5;

/** Max simultaneous fire exchanges in a raid. */
export const MAX_COMBAT_ROUNDS = 6;

/** Share of defender stockpile eligible for loot on an attacker win. */
export const RAID_LOOT_SHARE = 0.5;

/** Fraction of destroyed ship metal/crystal that becomes debris. */
export const DEBRIS_FROM_SHIPS = 0.3;

/** Minimum one-way flight seconds after speed scaling. */
export const MIN_FLIGHT_SECONDS = 8;

/**
 * Legacy flat field budget (prototype). Prefer per-planet `fieldsCap`
 * from `rollPlanetFields` (universe contract v1).
 */
export const PLANET_FIELDS = 200;

/** Half-width of the per-slot field roll band (v1 tunable). */
export const FIELD_BAND = 15;

/** Hard floor after band roll (slots 1 and 15). */
export const FIELD_MIN = 250;

/** Center field budget by planet slot (1–15). Peak at slot 8. */
export const FIELD_CENTER_BY_SLOT: Readonly<Record<number, number>> = {
  1: 265,
  2: 290,
  3: 315,
  4: 335,
  5: 350,
  6: 362,
  7: 372,
  8: 385,
  9: 372,
  10: 362,
  11: 350,
  12: 335,
  13: 315,
  14: 290,
  15: 265,
};

/** Moon field budget: base free field + per Crater Hab (`lunarBase`) level. */
export const MOON_FIELDS_BASE = 1;
export const MOON_FIELDS_PER_LUNAR_BASE = 3;

/** Minimum debris (metal+crystal) before a moon can form. */
export const MOON_DEBRIS_MIN = 5000;

/** Cap on moon-formation chance percent. */
export const MOON_CHANCE_CAP = 20;

/** Wall-clock TTL for espionage reports before prune. */
export const SPY_REPORT_TTL_MS = 20 * 60 * 1000;

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
  "lunarBase",
  "sensorArray",
  "jumpGate",
  "chronoLathe",
  "mantleLoom",
  "rigFoundry",
  "riftSiphon",
  "echoVault",
  "anomalyForge",
  "driftBeacon",
];

/** Buildings shown / allowed on normal planets. */
export const PLANET_BUILDING_ORDER: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
  "researchLab",
  "rigFoundry",
  "mantleLoom",
  "chronoLathe",
];

/** Buildings shown / allowed on moons. */
export const MOON_BUILDING_ORDER: BuildingId[] = [
  "lunarBase",
  "sensorArray",
  "jumpGate",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
];

/**
 * Mini planets: specials + Solar Array + storages + Shipyard.
 * Mines, lab, moon buildings, Mantle Loom / Rig Foundry / Chrono Lathe blocked.
 */
export const MINI_BUILDING_ORDER: BuildingId[] = [
  "riftSiphon",
  "echoVault",
  "anomalyForge",
  "driftBeacon",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
];

export const SHIP_ORDER: ShipId[] = [
  "scout",
  "hauler",
  "interceptor",
  "cruiser",
  "bomber",
  "probe",
  "recycler",
  "colonyShip",
  "helioBuoy",
  "keelSovereign",
  "rakeCorsair",
  "anvilDread",
  "wardbreaker",
  "vaultScout",
  "astrolabeWing",
  "spoilSkimmer",
  "lineDrummer",
  "veinAnchor",
  "gridStake",
  "foundationArk",
  "frontierBeacon",
  "voidforgeTitan",
  "worldEater",
  "swarmDrone",
  "swarmHarvester",
  "swarmMothership",
];

export const DEFENSE_ORDER: DefenseId[] = [
  "laserBattery",
  "shieldDome",
  "needleTurret",
  "arcLattice",
  "pulseBastion",
  "gaussRail",
  "ionSheath",
  "plasmaSpire",
  "flakCurtain",
  "kineticFence",
  "emberMortar",
  "rippleArray",
  "haloProjector",
  "crownAegis",
  "siegeBlockade",
  "frostLance",
  "voidWard",
];

export const RESEARCH_ORDER: ResearchId[] = [
  "energyTech",
  "combustionDrive",
  "weaponsTech",
  "armourTech",
  "shieldingTech",
  "espionageTech",
  "astrophysics",
  "computerTech",
  "queueLogistics",
  "swarmHold",
  "gravityWell",
];

/** Hard cap per queue kind (Round 2 contract v1). */
export const QUEUE_HARD_CAP = 8;

/** Base queue lengths before Yard Logistics / officers / skills. */
export const QUEUE_BASE_LENGTH = {
  building: 2,
  ship: 2,
  defense: 2,
  research: 1,
} as const;


/** Round 2 combat/economy constants — defined in `data/tuning.ts` (lane c). */
export {
  SWARM_CAPACITY_BASE,
  SWARM_HOLD_BONUS_PER_LEVEL,
  SWARM_CAPACITY_HARD_CAP,
  CHRONO_LATHE_TIME_BASE,
  CHRONO_LATHE_SHIPYARD_REQ,
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  RIG_FOUNDRY_TIME_PER_LEVEL,
  RIG_FOUNDRY_TIME_FLOOR,
  RIG_FOUNDRY_SHIPYARD_REQ,
  MANTLE_LOOM_FIELDS_PER_LEVEL,
  MANTLE_LOOM_FIELDS_USED,
  MANTLE_LOOM_SOLAR_REQ,
  MANTLE_LOOM_LAB_REQ,
  SLOT_TEMPERATURE_K,
  SOLAR_TEMP_BASELINE_K,
  CLASS_CHANGE_BASE_COST,
  CLASS_CHANGE_COST_PER_PRIOR,
  CLASS_CHANGE_COOLDOWN_MS,
  PLAYER_CLASS_ORDER,
  PLAYER_CLASS_BONUSES,
  JUMP_GATE_BASE_COOLDOWN_MS,
  VAULT_SCOUT_YIELD_PER,
  VAULT_SCOUT_YIELD_CAP,
  ASTROLABE_RESEARCH_TIME,
  SPOIL_SKIMMER_DEBRIS_FRAC,
  LINE_DRUMMER_SPEED_PER,
  LINE_DRUMMER_SPEED_CAP,
  VEIN_ANCHOR_MINE_PER,
  VEIN_ANCHOR_MINE_CAP,
  GRID_STAKE_ENERGY_PER,
  GRID_STAKE_ENERGY_CAP,
  FRONTIER_BEACON_JUMP_CD,
  FOUNDATION_ARK_BOOTSTRAP,
  SWARM_NUMBERS_THRESHOLD,
  SWARM_NUMBERS_BONUS_PER,
  SWARM_NUMBERS_BONUS_CAP_COUNT,
  SWARM_INTERCEPT_FRACTION,
  SWARM_INTERCEPT_SPLIT,
  SWARM_KAMIKAZE_HULL_FRAC,
  SWARM_KAMIKAZE_SHIELD_DMG,
  SWARM_KAMIKAZE_HULL_DMG,
  OCCUPATION_DURATION_MS,
  OCCUPATION_OCCUPIER_SHARE,
  OCCUPATION_OWNER_SHARE,
  MINI_WORLD_EATER_MIN,
  MINI_SLOT_MIN,
  MINI_SLOT_MAX,
  MINI_SYSTEMS_PER,
  MINI_FIELDS_MIN,
  MINI_FIELDS_MAX,
  MINI_DESTROY_RESOURCE_MULT,
  MINI_DESTROY_DEBRIS_FRAC,
  RIFT_SIPHON_MINE_PER,
  ECHO_VAULT_STORAGE_PER,
  ANOMALY_FORGE_SHIP_TIME_PER,
} from "./data/tuning.js";

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

/** Map bounds (universe contract v1): 10×399×15 + deep space. */
export const MAP_GALAXIES = 10;
export const MAP_SYSTEMS = 399;
export const MAP_SLOTS = 15;

/** Deep-space / expedition slot — not colonizable. */
export const DEEP_SPACE_SLOT = 16;
export const EXPEDITION_SLOT = DEEP_SPACE_SLOT;

/**
 * KV / UniverseState schema version.
 * Prototype blobs without this field are treated as `1`.
 * Contract map resize (1×9×8 → 10×399×15) requires reset at `2`.
 * Round 2 (queues / levels / ships / mini / pirates) bumps to `3` via
 * additive migrator — no map reset.
 * Round 3 (classes / catalog / temp) bumps to `4` via additive migrator.
 */
export const UNIVERSE_SCHEMA_VERSION = 4;

/** Homeworld join: prefer mid slots, then fall outward. */
export const HOME_SLOT_PREFERENCE: readonly number[] = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 3, 13, 2, 14, 1, 15,
];

/** Asteroids per system roll weights (v1): 0 / 1 / 2. */
export const ASTEROID_COUNT_WEIGHTS = [
  { count: 0, weight: 70 },
  { count: 1, weight: 25 },
  { count: 2, weight: 5 },
] as const;

/** Harvest cycles before an asteroid field despawns. */
export const ASTEROID_RICHNESS = 3;

/**
 * Position production multipliers by slot (slot 8 = 1.0× on all axes).
 * Applied after mine level / energy factor / PRODUCTION_MULT.
 */
export const SLOT_PRODUCTION_MULT: Readonly<
  Record<
    number,
    {
      metal: number;
      crystal: number;
      deuterium: number;
      energy: number;
    }
  >
> = {
  1: { metal: 1.0, crystal: 1.3, deuterium: 0.7, energy: 1.3 },
  2: { metal: 1.0, crystal: 1.25, deuterium: 0.75, energy: 1.25 },
  3: { metal: 1.0, crystal: 1.2, deuterium: 0.8, energy: 1.2 },
  4: { metal: 1.0, crystal: 1.15, deuterium: 0.85, energy: 1.15 },
  5: { metal: 1.0, crystal: 1.1, deuterium: 0.9, energy: 1.1 },
  6: { metal: 1.0, crystal: 1.05, deuterium: 0.95, energy: 1.05 },
  7: { metal: 1.0, crystal: 1.02, deuterium: 0.98, energy: 1.02 },
  8: { metal: 1.0, crystal: 1.0, deuterium: 1.0, energy: 1.0 },
  9: { metal: 1.0, crystal: 0.98, deuterium: 1.02, energy: 0.98 },
  10: { metal: 1.0, crystal: 0.95, deuterium: 1.05, energy: 0.95 },
  11: { metal: 1.0, crystal: 0.9, deuterium: 1.1, energy: 0.9 },
  12: { metal: 1.0, crystal: 0.85, deuterium: 1.15, energy: 0.85 },
  13: { metal: 1.0, crystal: 0.8, deuterium: 1.2, energy: 0.8 },
  14: { metal: 1.0, crystal: 0.75, deuterium: 1.25, energy: 0.75 },
  15: { metal: 1.0, crystal: 0.7, deuterium: 1.3, energy: 0.7 },
};

/** ~1 pirate base per N systems (≈100 / 10×399 map). */
export const PIRATE_SYSTEMS_PER_BASE = 40;

/** Growth: tier +1 every interval, capped. */
export const PIRATE_GROWTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PIRATE_TIER_CAP = 8;

/** After player destroy: respawn delay elsewhere (inclusive range). */
export const PIRATE_RESPAWN_DELAY_MIN_MS = 12 * 60 * 60 * 1000;
export const PIRATE_RESPAWN_DELAY_MAX_MS = 36 * 60 * 60 * 1000;

/** NPC raid cadence (inclusive range). */
export const PIRATE_RAID_INTERVAL_MIN_MS = 8 * 60 * 60 * 1000;
export const PIRATE_RAID_INTERVAL_MAX_MS = 24 * 60 * 60 * 1000;

/** Starshards: destroy base = base + per-tier; win defense vs pirate raid. */
export const PIRATE_DESTROY_STARSHARDS_BASE = 40;
export const PIRATE_DESTROY_STARSHARDS_PER_TIER = 5;
export const PIRATE_DEFENSE_WIN_STARSHARDS = 10;

/**
 * Soft cap for NPC raid detachment vs small empires:
 * raid power ≤ defenderPower × factor + floor (v1).
 */
export const PIRATE_RAID_POWER_FACTOR = 1.4;
export const PIRATE_RAID_POWER_FLOOR = 40;
