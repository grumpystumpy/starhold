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
  OfficerDef,
  OfficerState,
  PirateBase,
  ResearchLevels,
  ResearchQueueItem,
  Resources,
  ShipId,
  ShipQueueItem,
  SkillNodeDef,
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
  rounds: number;
  summary: string;
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
  detail: number;
  resources: Resources | null;
  buildings: Partial<Record<BuildingId, number>> | null;
  ships: Partial<FleetShips> | null;
  defenses: Partial<DefenseStock> | null;
  research: Partial<ResearchLevels> | null;
  summary: string;
}

export type ExpeditionKind =
  | "resources"
  | "ships"
  | "nothing"
  | "pirates"
  | "starshards";

export interface ExpeditionReport {
  id: string;
  at: number;
  missionId: string;
  playerId: string;
  targetCoords: Coordinates;
  kind: ExpeditionKind;
  cargoGained: Resources;
  shipsDelta: Partial<FleetShips>;
  /** Starshards granted to the player (expedition find). */
  starshardsGained?: number;
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
  kind?: BodyKind;
  parentPlanetId?: string | null;
  moonId?: string | null;
  fieldsCap?: number;
  resources: Resources;
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
  planetIds: string[];
  activePlanetId: string;
  research: ResearchLevels;
  researchQueue: ResearchQueueItem | null;
  createdAt: number;
  /** Player level — starts at 1, no max (Round 2). */
  level?: number;
  /** XP into the current level (0 .. xpToNext-1). */
  xp?: number;
  /** Lifetime XP earned. */
  xpTotal?: number;
  /** Premium currency — Starshards (earned in-game only). */
  starshards?: number;
  /** Active officers. */
  officers?: OfficerState[];
  /** Unlocked skill node ids. */
  skillsUnlocked?: string[];
  /** UTC day key `YYYY-MM-DD` of last daily Starshard claim. */
  lastDailyLoginUtc?: string;
  /** Once-only top-3 highscore Starshard grant. */
  highscoreStarshardsClaimed?: boolean;
}

export interface UniverseState {
  id: string;
  name: string;
  speed: number;
  fleetSpeed: number;
  createdAt: number;
  schemaVersion?: number;
  seed?: string;
  players: Record<string, PlayerState>;
  planets: Record<string, PlanetState>;
  fleets: Record<string, FleetMission>;
  reports: Record<string, CombatReport>;
  spyReports: Record<string, EspionageReport>;
  expeditionReports: Record<string, ExpeditionReport>;
  debris: Record<string, DebrisField>;
  asteroids?: Record<string, AsteroidField>;
  pirateBases?: Record<string, PirateBase>;
}

export interface PirateBasePublic {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  threatHint: "low" | "medium" | "high";
}

export interface GalaxySlot {
  coords: Coordinates;
  planetId: string | null;
  playerId: string | null;
  playerName: string | null;
  allianceTag: string | null;
  pointsHint: number;
  debris: { metal: number; crystal: number } | null;
  isOwn: boolean;
  hasMoon: boolean;
  moonId: string | null;
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
  ownedPlanets: Array<{
    id: string;
    name: string;
    coords: Coordinates;
    isHome: boolean;
    isActive: boolean;
    isMoon: boolean;
    jumpGateLevel: number;
  }>;
  economy: EconomySnapshot;
  roster: PublicPlayer[];
  highscores: HighscoreEntry[];
  galaxy: GalaxyView;
  fleets: FleetMission[];
  reports: CombatReport[];
  spyReports: EspionageReport[];
  expeditionReports: ExpeditionReport[];
  sensorContacts: FleetMission[];
  /** Premium currency echo. */
  starshards: number;
  /** Active (non-expired) officers. */
  officers: OfficerState[];
  /** Unlocked skills. */
  skillsUnlocked: string[];
  /** Officer catalog for UI. */
  officerCatalog: OfficerDef[];
  /** Skill tree catalog for UI. */
  skillCatalog: SkillNodeDef[];
  /** True when daily login Starshards can be claimed (UTC day). */
  dailyLoginAvailable: boolean;
  /** Player level / XP progress (Round 2). */
  progress: {
    level: number;
    xp: number;
    xpToNext: number;
    xpTotal: number;
  };
}

export interface PublicPlayer {
  id: string;
  name: string;
  coords: Coordinates;
  pointsHint: number;
  planetId: string;
}

export interface HighscoreEntry {
  rank: number;
  playerId: string;
  name: string;
  points: number;
  coords: Coordinates;
  planetCount: number;
  /** Player level (Round 2). */
  level: number;
  /** Lifetime XP (Round 2). */
  xpTotal: number;
}

export interface EconomySnapshot {
  productionPerHour: Resources;
  energy: { produced: number; used: number; factor: number };
  storage: Resources;
  fields: { used: number; cap: number; remaining: number };
  positionMult: SlotProductionMult;
}
