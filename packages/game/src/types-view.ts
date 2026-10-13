import type {
  BuildingId,
  BuildQueueItem,
  Coordinates,
  DefenseQueueItem,
  DefenseStock,
  FleetMission,
  FleetShips,
  ResearchLevels,
  ResearchQueueItem,
  Resources,
  ShipId,
  ShipQueueItem,
} from "./types-core.js";


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
  defensesBefore: DefenseStock;
  defensesAfter: DefenseStock;
  loot: Resources;
  debrisCreated: Resources;
  outcome: CombatOutcome;
  /** Fire exchanges resolved (0 = unopposed / empty attacker). */
  rounds: number;
  summary: string;
}

export interface EspionageReport {
  id: string;
  at: number;
  missionId: string;
  spyPlayerId: string;
  targetPlayerId: string;
  targetName: string;
  targetCoords: Coordinates;
  /** How much detail was revealed (0–3) */
  detail: number;
  resources: Resources | null;
  buildings: Partial<Record<BuildingId, number>> | null;
  ships: Partial<FleetShips> | null;
  defenses: Partial<DefenseStock> | null;
  research: Partial<ResearchLevels> | null;
  summary: string;
}

export interface DebrisField {
  coords: Coordinates;
  metal: number;
  crystal: number;
}

export interface PlanetState {
  id: string;
  ownerPlayerId: string;
  name: string;
  coords: Coordinates;
  resources: Resources;
  /** Last time production was applied (epoch ms) */
  lastTickAt: number;
  buildings: Record<BuildingId, number>;
  ships: Record<ShipId, number>;
  defenses: DefenseStock;
  buildQueue: BuildQueueItem | null;
  shipQueue: ShipQueueItem | null;
  defenseQueue: DefenseQueueItem | null;
}

export interface PlayerState {
  id: string;
  name: string;
  homePlanetId: string;
  /** All owned planets (home first). */
  planetIds: string[];
  /** Currently selected planet for UI/actions. */
  activePlanetId: string;
  research: ResearchLevels;
  researchQueue: ResearchQueueItem | null;
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
  spyReports: Record<string, EspionageReport>;
  /** Keyed by "g:s:slot" */
  debris: Record<string, DebrisField>;
}

/** One slot in the galaxy/system browser. */
export interface GalaxySlot {
  coords: Coordinates;
  planetId: string | null;
  playerId: string | null;
  playerName: string | null;
  pointsHint: number;
  debris: { metal: number; crystal: number } | null;
  isOwn: boolean;
}

export interface GalaxyView {
  galaxy: number;
  system: number;
  slots: GalaxySlot[];
}

/** Snapshot returned to a specific player (active planet + public roster). */
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
  /** All owned planets (for switcher / transport targets). */
  ownedPlanets: Array<{
    id: string;
    name: string;
    coords: Coordinates;
    isHome: boolean;
    isActive: boolean;
  }>;
  /** Derived production / energy for UI */
  economy: EconomySnapshot;
  roster: PublicPlayer[];
  galaxy: GalaxyView;
  /** Own active fleets (outbound / returning) */
  fleets: FleetMission[];
  /** Recent combat reports involving this player (newest first) */
  reports: CombatReport[];
  /** Recent espionage reports for this player */
  spyReports: EspionageReport[];
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
  /** Building-level field budget (soft-cap). */
  fields: { used: number; cap: number; remaining: number };
}
