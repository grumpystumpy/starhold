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
  | "researchLab";

export type ShipId =
  | "scout"
  | "hauler"
  | "interceptor"
  | "cruiser"
  | "bomber"
  | "probe"
  | "recycler"
  | "colonyShip";

export type DefenseId = "laserBattery" | "shieldDome";

export type ResearchId =
  | "energyTech"
  | "combustionDrive"
  | "weaponsTech"
  | "armourTech"
  | "shieldingTech"
  | "espionageTech"
  | "astrophysics"
  | "computerTech";

/**
 * Missions:
 * - deploy / raid — existing basics
 * - transport — move cargo between own planets
 * - espionage — probe report at target
 * - colonize — found colony on empty slot
 * - harvest — collect debris with recyclers
 */
export type MissionType =
  | "deploy"
  | "raid"
  | "transport"
  | "espionage"
  | "colonize"
  | "harvest";

export type FleetPhase = "outbound" | "returning";

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

export interface BuildQueueItem {
  kind: "building";
  buildingId: BuildingId;
  completesAt: number;
  targetLevel: number;
}

export interface ShipQueueItem {
  kind: "ship";
  shipId: ShipId;
  count: number;
  completesAt: number;
  /** Seconds per unit (for UI remaining estimate) */
  unitSeconds: number;
}

export interface DefenseQueueItem {
  kind: "defense";
  defenseId: DefenseId;
  count: number;
  completesAt: number;
  unitSeconds: number;
}

export interface ResearchQueueItem {
  kind: "research";
  researchId: ResearchId;
  completesAt: number;
  targetLevel: number;
}

export interface Coordinates {
  galaxy: number;
  system: number;
  slot: number;
}

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
}
