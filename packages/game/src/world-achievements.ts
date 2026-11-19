import {
  ACHIEVEMENTS,
  type AchievementMetric,
  type AchievementTuning,
} from "./data/tuning.js";
import type {
  AchievementView,
  PlayerAchievementsState,
  PlayerState,
  UniverseState,
} from "./types.js";
import { grantStarshards } from "./world-boosts.js";

/** Rank already on the commander board this request built or loaded. */
export interface AchievementBoardContext {
  rank: number | null;
  rivals: number;
}

export type AchievementCounter =
  | "shipsDestroyed"
  | "expeditions"
  | "pirateBasesDestroyed";

interface Signal {
  progress: number;
  meterTarget: number;
  met: boolean;
  showProgress: boolean;
  note?: string;
}

function board(player: PlayerState): PlayerAchievementsState {
  const current = player.achievements;
  const unlocked = Array.isArray(current?.unlocked) ? current.unlocked : [];
  if (!current || current.unlocked !== unlocked) {
    const next: PlayerAchievementsState = { ...current, unlocked };
    player.achievements = next;
    return next;
  }
  return current;
}

function meter(value: number, target: number): Signal {
  const safeTarget = Math.max(1, Math.floor(target));
  const raw = Math.max(0, Math.floor(value));
  return {
    progress: Math.min(safeTarget, raw),
    meterTarget: safeTarget,
    met: raw >= safeTarget,
    showProgress: true,
  };
}

function moonCount(universe: UniverseState, player: PlayerState): number {
  let count = 0;
  for (const id of player.planetIds ?? []) {
    const body = universe.planets[id];
    if (body && body.ownerPlayerId === player.id && body.kind === "moon") {
      count += 1;
    }
  }
  return count;
}

function colonyCount(universe: UniverseState, player: PlayerState): number {
  let count = 0;
  for (const id of player.planetIds ?? []) {
    if (id === player.homePlanetId) continue;
    const body = universe.planets[id];
    if (body && body.ownerPlayerId === player.id && body.kind !== "moon") {
      count += 1;
    }
  }
  return count;
}

function researchDone(player: PlayerState): number {
  for (const level of Object.values(player.research ?? {})) {
    if ((level ?? 0) >= 1) return 1;
  }
  return 0;
}

function officerDone(player: PlayerState): number {
  if ((player.officers ?? []).length > 0) return 1;
  for (const count of Object.values(player.officerRenewals ?? {})) {
    if ((count ?? 0) > 0) return 1;
  }
  for (const level of Object.values(player.officerLevels ?? {})) {
    if ((level ?? 0) > 0) return 1;
  }
  return 0;
}

function storedCount(
  player: PlayerState,
  key: AchievementCounter,
): number {
  return Math.max(0, Math.floor(player.achievements?.[key] ?? 0));
}

function highscoreSignal(
  def: AchievementTuning,
  ctx: AchievementBoardContext | undefined,
): Signal {
  if (!ctx) {
    return { progress: 0, meterTarget: 1, met: false, showProgress: false };
  }
  if (ctx.rivals < 2) {
    return {
      progress: 0,
      meterTarget: 1,
      met: false,
      showProgress: false,
      note: "Needs another commander.",
    };
  }
  if (ctx.rank == null) {
    return {
      progress: 0,
      meterTarget: 1,
      met: false,
      showProgress: false,
      note: "Not on the board yet.",
    };
  }
  const met = ctx.rank <= def.target;
  return {
    progress: met ? 1 : 0,
    meterTarget: 1,
    met,
    showProgress: false,
    note: `Current rank: ${ctx.rank}`,
  };
}

function signalFor(
  def: AchievementTuning,
  universe: UniverseState,
  player: PlayerState,
  ctx: AchievementBoardContext | undefined,
): Signal {
  const metric: AchievementMetric = def.metric;
  switch (metric) {
    case "moons":
      return meter(moonCount(universe, player), def.target);
    case "colonies":
      return meter(colonyCount(universe, player), def.target);
    case "shipsDestroyed":
      return meter(storedCount(player, "shipsDestroyed"), def.target);
    case "pirateBases":
      return meter(storedCount(player, "pirateBasesDestroyed"), def.target);
    case "expeditions":
      return meter(storedCount(player, "expeditions"), def.target);
    case "victories":
      return meter(player.combatStats?.wins ?? 0, def.target);
    case "research":
      return meter(researchDone(player), def.target);
    case "alliance":
      return meter(player.allianceId ? 1 : 0, def.target);
    case "officer":
      return meter(officerDone(player), def.target);
    case "commanderLevel":
      return meter(player.level ?? 1, def.target);
    case "highscoreRank":
      return highscoreSignal(def, ctx);
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}

/**
 * Add a lifetime count the save did not already keep.
 * Payment waits for `evaluatePlayerAchievements`.
 */
export function noteAchievementCount(
  player: PlayerState,
  key: AchievementCounter,
  amount: number,
): void {
  const add = Math.floor(amount);
  if (add <= 0) return;
  const state = board(player);
  state[key] = Math.floor(state[key] ?? 0) + add;
  player.achievements = state;
}

/**
 * Pay each newly met achievement once.
 * Call this from the player view, after the tick has already applied the
 * event, and pass the commander board that view already loaded.
 */
export function evaluatePlayerAchievements(
  universe: UniverseState,
  player: PlayerState,
  now: number,
  ctx?: AchievementBoardContext,
): void {
  const state = board(player);
  const have = new Set(state.unlocked.map((row) => row.id));
  for (const def of ACHIEVEMENTS) {
    if (have.has(def.id)) continue;
    const row = signalFor(def, universe, player, ctx);
    if (!row.met) continue;
    state.unlocked.push({ id: def.id, at: now });
    have.add(def.id);
    if (def.starshards > 0) grantStarshards(player, def.starshards);
  }
  player.achievements = state;
  universe.players[player.id] = player;
}

/** Board rows for the goals page. Does not grant rewards. */
export function achievementsView(
  universe: UniverseState,
  player: PlayerState,
  _now: number,
  ctx?: AchievementBoardContext,
): AchievementView[] {
  const unlockedAt = new Map(
    (player.achievements?.unlocked ?? [])
      .filter((row) => row && typeof row.id === "string")
      .map((row) => [row.id, row.at] as const),
  );
  return ACHIEVEMENTS.map((def) => {
    const row = signalFor(def, universe, player, ctx);
    const at = unlockedAt.get(def.id);
    const unlocked = at != null;
    return {
      id: def.id,
      title: def.title,
      detail: def.detail,
      progress: unlocked ? row.meterTarget : row.progress,
      target: row.meterTarget,
      unlocked,
      ...(unlocked ? { unlockedAt: at } : {}),
      starshards: def.starshards,
      showProgress: row.showProgress,
      ...(row.note ? { note: row.note } : {}),
    };
  });
}
