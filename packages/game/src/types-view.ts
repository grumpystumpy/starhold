import type {
  AcsGroup,
  ActiveItemBuff,
  AsteroidField,
  BodyKind,
  BuildingId,
  BuildQueueItem,
  Coordinates,
  DefenseId,
  DefenseQueueItem,
  DefenseStock,
  FleetMission,
  FleetPreset,
  FleetShips,
  OccupationState,
  OfficerDef,
  OfficerId,
  OfficerState,
  AlienBase,
  PirateBase,
  PlayerClassState,
  AllianceClassId,
  ResearchLevels,
  ResearchQueueItem,
  Resources,
  ShipId,
  ShipQueueItem,
  SkillNodeDef,
  SlotProductionMult,
} from "./types-core.js";

export interface ActiveItemBuffView {
  itemId: string;
  category: string;
  bonus: number;
  expiresAt: number;
  remainingMs: number;
}


export type CombatOutcome = "attacker_win" | "defender_win" | "draw";

/** Sparse units destroyed in a single combat round (omit zeros). */
export interface CombatRoundLosses {
  ships: Partial<FleetShips>;
  defenses?: Partial<DefenseStock>;
}

/** One simultaneous-fire round for replayable battle reports. */
export interface CombatRoundLog {
  round: number;
  attackerLosses: CombatRoundLosses;
  defenderLosses: CombatRoundLosses;
  /** Debris implied by ship losses this round (pre-skim; metal/crystal). */
  debrisThisRound: Resources;
  /** Shield pool damage absorbed per side in this round. */
  shieldsAbsorbed?: { attacker: number; defender: number };
}

export interface CombatReport {
  id: string;
  at: number;
  missionId: string;
  attackerPlayerId: string;
  defenderPlayerId: string;
  attackerName: string;
  defenderName: string;
  originCoords?: Coordinates;
  targetCoords: Coordinates;
  attackerBefore: FleetShips;
  attackerAfter: FleetShips;
  defenderBefore: FleetShips;
  defenderAfter: FleetShips;
  defensesBefore: DefenseStock;
  defensesAfter: DefenseStock;
  /** Combat losses before rebuild. Absent on legacy reports. */
  defensesDestroyed?: Partial<Record<DefenseId, number>>;
  defensesRebuilt?: Partial<Record<DefenseId, number>>;
  defensesPermanentlyLost?: Partial<Record<DefenseId, number>>;
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
  /** Per-round losses / debris (absent on legacy reports). */
  roundLog?: CombatRoundLog[];
  /** XP granted to each side for this fight (absent on legacy reports). */
  xpAwarded?: { attacker: number; defender: number };
  /** Short opaque token for chat paste / future alliance intel. */
  shareCode?: string;
  /** Joint Strike (ACS) group id when this report is a combined attack. */
  acsGroupId?: string;
  /** All attacking player ids in an ACS resolve. */
  acsParticipantIds?: string[];
  /** Resource value of pirate ships destroyed. Set on seasonal boss strikes. */
  bossDamage?: number;
}

export interface PlayerCombatStats {
  lostValue: number;
  destroyedValue: number;
  wins: number;
  losses: number;
}

/** Fields deliberately exposed by a public battle-report share link. */
export interface PublicCombatReport {
  shareCode: string;
  at: number;
  attackerName: string;
  defenderName: string;
  originCoords?: Coordinates;
  targetCoords: Coordinates;
  attackerBefore: Partial<FleetShips>;
  attackerAfter: Partial<FleetShips>;
  defenderBefore: Partial<FleetShips>;
  defenderAfter: Partial<FleetShips>;
  defensesBefore: Partial<DefenseStock>;
  defensesAfter: Partial<DefenseStock>;
  defensesDestroyed?: Partial<Record<DefenseId, number>>;
  loot: Resources;
  debrisCreated: Resources;
  outcome: CombatOutcome;
  rounds: number;
  /** Per-round losses, debris, and shields. Absent on legacy share links. */
  roundLog?: CombatRoundLog[];
}

export interface HallOfFameEntry {
  at: number;
  attackerName: string;
  defenderName: string;
  targetCoords: Coordinates;
  outcome: CombatOutcome;
  destroyedValue: number;
  shareCode?: string;
}

