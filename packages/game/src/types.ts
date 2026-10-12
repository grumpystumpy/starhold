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
  createdAt: number;
  players: Record<string, PlayerState>;
  planets: Record<string, PlanetState>;
}

/** Snapshot returned to a specific player (full own planet + public roster). */
export interface PlayerView {
  now: number;
  universe: {
    id: string;
    name: string;
    speed: number;
  };
  player: PlayerState;
  planet: PlanetState;
  /** Derived production / energy for UI */
  economy: EconomySnapshot;
  roster: PublicPlayer[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  coords: Coordinates;
  pointsHint: number;
}

export interface EconomySnapshot {
  productionPerHour: Resources;
  energy: { produced: number; used: number; factor: number };
  storage: Resources;
}
