import { GOALS, type GoalCadence, type GoalDef, type GoalMetricId } from "./catalog.js";
import type {
  GoalProgress,
  GoalView,
  PlayerState,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { grantStarshards, utcDayKey } from "./world-boosts.js";
import { activePlanet } from "./world-bootstrap.js";

export type GoalActionResult =
  | { ok: true }
  | { ok: false; error: string };

/** UTC ISO week key `YYYY-Www` (ISO week-year). */
export function utcWeekKey(now: number): string {
  const d = new Date(now);
  // Thursday in current week decides the year (ISO).
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKeyFor(cadence: GoalCadence, now: number): string {
  return cadence === "daily" ? utcDayKey(now) : utcWeekKey(now);
}

function emptyProgress(periodKey: string): GoalProgress {
  return { periodKey, counts: {}, claimed: [] };
}

function ensureCadence(
  player: PlayerState,
  cadence: GoalCadence,
  now: number,
): GoalProgress {
  const key = periodKeyFor(cadence, now);
  const field = cadence === "daily" ? "goalsDaily" : "goalsWeekly";
  const cur = player[field];
  if (!cur || cur.periodKey !== key) {
    const fresh = emptyProgress(key);
    player[field] = fresh;
    return fresh;
  }
  if (!cur.counts) cur.counts = {};
  if (!Array.isArray(cur.claimed)) cur.claimed = [];
  return cur;
}

function goalById(id: string): GoalDef | undefined {
  return GOALS.find((g) => g.id === id);
}

function rewardLabel(def: GoalDef): string {
  const parts: string[] = [];
  if (def.reward.starshards) {
    parts.push(`${def.reward.starshards.toLocaleString("en-US")} Starshards`);
  }
  const m = def.reward.metal ?? 0;
  const c = def.reward.crystal ?? 0;
  const d = def.reward.deuterium ?? 0;
  if (m || c || d) {
    parts.push(`${m.toLocaleString("en-US")}/${c.toLocaleString("en-US")}/${d.toLocaleString("en-US")} m/c/d`);
  }
  return parts.join(" · ") || "none";
}

export function listGoals(player: PlayerState, now = Date.now()): GoalView[] {
  ensureCadence(player, "daily", now);
  ensureCadence(player, "weekly", now);
  return GOALS.map((def) => {
    const prog = ensureCadence(player, def.cadence, now);
    const progress = Math.max(0, Math.floor(prog.counts[def.metric] ?? 0));
    const claimed = prog.claimed.includes(def.id);
    const claimable = !claimed && progress >= def.target;
    return {
      id: def.id,
      cadence: def.cadence,
      name: def.name,
      description: def.description,
      progress: Math.min(progress, def.target),
      target: def.target,
      claimable,
      claimed,
      rewardLabel: rewardLabel(def),
    };
  });
}

/** Increment a metric for daily + weekly cadences that use it. */
export function noteGoalProgress(
  universe: UniverseState,
  playerId: string,
  metric: GoalMetricId,
  amount = 1,
  now = Date.now(),
): void {
  const player = universe.players[playerId];
  if (!player) return;
  const add = Math.max(0, Math.floor(amount));
  if (add <= 0) return;
  for (const cadence of ["daily", "weekly"] as const) {
    const uses = GOALS.some((g) => g.cadence === cadence && g.metric === metric);
    if (!uses) continue;
    const prog = ensureCadence(player, cadence, now);
    prog.counts[metric] = Math.max(0, Math.floor(prog.counts[metric] ?? 0)) + add;
  }
  universe.players[player.id] = player;
}

export function claimGoal(
  universe: UniverseState,
  playerId: string,
  goalId: string,
  now = Date.now(),
): GoalActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = goalById(goalId);
  if (!def) return { ok: false, error: "Unknown goal." };

  advanceUniverse(universe, now);
  const prog = ensureCadence(player, def.cadence, now);
  if (prog.claimed.includes(def.id)) {
    return { ok: false, error: "Goal already claimed this period." };
  }
  const progress = Math.max(0, Math.floor(prog.counts[def.metric] ?? 0));
  if (progress < def.target) {
    return {
      ok: false,
      error: `Need ${def.target} (have ${progress}).`,
    };
  }

  if (def.reward.starshards) {
    grantStarshards(player, def.reward.starshards);
  }
  const metal = Math.max(0, Math.floor(def.reward.metal ?? 0));
  const crystal = Math.max(0, Math.floor(def.reward.crystal ?? 0));
  const deuterium = Math.max(0, Math.floor(def.reward.deuterium ?? 0));
  if (metal > 0 || crystal > 0 || deuterium > 0) {
    const planet = activePlanet(universe, player);
    if (!planet) return { ok: false, error: "No active planet." };
    planet.resources = {
      metal: planet.resources.metal + metal,
      crystal: planet.resources.crystal + crystal,
      deuterium: planet.resources.deuterium + deuterium,
    };
  }

  prog.claimed = [...prog.claimed, def.id];
  universe.players[player.id] = player;
  return { ok: true };
}