export interface HallOfShameEntry {
  rank: number;
  playerId: string;
  name: string;
  lostValue: number;
}

export interface HighscoreCache {
  rows: HighscoreEntry[];
  hallOfFame: HallOfFameEntry[];
  hallOfShame: HallOfShameEntry[];
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
  | "miniPlanet"
  | "blackHole"
  | "newPirateBase"
  | "newAlienBase";

export interface ExpeditionReport {
  id: string;
  at: number;
  missionId: string;
  playerId: string;
  targetCoords: Coordinates;
  kind: ExpeditionKind;
  cargoGained: Resources;
  shipsDelta: Partial<FleetShips>;
  /** Debris left by a pirate ambush. Absent on legacy reports. */
  debrisCreated?: Resources;
  /** Starshards granted to the player (expedition find). */
  starshardsGained?: number;
  /** Mini-planet discovery coords (finder-only). */
  miniPlanetId?: string;
  miniCoords?: Coordinates;
  newPirateBaseId?: string;
  newAlienBaseId?: string;
  newBaseCoords?: Coordinates;
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
  /** Timestamps (ms) of recent NPC pirate raid hits on this planet within rolling window. */
  pirateHitHistory?: number[];
}

export type AllianceRole = "founder" | "officer" | "member";
export type AllianceJoinMode = "open" | "invite" | "request";
export type AllianceDiplomacyKind = "nap" | "war";
export type AllianceRelationStatus = "pending" | "active";

/** One diplomacy link with another alliance. Missing on older saves. */
export interface AllianceRelation {
  allianceId: string;
  kind: AllianceDiplomacyKind;
  /** Pending is a NAP offer. War is stored as active. */
  status: AllianceRelationStatus;
  /** Alliance id that offered the pact or declared the war. */
  initiatedBy: string;
  since: number;
}

export interface AllianceMember {
  playerId: string;
  role: AllianceRole;
  joinedAt: number;
}

/** One player's ask to join a request-mode alliance. Missing on older saves. */
export interface AlliancePendingRequest {
  playerId: string;
  requestedAt: number;
}

export interface AllianceChatMessage {
  id: string;
  playerId: string;
  displayName: string;
  body: string;
  createdAt: number;
}

/** Read-only copy of a spy outcome at the moment it was shared. */
export interface AllianceIntelSnapshot {
  detail: number;
  summary: string;
  resources: Resources | null;
  ships: Partial<FleetShips> | null;
  defenses: Partial<DefenseStock> | null;
}

export interface AllianceIntelStamp {
  id: string;
  sharedByPlayerId: string;
  sharedByName: string;
  spyReportId: string;
  targetCoords: Coordinates;
  targetLabel: string;
  createdAt: number;
  expiresAt: number | null;
  snapshot: AllianceIntelSnapshot;
}

export interface AllianceGalaxyMarker {
  id: string;
  coords: Coordinates;
  note: string;
  createdByPlayerId: string;
  createdByName: string;
  createdAt: number;
  expiresAt: number;
}

/** Fleet deep-link when Joint Strike helpers are present in this build. */
export interface AcsPrefill {
  coords: Coordinates;
  mission: "raid" | "pirateRaid";
  note: string;
  openAcs: true;
}

export interface AllianceRecord {
  id: string;
  name: string;
  /** Short uppercase tag shown in galaxy / highscores. */
  tag: string;
  joinMode: AllianceJoinMode;
  createdAt: number;
  founderPlayerId: string;
  members: Record<string, AllianceMember>;
  /** Pending invite player ids (invite mode). */
  pendingInvites?: string[];
  /** Join requests (request mode). Missing on older saves — treat as []. */
  pendingRequests?: AlliancePendingRequest[];
  /** Ring buffer. Missing on older saves — treat as []. */
  chat?: AllianceChatMessage[];
  /** Shared spy stamps. Missing on older saves — treat as []. */
  intel?: AllianceIntelStamp[];
  /** Galaxy markers. Missing on older saves — treat as []. */
  markers?: AllianceGalaxyMarker[];
  /**
   * Alliance class (Destroyer's / Builder's / Explorer's).
   * Missing on older saves — no class, no bonus. Never required.
   */
  allianceClass?: AllianceClassId | null;
  /**
   * NAP and war links. Missing on older saves — no relations.
   * Capped at ALLIANCE_RELATION_CAP.
   */
  relations?: AllianceRelation[];
}

export interface AllianceMemberView {
  playerId: string;
  name: string;
  role: AllianceRole;
  joinedAt: number;
  pointsHint: number;
}

export interface AllianceView {
  id: string;
  name: string;
  tag: string;
  joinMode: AllianceJoinMode;
  createdAt: number;
  founderPlayerId: string;
  myRole: AllianceRole;
  members: AllianceMemberView[];
  pendingInvites: Array<{ playerId: string; name: string }>;
  /** Present for Leader and Officer. Older clients may omit it. */
  pendingRequests?: Array<{
    playerId: string;
    name: string;
    requestedAt: number;
  }>;
  memberCount: number;
  maxMembers: number;
  chat: AllianceChatMessage[];
  intel: AllianceIntelStamp[];
  markers: AllianceGalaxyMarker[];
  /** Null when the alliance has not chosen a class. */
  allianceClass: AllianceClassId | null;
  /** Current diplomacy. Empty when the alliance has none. Older clients may omit it. */
  relations?: AllianceRelationView[];
}

export interface AllianceRelationView {
  allianceId: string;
  name: string;
  tag: string;
  kind: AllianceDiplomacyKind;
  status: AllianceRelationStatus;
  initiatedBy: string;
  since: number;
  canAccept: boolean;
  canCancel: boolean;
}

export interface AllianceListEntry {
  id: string;
  name: string;
  tag: string;
  joinMode: AllianceJoinMode;
  memberCount: number;
  maxMembers: number;
}

/** Cached alliance rank row. Rebuilt with the player highscore board. */
export interface AllianceRankEntry {
  rank: number;
  allianceId: string;
  name: string;
  tag: string;
  memberCount: number;
  points: number;
  averagePoints: number;
}

/** The viewer's one outstanding join request, if any. */
export interface PendingAllianceRequestView {
  allianceId: string;
  name: string;
  tag: string;
  requestedAt: number;
}

export type EventLogKind =
  | "buildComplete"
  | "fleetReturn"
  | "raidAlert"
  | "miniNearby";

export interface EventLogEntry {
  id: string;
  kind: EventLogKind;
  createdAt: number;
  readAt: number | null;
  title: string;
  body: string;
  href?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export type SeasonBoardId = "combat" | "economy" | "pirateKills";

/** Live counters for the open UTC month. */
export interface SeasonPlayerCounters {
  seasonId: string;
  combat: number;
  economy: number;
  pirateKills: number;
  /** Resources spent toward the next economy point (below SEASON_ECONOMY_SPEND_DIV). */
  economyRemainder?: number;
  claimedBoards?: SeasonBoardId[];
}

/** Cosmetic unlocks. No shop — earned from sealed-season placement only. */
export interface SeasonCosmetics {
  titles: string[];
  activeTitle: string | null;
  planetSkinIds: string[];
  activePlanetSkinId: string | null;
}

export interface SeasonBoardRow {
  playerId: string;
  name: string;
  score: number;
}

export interface SeasonSnapshot {
  id: string;
  sealedAt: number | null;
  boards: Record<SeasonBoardId, SeasonBoardRow[]>;
}

export interface SeasonStanding extends SeasonBoardRow {
  rank: number;
}

export interface SeasonClaimOffer {
  board: SeasonBoardId;
  score: number;
  rank: number | null;
  title: string | null;
  skinId: string | null;
  claimed: boolean;
}

export interface SeasonClaimView {
  seasonId: string;
  offers: SeasonClaimOffer[];
}

export type PirateBossSeasonPhase = "active" | "cooldown" | "due";

/**
 * View-only clock for the monthly hunt. Not stored.
 * While the mothership is up, `nextSpawnAt` is the window close plus the cooldown.
 */
export interface PirateBossSeasonSchedule {
  seasonId: string;
  title: string;
  line: string;
  phase: PirateBossSeasonPhase;
  /** Living window close. Omitted when the mothership is not up. */
  activeUntil?: number;
  nextSpawnAt: number;
}

/** Current month boards plus sealed seasons the player can claim. */
export interface SeasonLeaderboardView {
  seasonId: string;
  scores: { combat: number; economy: number; pirateKills: number };
  /** Resources spent this month that have not yet made a full economy point. */
  economyRemainder: number;
  ranks: Record<SeasonBoardId, number | null>;
  boards: Record<SeasonBoardId, SeasonStanding[]>;
  claims: SeasonClaimView[];
  /** Active window, cooldown, and next spawn for this month's mothership. */
  bossSchedule?: PirateBossSeasonSchedule;
}

/** On when present. `startedAt` is the turn-on time. Absent means off. */
export interface VacationModeState {
  startedAt: number;
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
  /** First launch of a PvP attack; permanently forfeits newbie protection. */
  newbieForfeitedAt?: number;
  /**
   * Vacation mode. Missing means off. Older saves omit it.
   * `startedAt` is when the commander turned it on.
   */
  vacationMode?: VacationModeState;
  /** Last launch time when this player attacked a pirate or alien base. */
  attackedPiratesAt?: number;
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
  /**
   * Permanent officer training, 1–10. Survives the hire expiring.
   * Missing on old saves — a live hire migrates to level 1.
   */
  officerLevels?: Partial<Record<OfficerId, number>>;
  /** Number of completed hires for renewal pricing; missing on old saves means 0. */
  officerRenewals?: Partial<Record<OfficerId, number>>;
  /** Unlocked skill node ids. Kept in sync with skillLevels ≥ 1. */
  skillsUnlocked?: string[];
  /**
   * Permanent skill training, 1–10. Missing on old saves — each
   * skillsUnlocked id migrates to level 1.
   */
  skillLevels?: Record<string, number>;
  /**
   * Combat reports hidden from this commander's inbox. The report stays
   * for the other participant until they delete it too.
   */
  hiddenReportIds?: string[];
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
  /** Alliance membership — tag resolved at read time. */
  allianceId?: string | null;
  /**
   * Alliance this player has asked to join. One pending request per player.
   * Missing on older saves.
   */
  pendingAllianceId?: string | null;
  /**
   * Pirate raid fairness (CHANGE #18): successful pirate NPC raids on this
   * player for a UTC day. Lazy daily reset by `dayKey`. Aliens exempt.
   */
  pirateRaidFairness?: {
    dayKey: string;
    successfulRaids: number;
  };
  /** Lifetime combat counters; missing on old saves means zero. */
  combatStats?: PlayerCombatStats;
  /**
   * One-time achievements. Missing on older saves.
   * `unlocked` is the id and the time it was paid. Counters cover events
   * the save did not already store (enemy hulls, expeditions, pirate bases).
   */
  achievements?: PlayerAchievementsState;
  /**
   * Daily / weekly goal counters for the current UTC periods.
   * Lives on the player inside the universe document (no extra KV keys).
   */
  goals?: PlayerGoalState;
  /**
   * One-time commander tutorial. Missing on older saves.
   * Steps are evaluated live; this object only stores claims and dismiss.
   */
  onboarding?: PlayerOnboardingState;
  /**
   * Mid-game milestone guide hidden. Missing on older saves.
   * A read does not create this field.
   */
  midgameBriefingDismissed?: boolean;
  /**
   * Release id of the last "what's new" popup this commander dismissed.
   * Missing on older saves. A newer catalog id shows the popup again.
   */
  whatsNewDismissedReleaseId?: string;
  /**
   * Last authenticated `/api/state` read, in ms.
   * Missing on older saves. Written at most once per hour.
   * Galaxy inactivity reads this; a missing value is not inactive.
   */
  lastActiveAt?: number;
  /** Synthetic empire alerts. Missing on old saves — migrate to []. */
  eventLog?: EventLogEntry[];
  /** Open monthly season counters. Missing on older saves until the next read. */
  season?: SeasonPlayerCounters;
  /** Owned titles and planet skins. */
  cosmetics?: SeasonCosmetics;
  /**
   * Personal copy of each sealed season, including claim flags.
   * The live `season` object is zeroed when the month rolls.
   */
  seasonArchive?: Record<string, SeasonPlayerCounters>;
  /** Active item 24h buffs or slot licenses. Missing on older saves. */
  itemBuffs?: ActiveItemBuff[];
}

/** UTC period keys + per-goal counters. Rolled lazily on read. */
export interface PlayerGoalState {
  /** UTC day key `YYYY-MM-DD`. */
  dailyKey: string;
  /**
   * ISO week key `YYYY-Www` (UTC, Monday start).
   * Older saves omit it. The next read stamps the open week.
   */
  weeklyKey?: string;
  progress: Record<string, number>;
  claimed: string[];
}

/** One paid achievement. `at` is the universe clock used when it unlocked. */
export interface PlayerAchievementUnlock {
  id: string;
  at: number;
}

/**
 * Optional player field. Absent means the commander has not been checked yet.
 * Counters start at 0 when missing and are not backfilled from old reports.
 */
export interface PlayerAchievementsState {
  unlocked: PlayerAchievementUnlock[];
  shipsDestroyed?: number;
  expeditions?: number;
  pirateBasesDestroyed?: number;
}

export type GoalCadence = "daily" | "weekly";

export interface GoalRewardView {
  starshards: number;
  metal: number;
  crystal: number;
  deuterium: number;
}

export interface GoalView {
  id: string;
  cadence: GoalCadence;
  title: string;
  detail: string;
  progress: number;
  target: number;
  claimed: boolean;
  reward: GoalRewardView;
}

/** One row on the achievements board. Locked rows stay visible. */
export interface AchievementView {
  id: string;
  title: string;
  detail: string;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt?: number;
  starshards: number;
  /** False when a live meter would be misleading (commander rank). */
  showProgress: boolean;
  note?: string;
}

/**
 * One-time commander tutorial. Missing on older saves.
 * `recon` is set when an expedition or spy scan resolves so the
 * recon step still counts after reports are pruned.
 */
export interface PlayerOnboardingState {
  claimed?: string[];
  dismissed?: boolean;
  recon?: boolean;
}

export type OnboardingNavPage =
  | "buildings"
  | "research"
  | "shipyard"
  | "fleets"
  | "galaxy";

export interface OnboardingRewardView {
  starshards: number;
  metal: number;
  crystal: number;
  deuterium: number;
}

/** Unseen release notes for the what's-new popup. Not a page. */
export interface WhatsNewView {
  /** Newest release id included in this popup. */
  releaseId: string;
  title: string;
  items: string[];
}

export interface OnboardingStepView {
  id: string;
  title: string;
  description: string;
  targetNavPage: OnboardingNavPage;
  completed: boolean;
  claimed: boolean;
  reward: OnboardingRewardView;
}

/**
 * One optional next step derived from current buildings, research, and
 * catalog prerequisites. Not stored on the save and pays no reward.
 */
export interface NextGoalSuggestion {
  /** Catalog id, `research:<researchId>` or `building:<buildingId>`. */
  id: string;
  /** Catalog display name of the step to take. */
  title: string;
  /** Why this step is next, using catalog names and levels only. */
  rationale: string;
  targetNavPage: OnboardingNavPage;
}

export interface OnboardingView {
  steps: OnboardingStepView[];
  dismissed: boolean;
  allClaimed: boolean;
  completedCount: number;
  /**
   * Closest catalog gate. Omitted by older view fixtures.
   * `null` when every gated level-1 step is already met.
   */
  suggestion?: NextGoalSuggestion | null;
}

export interface UniverseSeedCursor {
  /** Next system ordinal in `[0, MAP_GALAXIES * MAP_SYSTEMS]`. */
  at: number;
  /** Pirate placement rank rows. Dropped once pirates are placed. */
  ranks?: { g: number; s: number; k: number }[];
  /** True after `ranks` has been sorted once. */
  sorted?: boolean;
  /** Next index in the sorted rank list. */
  rankAt?: number;
  /** Rank-key version the rows were sorted with (CI-02). Missing = old key. */
  rankVersion?: number;
  pirates: number;
  done?: boolean;
  /**
   * Systems seeded because a player opened them before the background
   * cursor arrived. The cursor skips these so they are not created twice.
   */
  visited?: Record<string, 1>;
}

/** Short code that places a new home near the inviter. Not a player id. */
export interface InviteRecord {
  code: string;
  playerId: string;
  createdAt: number;
  expiresAt: number;
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
  /** Alien bases — empty until expedition find. */
  alienBases?: Record<string, AlienBase>;
  /** UTC-day key for alien find RNG window. */
  alienDailyFindDay?: string;
  alienDailyFindSeed?: number;
  alienFoundCountToday?: number;
  /** Lazy AI catch-up cursor (Hobby bounded batch). */
  lastAiSimAt?: number;
  aiCatchUpCursor?: string | null;
  /** Raid-only cursor for alternating Workers NPC AI slices. */
  aiRaidCatchUpCursor?: string | null;
  /**
   * Last player id loaded by a full NPC cron page.
   * Absent on older saves and after a short page, which starts again at the first id.
   */
  npcPlayerPageCursor?: string;
  /**
   * Workers bootstrap. Absent on Vercel universes that were seeded in one
   * shot. `done` means minis, asteroids, and the pirate roster match a
   * full seed.
   */
  seedCursor?: UniverseSeedCursor;
  /** Active Mothership occupations keyed by planetId. */

