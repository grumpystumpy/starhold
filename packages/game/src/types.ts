/** Shared game types — used by the server (authoritative) and later by the client. */

export type ResourceId = "metal" | "crystal" | "deuterium";

export type BuildingId =
  | "metalMine"
  | "crystalMine"
  | "deutSynth"
  | "solarPlant"
  | "metalStorage"
  | "crystalStorage"
  | "deutTank"
  | "shipyard";

export type ShipId = "scout" | "hauler" | "interceptor";

/** Basics-first missions: peaceful deploy (round-trip) and raid/attack. */
export type MissionType = "deploy" | "raid";

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

export interface Coordinates {
  galaxy: number;
  system: number;
  slot: number;
}

export type FleetShips = Record<ShipId, number>;

export interface FleetMission {
  id: string;
  ownerPlayerId: string;
  originPlanetId: string;
  targetPlanetId: string;
  targetPlayerId: string;
  mission: MissionType;
  ships: FleetShips;
  /** Loot or cargo carried on the return leg */
  cargo: Resources;
  departedAt: number;
  /** Next phase transition (arrival or return home) */
  arrivesAt: number;
  phase: FleetPhase;
  /** Set when raid resolves at the target */
  reportId: string | null;
}

export type CombatOutcome = "attacker_win" | "defender_win" | "draw";

export interface CombatReport {
  id: string;
  at: number;
  missionId: string;
  attackerPlayerId: string;
  defenderPlayerId: string;
  attackerName: string;
  defenderName: string;
  targetCoords: Coordinates;
  attackerBefore: FleetShips;
  attackerAfter: FleetShips;
  defenderBefore: FleetShips;
  defenderAfter: FleetShips;
  loot: Resources;
  outcome: CombatOutcome;
  summary: string;
}

export interface PlanetState {
  id: string;
  name: string;
  coords: Coordinates;
  resources: Resources;
  /** Last time production was applied (epoch ms) */
  lastTickAt: number;
  buildings: Record<BuildingId, number>;
  ships: Record<ShipId, number>;
  buildQueue: BuildQueueItem | null;
  shipQueue: ShipQueueItem | null;
}

export interface PlayerState {
  id: string;
  name: string;
  homePlanetId: string;
  createdAt: number;
}

export interface UniverseState {
  id: string;
  name: string;
  /** Economy speed factor (1 = realtime) */
  speed: number;
  /** Fleet travel speed factor (defaults to economy speed when omitted in older saves) */
  fleetSpeed: number;
  createdAt: number;
  players: Record<string, PlayerState>;
  planets: Record<string, PlanetState>;
  fleets: Record<string, FleetMission>;
  reports: Record<string, CombatReport>;
}

/** Snapshot returned to a specific player (full own planet + public roster). */
export interface PlayerView {
  now: number;
  universe: {
    id: string;
    name: string;
    speed: number;
    fleetSpeed: number;
  };
  player: PlayerState;
  planet: PlanetState;
  /** Derived production / energy for UI */
  economy: EconomySnapshot;
  roster: PublicPlayer[];
  /** Own active fleets (outbound / returning) */
  fleets: FleetMission[];
  /** Recent combat reports involving this player (newest first) */
  reports: CombatReport[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  coords: Coordinates;
  pointsHint: number;
  planetId: string;
}

export interface EconomySnapshot {
  productionPerHour: Resources;
  energy: { produced: number; used: number; factor: number };
  storage: Resources;
}
