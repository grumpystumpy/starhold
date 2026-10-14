import type {
  AsteroidField,
  BodyKind,
  BuildingId,
  BuildQueueItem,
  Coordinates,
  DefenseQueueItem,
  DefenseStock,
  FleetMission,
  FleetPreset,
  FleetShips,
  OccupationState,
  OfficerDef,
  OfficerState,
  PirateBase,
  PlayerClassState,
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
  /** Voidforge Titan moon-kill success. */
  moonDestroyed?: boolean;
  moonKillChancePct?: number;
  /** Post-battle mini capture/destroy available (attacker win on colonized mini). */
  miniResolveAvailable?: boolean;
  miniPlanetId?: string;
  miniResolved?: "capture" | "destroy";
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
  | "starshards"
  | "miniPlanet";

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
  /** Mini-planet discovery coords (finder-only). */
  miniPlanetId?: string;
  miniCoords?: Coordinates;
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
  /** Wall-clock ms when Fold Bridge may jump again (moon). */
  jumpReadyAt?: number;
  resources: Resources;
  lastTickAt: number;
  buildings: Record<BuildingId, number>;
  ships: Record<ShipId, number>;
  defenses: DefenseStock;
  /** Ordered multi-item building queue (Round 2). */
  buildQueue: BuildQueueItem[];
  shipQueue: ShipQueueItem[];
  defenseQueue: DefenseQueueItem[];
  /** Round 2 mini-planet flag + optional super-rare kind. */
  flags?: {
    mini?: boolean;
    miniKind?: "standard" | "ironwater" | "fortress" | "relic";
  };
  /** Player ids who know this mini's coords (discovery). */
  discoveredBy?: string[];
  /** Wall-clock ms of last mini drift step. */
  lastDriftAt?: number;
  /** First successful colonize time — drives 8h galaxy-wide visibility. */
  colonizedAt?: number;
}

export interface PlayerState {
  id: string;
  name: string;
  homePlanetId: string;
  planetIds: string[];
  activePlanetId: string;
  research: ResearchLevels;
  /** Ordered multi-item empire research queue (Round 2). */
  researchQueue: ResearchQueueItem[];
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
  /** Linked email account (set after password claim / authenticated join). */
  accountId?: string | null;
  /** Saved fleet compositions (built-ins + custom), per player in this universe. */
  fleetPresets?: FleetPreset[];
  /** Round 3 player class (Miner / Explorer / Fleeter / Expansionist). */
  playerClass?: PlayerClassState;
  /** Mini planet ids this player has discovered (coords known). */
  discoveredMiniIds?: string[];
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
  /** Active Swarm Mothership occupations keyed by planetId. */
  occupations?: Record<string, OccupationState>;
  /** Mini planet ids (thread K fills discovery). */
  miniPlanetIds?: string[];
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
  /** Mini planets in this system visible to the viewer (discovered or owned). */
  minis?: GalaxySlot[];
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
    /** Round 2 mini planet — art hook for PLANET_ART.mini. */
    isMini?: boolean;
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
  /** Hostile outbound fleets targeting this player (not Moving Fortress). */
  hostileInbound: FleetMission[];
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
  /** Occupation on the active planet, if any. */
  occupation: OccupationState | null;
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
  temperatureK: number;
  energy: {
    produced: number;
    used: number;
    factor: number;
    helioBuoy: number;
    solarTempFactor: number;
  };
  storage: Resources;
  fields: {
    used: number;
    cap: number;
    remaining: number;
    mantleLoomBonus: number;
  };
  positionMult: SlotProductionMult;
}
