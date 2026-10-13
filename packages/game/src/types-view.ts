import type {
  AsteroidField,
  BodyKind,
  BuildingId,
  BuildQueueItem,
  Coordinates,
  DefenseQueueItem,
  DefenseStock,
  FleetMission,
  FleetShips,
  OfficerState,
  PirateBase,
  ResearchLevels,
  ResearchQueueItem,
  Resources,
  ShipId,
  ShipQueueItem,
  SlotProductionMult,
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
  /** Set when this raid formed a moon at the target planet. */
  moonFormed?: boolean;
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

export type ExpeditionKind = "resources" | "ships" | "nothing" | "pirates";

export interface ExpeditionReport {
  id: string;
  at: number;
  missionId: string;
  playerId: string;
  targetCoords: Coordinates;
  kind: ExpeditionKind;
  /** Resources loaded onto the fleet (before return). */
  cargoGained: Resources;
  /** Net ship deltas applied at the anomaly (positive = found). */
  shipsDelta: Partial<FleetShips>;
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
  /** Defaults to planet when omitted (older saves). */
  kind?: BodyKind;
  /** Set on moons — id of the parent planet. */
  parentPlanetId?: string | null;
  /** Set on planets — id of the linked moon, if any. */
  moonId?: string | null;
  /** Rolled field cap for planets; moons compute from lunarBase. */
  fieldsCap?: number;
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
  /** Premium currency (thread D spends; A stubs 0). */
  starshards?: number;
  /** Active officers (thread D; A stubs []). */
  officers?: OfficerState[];
  /** Unlocked skill node ids (thread D; A stubs []). */
  skillsUnlocked?: string[];
}

export interface UniverseState {
  id: string;
  name: string;
  /** Economy speed factor (1 = realtime) */
  speed: number;
  /** Fleet travel speed factor (defaults to economy speed when omitted in older saves) */
  fleetSpeed: number;
  createdAt: number;
  /**
   * Persistence schema version. Missing ⇒ treat as `1` (prototype map).
   * Contract map = `2` (`UNIVERSE_SCHEMA_VERSION`).
   */
  schemaVersion?: number;
  /** Deterministic seed for fields / asteroids rolls. */
  seed?: string;
  players: Record<string, PlayerState>;
  planets: Record<string, PlanetState>;
  fleets: Record<string, FleetMission>;
  reports: Record<string, CombatReport>;
  spyReports: Record<string, EspionageReport>;
  expeditionReports: Record<string, ExpeditionReport>;
  /** Keyed by "g:s:slot" */
  debris: Record<string, DebrisField>;
  /** Mineable asteroid fields keyed by id. */
  asteroids?: Record<string, AsteroidField>;
  /** NPC pirate bases (thread E; A may leave empty). */
  pirateBases?: Record<string, PirateBase>;
}

/** Coarse pirate threat for galaxy UI (thread E fills). */
export interface PirateBasePublic {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  threatHint: "low" | "medium" | "high";
}

/** One slot in the galaxy/system browser. */
export interface GalaxySlot {
  coords: Coordinates;
  planetId: string | null;
  playerId: string | null;
  playerName: string | null;
  allianceTag: string | null;
  pointsHint: number;
  debris: { metal: number; crystal: number } | null;
  isOwn: boolean;
  /** Linked moon at this slot, if any. */
  hasMoon: boolean;
  moonId: string | null;
  /** Empty | occupied | npc markers for UI */
  activity: "empty" | "planet" | "pirate" | null;
}

export interface GalaxyView {
  galaxy: number;
  system: number;
  slots: GalaxySlot[];
  deepSpace: { coords: Coordinates };
  asteroids: AsteroidField[];
  pirateBase: PirateBasePublic | null;
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
    isMoon: boolean;
  }>;
  /** Derived production / energy for UI */
  economy: EconomySnapshot;
  roster: PublicPlayer[];
  /** Empire points ranking (all players, points desc). */
  highscores: HighscoreEntry[];
  galaxy: GalaxyView;
  /** Own active fleets (outbound / returning) */
  fleets: FleetMission[];
  /** Recent combat reports involving this player (newest first) */
  reports: CombatReport[];
  /** Recent espionage reports for this player */
  spyReports: EspionageReport[];
  /** Recent deep-space expedition reports */
  expeditionReports: ExpeditionReport[];
  /**
   * Outbound fleets targeting this moon's system when Sensor Array ≥ 1
   * on the active moon; otherwise empty.
   */
  sensorContacts: FleetMission[];
  /** Premium currency echo (thread D; A stubs 0). */
  starshards: number;
  /** Active officers (thread D; A stubs []). */
  officers: OfficerState[];
  /** Unlocked skills (thread D; A stubs []). */
  skillsUnlocked: string[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  coords: Coordinates;
  pointsHint: number;
  planetId: string;
}

/** Ranked empire scoreboard row. */
export interface HighscoreEntry {
  rank: number;
  playerId: string;
  name: string;
  points: number;
  coords: Coordinates;
  planetCount: number;
}

export interface EconomySnapshot {
  productionPerHour: Resources;
  energy: { produced: number; used: number; factor: number };
  storage: Resources;
  /** Building-level field budget (soft-cap). */
  fields: { used: number; cap: number; remaining: number };
  /** Echo position mults for UI tooltips. */
  positionMult: SlotProductionMult;
}
