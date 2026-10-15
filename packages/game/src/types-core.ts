/** Shared game types — used by the server (authoritative) and the client. */

export type ResourceId = "metal" | "crystal" | "deuterium";

export type BuildingId =
  | "metalMine"
  | "crystalMine"
  | "deutSynth"
  | "solarPlant"
  | "metalStorage"
  | "crystalStorage"
  | "deutTank"
  | "shipyard"
  | "researchLab"
  | "lunarBase"
  | "sensorArray"
  | "jumpGate"
  | "chronoLathe"
  | "mantleLoom"
  | "rigFoundry"
  | "riftSiphon"
  | "echoVault"
  | "anomalyForge"
  | "driftBeacon";

export type BodyKind = "planet" | "moon";

export type PlayerClassId =
  | "miner"
  | "explorer"
  | "fleeter"
  | "expansionist";

export interface PlayerClassState {
  classId: PlayerClassId | null;
  chosenAt: number | null;
  /** Increments on each paid change (not first pick). */
  changeCount: number;
  lastChangeAt: number | null;
}

export type ShipId =
  | "scout"
  | "hauler"
  | "interceptor"
  | "cruiser"
  | "bomber"
  | "probe"
  | "recycler"
  | "colonyShip"
  | "voidforgeTitan"
  | "worldEater"
  | "swarmDrone"
  | "swarmHarvester"
  | "swarmMothership"
  | "helioBuoy"
  | "keelSovereign"
  | "rakeCorsair"
  | "anvilDread"
  | "wardbreaker"
  | "vaultScout"
  | "astrolabeWing"
  | "spoilSkimmer"
  | "lineDrummer"
  | "veinAnchor"
  | "gridStake"
  | "foundationArk"
  | "frontierBeacon";

export type DefenseId =
  | "laserBattery"
  | "shieldDome"
  | "needleTurret"
  | "arcLattice"
  | "pulseBastion"
  | "gaussRail"
  | "ionSheath"
  | "plasmaSpire"
  | "flakCurtain"
  | "kineticFence"
  | "emberMortar"
  | "rippleArray"
  | "haloProjector"
  | "crownAegis"
  | "siegeBlockade"
  | "frostLance"
  | "voidWard";

export type ResearchId =
  | "energyTech"
  | "combustionDrive"
  | "weaponsTech"
  | "armourTech"
  | "shieldingTech"
  | "espionageTech"
  | "astrophysics"
  | "computerTech"
  | "queueLogistics"
  | "swarmHold"
  | "gravityWell";

export type QueueKind = "building" | "ship" | "defense" | "research";

/**
 * Missions:
 * - deploy / raid — existing basics
 * - transport — move cargo between own planets
 * - espionage — probe report at target
 * - colonize — found colony on empty slot
 * - harvest — collect debris with Salvage Trawlers or Mothership
 * - harvestAsteroid — mine asteroid field with Salvage Trawlers
 * - expedition — deep-space probe (resources / ships / nothing / pirates / starshards)
 * - pirateRaid — attack an NPC pirate base
 * - alienRaid — attack an NPC alien base
 * - jump — instant moon→moon hop via Fold Bridge (own moons)
 */
export type MissionType =
  | "deploy"
  | "raid"
  | "transport"
  | "espionage"
  | "colonize"
  | "harvest"
  | "harvestAsteroid"
  | "expedition"
  | "pirateRaid"
  | "alienRaid"
  | "jump";

export type FleetPhase = "outbound" | "holding" | "returning";

/** ACS / Joint Strike group status. */
export type AcsGroupStatus = "open" | "locked" | "resolved" | "cancelled";

export interface AcsGroup {
  id: string;
  allianceId: string;
  leaderPlayerId: string;
  mission: "raid" | "pirateRaid";
  targetCoords: Coordinates;
  targetPlanetId: string | null;
  targetPlayerId: string | null;
  targetPirateBaseId?: string | null;
  /** Join order; [0] is leader fleet. */
  fleetIds: string[];
  createdAt: number;
  joinClosesAt: number;
  /** Set when locked — max member arrivesAt. */
  resolvesAt: number | null;
  status: AcsGroupStatus;
}

/** Fleet composition templates (per player, per universe). */
export type FleetPresetIntent =
  | "expedition"
  | "raid"
  | "moonDestruction"
  | "miniCapture"
  | "miniDestroy"
  | "custom";

export interface FleetPreset {
  id: string;
  name: string;
  /** Ship type → count. Display names come from the ship catalog (Colonizer, Mothership, …). */
  ships: Partial<FleetShips>;
  builtIn: boolean;
  intent: FleetPresetIntent;
}

