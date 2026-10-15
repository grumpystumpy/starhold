import {
  GOALS,
  type GoalMetric,
  type GoalTuning,
} from "./data/tuning.js";
import { storageFor } from "./formulas.js";
import type {
  GoalCadence,
  GoalView,
  PlayerGoalState,
  PlayerState,
  UniverseState,
} from "./types.js";
import { grantStarshards, utcDayKey } from "./world-boosts.js";
import { addCargoToPlanet } from "./world-tick.js";

export type GoalActionResult =
  | { ok: true; goalId: string }
  | { ok: false; error: string };

/** Thousands separators for player-facing error text. */
function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

/**
 * ISO-8601 week key in UTC (`YYYY-Www`, Monday start).
 * Pure function — no timezone database, safe on the free tier.
 */
export function utcWeekKey(now: number): string {
  const date = new Date(now);
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function periodKey(cadence: GoalCadence, now: number): string {
  switch (cadence) {
    case "daily":
      return utcDayKey(now);
    case "weekly":
      return utcWeekKey(now);
    default: {
      const _exhaustive: never = cadence;
      return _exhaustive;
    }
  }
}

function goalsInCadence(cadence: GoalCadence): GoalTuning[] {
  switch (cadence) {
    case "daily":
      return GOALS.filter((goal) => goal.cadence === "daily");
    case "weekly":
      return GOALS.filter((goal) => goal.cadence === "weekly");
    default: {
      const _exhaustive: never = cadence;
      return _exhaustive;
    }
  }
}

function sameMetric(goalMetric: GoalMetric, metric: GoalMetric): boolean {
  switch (metric) {
    case "pirateWin":
      return goalMetric === "pirateWin";
    case "expedition":
      return goalMetric === "expedition";
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}

function rollCadence(board: PlayerGoalState, cadence: GoalCadence): void {
  const drop = new Set(goalsInCadence(cadence).map((goal) => goal.id));
  for (const id of drop) delete board.progress[id];
  board.claimed = board.claimed.filter((id) => !drop.has(id));
}

/**
 * Align the player's board with the UTC day and week.
 * Stale cadence counters are cleared. Other cadence progress is kept.
 */
export function ensureGoalBoard(
  player: PlayerState,
  now: number,
): PlayerGoalState {
  const dailyKey = periodKey("daily", now);
  const weeklyKey = periodKey("weekly", now);
  if (!player.goals) {
    player.goals = { dailyKey, weeklyKey, progress: {}, claimed: [] };
    return player.goals;
  }
  const board = player.goals;
  if (!board.progress) board.progress = {};
  if (!Array.isArray(board.claimed)) board.claimed = [];
  if (board.dailyKey !== dailyKey) {
    rollCadence(board, "daily");
    board.dailyKey = dailyKey;
  }
  if (board.weeklyKey !== weeklyKey) {
    rollCadence(board, "weekly");
    board.weeklyKey = weeklyKey;
  }
  return board;
}

/** Credit every current goal that tracks `metric`. Caps at the target. */
export function noteGoalMetric(
  player: PlayerState,
  metric: GoalMetric,
  amount = 1,
  now = Date.now(),
): void {
  const add = Math.floor(amount);
  if (add <= 0) return;
  const board = ensureGoalBoard(player, now);
  for (const goal of GOALS) {
    if (!sameMetric(goal.metric, metric)) continue;
    const current = Math.floor(board.progress[goal.id] ?? 0);
    board.progress[goal.id] = Math.min(goal.target, current + add);
  }
}

export function goalsView(player: PlayerState, now: number): GoalView[] {
  const board = ensureGoalBoard(player, now);
  return GOALS.map((goal) => ({
    id: goal.id,
    cadence: goal.cadence,
    title: goal.title,
    detail: goal.detail,
    progress: Math.min(
      goal.target,
      Math.floor(board.progress[goal.id] ?? 0),
    ),
    target: goal.target,
    claimed: board.claimed.includes(goal.id),
    reward: {
      starshards: goal.starshards,
      metal: goal.metal,
      crystal: goal.crystal,
      deuterium: goal.deuterium,
    },
  }));
}

function activeBody(
  universe: UniverseState,
  player: PlayerState,
) {
  return (
    universe.planets[player.activePlanetId] ??
    universe.planets[player.homePlanetId] ??
    null
  );
}

/**
 * Claim a finished goal once per period.
 * Caller should advance the universe first so offline flights catch up
 * into the open period before the claim is judged.
 */
export function claimGoal(
  universe: UniverseState,
  playerId: string,
  goalId: string,
  now = Date.now(),
): GoalActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const goal = GOALS.find((row) => row.id === goalId);
  if (!goal) return { ok: false, error: "Unknown goal." };

  const board = ensureGoalBoard(player, now);
  if (board.claimed.includes(goal.id)) {
    return { ok: false, error: "Goal already claimed this period." };
  }
  const progress = Math.floor(board.progress[goal.id] ?? 0);
  if (progress < goal.target) {
    return {
      ok: false,
      error: `Goal not finished (${fmtInt(progress)} / ${fmtInt(goal.target)}).`,
    };
  }

  const paysResources =
    goal.metal > 0 || goal.crystal > 0 || goal.deuterium > 0;
  const planet = paysResources ? activeBody(universe, player) : null;
  if (paysResources) {
    if (!planet) return { ok: false, error: "Planet missing." };
    const caps = storageFor(planet);
    const room = {
      metal: caps.metal - planet.resources.metal,
      crystal: caps.crystal - planet.resources.crystal,
      deuterium: caps.deuterium - planet.resources.deuterium,
    };
    if (
      goal.metal > room.metal ||
      goal.crystal > room.crystal ||
      goal.deuterium > room.deuterium
    ) {
      return {
        ok: false,
        error: `Not enough storage for ${fmtInt(goal.metal)} metal, ${fmtInt(goal.crystal)} crystal, and ${fmtInt(goal.deuterium)} deuterium. Upgrade vaults, then claim.`,
      };
    }
  }

  if (goal.starshards > 0) {
    grantStarshards(player, goal.starshards);
  }
  if (paysResources && planet) {
    addCargoToPlanet(planet, {
      metal: goal.metal,
      crystal: goal.crystal,
      deuterium: goal.deuterium,
    });
    universe.planets[planet.id] = planet;
  }

  board.claimed = [...board.claimed, goal.id];
  player.goals = board;
  universe.players[player.id] = player;
  return { ok: true, goalId: goal.id };
}
