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
  | "chronoLathe";

export type BodyKind = "planet" | "moon";

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
  | "swarmMothership";

export type DefenseId = "laserBattery" | "shieldDome";

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
  | "swarmHold";

export type QueueKind = "building" | "ship" | "defense" | "research";

/**
 * Missions:
 * - deploy / raid — existing basics
 * - transport — move cargo between own planets
 * - espionage — probe report at target
 * - colonize — found colony on empty slot
 * - harvest — collect debris with Salvage Trawlers or Swarm Mothership
 * - harvestAsteroid — mine asteroid field with Salvage Trawlers
 * - expedition — deep-space probe (resources / ships / nothing / pirates / starshards)
 * - pirateRaid — attack an NPC pirate base
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
  | "jump";

export type FleetPhase = "outbound" | "returning";

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
  /** Ship type → count. Display names come from the ship catalog (Outpost Cradle, Swarm Mothership, …). */
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
   * When true, hull must ride with a Swarm Mothership (not free-flying alone).
   * Count toward mothership swarm capacity.
   */
  swarmCarried?: boolean;
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
  /** In-flight / parked Swarm Mothership drone production job. */
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
export interface PirateBase {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  ships: FleetShips;
  resources: Resources;
  lastGrewAt: number;
  lastRaidAt: number;
  destroyedAt: number | null;
}

/** Swarm Mothership occupation of an enemy body (Round 2). */
export interface OccupationState {
  planetId: string;
  occupierPlayerId: string;
  mothershipFleetId: string;
  startedAt: number;
  endsAt: number;
}

/** Post-battle choice when ≥5 World Eaters win on a mini planet (K wires full flow). */
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