export interface Resources {
  metal: number;
  crystal: number;
  deuterium: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  /** Base cost at level 0 → 1 */
  baseCost: Resources;
  /** Cost multiplier per level */
  costGrowth: number;
  /** Seconds to build level 1 (grows with costGrowth) */
  baseBuildSeconds: number;
  /** Energy this building consumes at a given level (mines) */
  energyUsePerLevel?: number;
  /** Energy this building produces at a given level (solar) */
  energyProdFormula?: "solar";
  /** Resource this mine produces */
  produces?: ResourceId;
  /** Soft/hard max level (mini specials). */
  maxLevel?: number;
}

export interface ShipDef {
  id: ShipId;
  name: string;
  description: string;
  cost: Resources;
  buildSeconds: number;
  /** Minimum shipyard level required */
  shipyardLevel: number;
  cargo: number;
  /** Combat / travel (invented — not scraped genre values) */
  attack: number;
  shield: number;
  hull: number;
  /** Higher = faster travel */
  speed: number;
  /** Deuterium burned per distance unit (one-way) */
  fuelPerDistance: number;
  /** Minimum research levels to queue at shipyard (v1 Round 2). */
  researchReq?: Partial<Record<ResearchId, number>>;
  /**
   * When true, hull must ride with a Mothership (not free-flying alone).
   * Count toward mothership swarm capacity.
   */
  swarmCarried?: boolean;
  /** Cannot join fleets / launch (Helio Buoy, Vein Anchor, Grid Stake). */
  stationary?: boolean;
  /** Buildable only when playerClass.classId matches. */
  classExclusive?: PlayerClassId;
  /** Orbital energy platform — contributes energy, no missions. */
  orbitalEnergy?: boolean;
  /** Destroyed units do not create debris (Helio Buoy v1). */
  noDebris?: boolean;
}

export interface DefenseDef {
  id: DefenseId;
  name: string;
  description: string;
  cost: Resources;
  buildSeconds: number;
  /** Minimum shipyard level */
  shipyardLevel: number;
  attack: number;
  shield: number;
  hull: number;
  /** Soft UI hint: recommend ≤1 of this id per planet (Halo / Crown). */
  uniqueHint?: boolean;
  /** Slot-band attack multiplier when planet.coords.slot in range. */
  slotAttackBonus?: { slots: number[]; factor: number };
}

export interface ResearchDef {
  id: ResearchId;
  name: string;
  description: string;
  baseCost: Resources;
  costGrowth: number;
  baseResearchSeconds: number;
  /** Lab level required to start level 1 */
  labLevel: number;
}

export interface QueueItemBase {
  id: string;
  kind: QueueKind;
  enqueuedAt: number;
  /** Wall-clock ms when the front item finishes; recomputed when an item starts. */
  completesAt: number;
  /** Seconds of work once this item is at the front. */
  workSeconds: number;
  /** Set when this item becomes the active front item. */
  startedAt: number | null;
  /** Resources spent when enqueued (for cancel refunds). */
  paidCost: Resources;
  /** Seconds remaining snapshot for UI (optional; server is source of truth). */
  remainingSeconds?: number;
}

export interface BuildQueueItem extends QueueItemBase {
  kind: "building";
  buildingId: BuildingId;
  targetLevel: number;
}

export interface ShipQueueItem extends QueueItemBase {
  kind: "ship";
  shipId: ShipId;
  count: number;
  /** Seconds per unit (for UI remaining estimate) */
  unitSeconds: number;
}

export interface DefenseQueueItem extends QueueItemBase {
  kind: "defense";
  defenseId: DefenseId;
  count: number;
  unitSeconds: number;
}

export interface ResearchQueueItem extends QueueItemBase {
  kind: "research";
  researchId: ResearchId;
  targetLevel: number;
}

export interface Coordinates {
  galaxy: number;
  system: number;
  slot: number;
}

/** Debris vs asteroid harvest target (API / mission hooks). */
export type HarvestTarget =
  | { kind: "debris"; coords: Coordinates }
  | { kind: "asteroid"; asteroidId: string };

export type FleetShips = Record<ShipId, number>;
export type DefenseStock = Record<DefenseId, number>;
export type ResearchLevels = Record<ResearchId, number>;