  occupations?: Record<string, OccupationState>;
  /** Mini planet ids (thread K fills discovery). */
  miniPlanetIds?: string[];
  /** Alliances keyed by id (lazy; no tick). */
  alliances?: Record<string, AllianceRecord>;
  /** Active ACS / Joint Strike groups (lazy resolve on tick). */
  acsGroups?: Record<string, AcsGroup>;
  /** Sealed monthly snapshots. Absent until the first month roll. */
  seasons?: Record<string, SeasonSnapshot>;
  /** Active seasonal pirate boss id; optional for older universe saves. */
  pirateBossBaseId?: string;
  /** Wall-clock end of the active seasonal boss window. */
  pirateBossActiveUntil?: number;
  /** Earliest wall-clock time at which the next boss may spawn. */
  pirateBossNextSpawnAt?: number;
  /**
   * Friend-home codes. Absent on older saves. Not copied into the 30s
   * player view. Pruned only when a code is minted.
   */
  invites?: Record<string, InviteRecord>;
  /**
   * Set on a player-scoped request. NPC raids and growth run on the
   * maintenance pass instead of the page-load tick. Not persisted.
   */
  skipNpcRaids?: boolean;
  /**
   * The row-save NPC job does not have every empty slot in memory, so it
   * must not place new bases. Not persisted.
   */
  skipPirateTopUp?: boolean;
}

export interface PirateBasePublic {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  level: number;
  threatHint: "low" | "medium" | "high";
}

export interface AlienBasePublic {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  level: number;
  threatHint: "low" | "medium" | "high";
  /** False during 4h buildup (not yet raiding). */
  active: boolean;
}

export interface PlanetArtFields {
  artId: string;
  /** Master WebP (512). Overview hero. */
  artUrl: string;
  /** 128 thumb. Galaxy rows, switcher, dense lists. */
  artThumbUrl: string;
}

export interface GalaxySlot extends PlanetArtFields {
  coords: Coordinates;
  planetId: string | null;
  playerId: string | null;
  playerName: string | null;
  allianceTag: string | null;
  /**
   * `i` after 7 days without an authenticated state read, `I` after 28.
   * Omitted when `player.lastActiveAt` is missing or more recent.
   */
  inactivity?: "i" | "I";
  /**
   * Active NAP or war between the viewer's alliance and this slot's alliance.
   * Missing when there is none. Not saved.
   */
  diplomacy?: AllianceDiplomacyKind;
  pointsHint: number;
  empirePoints?: number;
  debris: { metal: number; crystal: number } | null;
  isOwn: boolean;
  hasMoon: boolean;
  moonId: string | null;
  /** Mini body sitting on this colonizable slot. */
  isMini: boolean;
  activity: "empty" | "planet" | "pirate" | "alien" | null;
  /** Set for alliance members when this slot has a live marker. */
  allianceMarker?: {
    id: string;
    note: string;
    markedBy: string;
  } | null;
}

/** Mini planet outside slots 1–15 (deep space / expedition). */
export interface GalaxyMiniBody extends PlanetArtFields {
  planetId: string;
  name: string;
  coords: Coordinates;
  isOwn: boolean;
  playerName: string | null;
  /** Same marks as `GalaxySlot.inactivity`. Omitted when unknown or recent. */
  inactivity?: "i" | "I";
  /** Active NAP or war with the viewer's alliance. Missing when there is none. */
  diplomacy?: AllianceDiplomacyKind;
  debris: { metal: number; crystal: number } | null;
}

export interface GalaxyView {
  galaxy: number;
  system: number;
  slots: GalaxySlot[];
  /** Discovered minis in this system whose slot is outside 1–15. */
  minis: GalaxyMiniBody[];
  deepSpace: { coords: Coordinates };
  asteroids: AsteroidField[];
  pirateBase: PirateBasePublic | null;
  alienBase: AlienBasePublic | null;
}

export type PirateBossTierId = "top1" | "top10" | "participant";

/** Seasonal boss snapshot for the seasons panel, events card, and galaxy banner. */
export interface PirateBossView {
  id: string;
  coords: Coordinates;
  shipsLeft: number;
  hpPct: number;
  activeUntil?: number;
  nextSpawnAt?: number;
  myDamage: number;
  myRank: number | null;
  /** Sum of every contribution, not just the top 10. */
  totalDamage: number;
  /** Rank 1, else share of total damage. Null when this commander is under 1%. */
  myTier: PirateBossTierId | null;
  top: { playerId: string; name: string; damage: number }[];
  /** Current month id. View only. */
  seasonId?: string;
  /** Month hunt name. View only. */
  flavorTitle?: string;
  /** Month hunt sentence. View only. Pay stays on PIRATE_BOSS_TIERS. */
  flavorLine?: string;
  /**
   * Next spawn. During an active window this is the window close plus the
   * cooldown, and it is not written to the save.
   */
  projectedSpawnAt?: number;
}

/** View-only prefill for the fleet-save reminder. Absent on the save. */
export interface FleetSaveSuggestion {
  /** Incoming hostile fleet id. Dismissal is per this attack. */
  attackId: string;
  originPlanetId: string;
  mission: "deploy" | "expedition";
  /** Docked non-stationary ships. Stationary hulls are left out. */
  ships: Partial<FleetShips>;
  /** Nearest other planet or moon. Null when the save is an expedition. */
  targetPlanetId: string | null;
  /** Deep-space coordinates for an expedition. Null on deploy. */
  targetCoords: Coordinates | null;
  arrivesAt: number;
}

export interface PlayerView {
  now: number;
  newbieBonusEndsAt?: number | null;
  universe: {
    id: string;
    name: string;
    speed: number;
    fleetSpeed: number;
  };
  player: PlayerState;
  planet: PlanetState;
  /** Derived art for the active body (not persisted). */
  planetArt: PlanetArtFields;
  ownedPlanets: Array<
    PlanetArtFields & {
      id: string;
      name: string;
      coords: Coordinates;
      isHome: boolean;
      isActive: boolean;
      isMoon: boolean;
      isMini: boolean;
      jumpGateLevel: number;
      /**
       * System Scanner level. Omitted at 0 so a quiet poll stays the same size.
       * Moon Bridge level is `jumpGateLevel` above.
       */
      sensorArrayLevel?: number;
      /** Research Lab level on this body (empire research uses the best). */
      researchLab: number;
      resources: Resources;
      buildQueueHead: Pick<BuildQueueItem, "buildingId" | "targetLevel"> | null;
      shipQueueHead: Pick<ShipQueueItem, "shipId" | "count"> | null;
      defenseQueueHead: Pick<DefenseQueueItem, "defenseId" | "count"> | null;
    }
  >;
  economy: EconomySnapshot;
  roster: PublicPlayer[];
  highscores: HighscoreEntry[];
  /** Cached alliance ranks. Empty until the next highscore rebuild. */
  allianceHighscores?: AllianceRankEntry[];
  hallOfFame?: HallOfFameEntry[];
  hallOfShame?: HallOfShameEntry[];
  galaxy: GalaxyView;
  /**
   * This commander's scanner moons. Set only on a Galaxy page state read.
   * The 30s poll omits it. Older responses omit it too.
   */
  scannerMoons?: Array<{
    planetId: string;
    coords: Coordinates;
    /** Current System Scanner level. 0 is omitted by the server. */
    sensorArray: number;
    /** `sensorPhalanxRange(sensorArray)`. */
    range: number;
  }>;
  fleets: FleetMission[];
  /** Server-derived slot limits, including active bonuses and owned beacons. */
  fleetSlotCap: number;
  expeditionSlotCap: number;
  reports: CombatReport[];
  spyReports: EspionageReport[];
  expeditionReports: ExpeditionReport[];
  sensorContacts: FleetMission[];
  /** Hostile outbound fleets targeting this player (not Moving Fortress). */
  hostileInbound: FleetMission[];
  /**
   * One-tap fleet-save prefills for hostile raids more than a minute out.
   * Omitted when nothing qualifies. Not written to the save.
   */
  fleetSave?: FleetSaveSuggestion[];
  /** Premium currency echo. */
  starshards: number;
  /** Active (non-expired) officers. */
  officers: OfficerState[];
  /** Unlocked skills (level ≥ 1). */
  skillsUnlocked: string[];
  /** Skill id → level (1–10). Absent ids are level 0. */
  skillLevels: Record<string, number>;
  /** Officer id → permanent level (1–10). Absent ids are level 0. */
  officerLevels: Partial<Record<OfficerId, number>>;
  /** Number of hires already completed, used to quote the next hire/renewal. */
  officerRenewals: Partial<Record<OfficerId, number>>;
  /** Combined research build time multiplier (level, class, astrolabe, relic, boosts). */
  researchTimeMult?: number;
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
  /** Current alliance view, or null when unaffiliated. */
  alliance: AllianceView | null;
  /** Set when this player has one outstanding join request. */
  pendingAllianceRequest?: PendingAllianceRequestView | null;
  /** Lightweight directory of alliances (for join UI). */
  allianceDirectory: AllianceListEntry[];
  /** Open Joint Strike (ACS) groups for the player's alliance. */
  openAcsGroups: AcsGroup[];
  /** Daily and weekly goals for the current UTC periods. */
  goals: GoalView[];
  /**
   * One-time achievements. Filled by playerView. Older responses may omit it.
   */
  achievements?: AchievementView[];
  /** Commander tutorial. Always filled by playerView; older clients may omit it. */
  onboarding?: OnboardingView;
  /**
   * What's-new popup for a release this commander has not dismissed.
   * Null when the latest release key is already dismissed. Older responses omit it.
   */
  whatsNew?: WhatsNewView | null;
  /**
   * Owned bodies for fleet-composer preset gating. Ships stay off
   * `ownedPlanets` so existing planet-list comparisons stay stable.
   */
  presetUnlockPlanets?: Array<{
    shipyard: number;
    ships: FleetShips;
  }>;
  /** Current month leaderboard plus sealed claim offers. */
  seasonLeaderboard: SeasonLeaderboardView;
  /** Set while a seasonal boss is up, or during the cooldown after it ends. */
  pirateBoss?: PirateBossView;
  /** Active 24h item buffs. */
  activeItemBuffs: ActiveItemBuffView[];
  /** Shop items catalog for UI. */
  shopCatalog: Record<
    string,
    {
      id: string;
      name: string;
      category: string;
      tier: string;
      bonus: number;
      starshards: number;
      description: string;
    }
  >;
}

export interface PublicPlayer extends PlanetArtFields {
  id: string;
  name: string;
  coords: Coordinates;
  pointsHint: number;
  planetId: string;
  /** Home planet display name. */
  planetName?: string;
  allianceTag?: string | null;
}

/** One UTC day's rank on the commander board. Days are `YYYY-MM-DD`, oldest first. */
export interface HighscoreRankPoint {
  day: string;
  rank: number;
}

export interface HighscoreEntry extends PlanetArtFields {
  rank: number;
  playerId: string;
  name: string;
  points: number;
  coords: Coordinates;
  planetCount: number;
  /** Home planet display name. Other colonies are not separate rows. */
  planetName: string;
  homePlanetId: string;
  /** Player level (Round 2). */
  level: number;
  /** Lifetime XP (Round 2). */
  xpTotal: number;
  allianceTag?: string | null;
  /**
   * Daily rank snapshots, oldest first, capped at `HIGHSCORE_RANK_HISTORY_DAYS`.
   * The maintenance rebuild writes this. Older boards omit it.
   */
  rankHistory?: HighscoreRankPoint[];
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