export interface FleetMission {
  id: string;
  ownerPlayerId: string;
  originPlanetId: string;
  /** Set when targeting an occupied planet; null for empty-slot colonize/harvest */
  targetPlanetId: string | null;
  targetPlayerId: string | null;
  targetCoords: Coordinates;
  /** Set for harvestAsteroid missions. */
  targetAsteroidId?: string | null;
  /** Set for pirateRaid missions. */
  targetPirateBaseId?: string | null;
  /** Set for alienRaid missions. */
  targetAlienBaseId?: string | null;
  mission: MissionType;
  ships: FleetShips;
  /** Loot, transport cargo, or harvest haul on the return leg */
  cargo: Resources;
  departedAt: number;
  /** Next phase transition (arrival or return home) */
  arrivesAt: number;
  phase: FleetPhase;
  /** Combat or espionage report id when relevant */
  reportId: string | null;
  /** Joint Strike (ACS) group id when participating. */
  acsGroupId?: string | null;
  /** In-flight / parked Mothership drone production job. */
  swarmProduce?: {
    remaining: number;
    unitSeconds: number;
    progressAt: number;
  } | null;
}

/** Mineable asteroid field (not a PlanetState). */
export interface AsteroidField {
  id: string;
  coords: Coordinates;
  metal: number;
  crystal: number;
  deuterium: number;
  /** Remaining harvest cycles before despawn (v1). */
  richness: number;
}

/** NPC pirate base stub (thread E fills behavior). */
/** Pirate combat techs — kept low vs players. */
export interface PirateTechs {
  weapons: number;
  armour: number;
  shielding: number;
}

/**
 * NPC pirate base (Micah redesign §5): levels to 100, defenses, 3h free ships,
 * split/coalition, hourly random nextRaidAt.
 */
export interface PirateBase {
  id: string;
  coords: Coordinates;
  name: string;
  /** Growth tier; kept in sync with `level`. */
  tier: number;
  /** Alias of `tier` (0..PIRATE_MAX_LEVEL). */
  level: number;
  ships: FleetShips;
  /** Accumulated static defenses (level grants + 3h free-spawn). */
  defenses: DefenseStock;
  resources: Resources;
  techs: PirateTechs;
  lastGrewAt: number;
  lastRaidAt: number;
  /** Random time within the current/next hour window. */
  nextRaidAt: number;
  /** Cadence for free weak-ship + defense spawns (3h). */
  lastFreeSpawnAt: number;
  destroyedAt: number | null;
  /** Split lineage root — same coalition never raids each other. */
  coalitionId: string;
  /** True after the one-time split at PIRATE_SPLIT_LEVEL. */
  splitDone: boolean;
}

/**
 * Alien base (§5b) — same growth path; split at 50; tech = top+1.
 * Zero at universe start; appear only via expedition find.
 */
export interface AlienBase {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  level: number;
  ships: FleetShips;
  defenses: DefenseStock;
  resources: Resources;
  techs: PirateTechs;
  lastGrewAt: number;
  lastRaidAt: number;
  nextRaidAt: number;
  lastFreeSpawnAt: number;
  destroyedAt: number | null;
  coalitionId: string;
  splitDone: boolean;
  /** Wall-clock when buildup ends; raids locked until then. */
  buildupEndsAt: number;
  foundAt: number;
  foundByPlayerId: string;
}

/** Mothership occupation of an enemy body (Round 2). */
export interface OccupationState {
  planetId: string;
  occupierPlayerId: string;
  mothershipFleetId: string;
  startedAt: number;
  endsAt: number;
}

/** Post-battle choice after winning on a colonized mini (destroy needs ≥1 World Eater). */
export type MiniPlanetResolveChoice = "capture" | "destroy";

export interface SlotProductionMult {
  metal: number;
  crystal: number;
  deuterium: number;
  energy: number;
}

export type OfficerId =
  | "quartermaster"
  | "archivist"
  | "navigator"
  | "warden"
  | "engineer"
  | "spymaster";

export type OfficerEffectKind =
  | "mineOutput"
  | "researchSpeed"
  | "fleetSpeed"
  | "fleetSlots"
  | "defensePower"
  | "energyOutput"
  | "espionageLevel";

export interface OfficerEffect {
  kind: OfficerEffectKind;
  /** Multiplier (e.g. 1.10) or flat add (fleetSlots / espionageLevel). */
  value: number;
}

export interface OfficerDef {
  id: OfficerId;
  name: string;
  description: string;
  /** Starshard cost to activate / renew. */
  cost: number;
  /** Duration ms; v1 officers are timed. */
  durationMs: number;
  effects: OfficerEffect[];
}

/** Active officer hire on a player. */
export interface OfficerState {
  officerId: OfficerId;
  activatedAt: number;
  expiresAt: number;
}

export type SkillBranch = "economy" | "military" | "exploration";

export interface SkillNodeDef {
  id: string;
  branch: SkillBranch;
  name: string;
  description: string;
  /** Starshard unlock cost. */
  cost: number;
  requires: string[];
  effects: OfficerEffect[];
}
