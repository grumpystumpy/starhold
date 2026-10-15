import { OFFICERS } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import { OFFICER_MAX_LEVEL, SKILL_MAX_LEVEL, STARSHARDS_DAILY_LOGIN } from "./catalog.js";
import { levelUpCost } from "./formulas-levels.js";
import type { OfficerId, UniverseState } from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { claimGoal, type GoalActionResult } from "./world-goals.js";
import {
  canClaimDailyLogin,
  grantStarshards,
  pruneExpiredOfficers,
  utcDayKey,
} from "./world-boosts.js";
import {
  ensureProgressionLevels,
  officerLevelOf,
  skillLevelOf,
} from "./world-progression.js";
export type StarshardActionResult =
  | { ok: true; starshardsGranted?: number }
  | { ok: false; error: string };

export {
  canClaimDailyLogin,
  emptyBoosts,
  expeditionStarshardsAmount,
  grantPirateDestroyStarshards,
  grantPirateFleetKillStarshards,
  grantStarshards,
  playerBoosts,
  pruneExpiredOfficers,
  utcDayKey,
  type PlayerBoosts,
} from "./world-boosts.js";

/** Daily login earn: +15 Starshards once per UTC day. */
export function claimDailyLogin(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): StarshardActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);
  if (!canClaimDailyLogin(player, now)) {
    return { ok: false, error: "Daily Starshards already claimed today (UTC)." };
  }
  player.lastDailyLoginUtc = utcDayKey(now);
  grantStarshards(player, STARSHARDS_DAILY_LOGIN);
  universe.players[player.id] = player;
  return { ok: true, starshardsGranted: STARSHARDS_DAILY_LOGIN };
}

/**
 * Claim a finished daily or weekly goal.
 * Advances first so offline flights catch up into the open period.
 */
export function claimPlayerGoal(
  universe: UniverseState,
  playerId: string,
  goalId: string,
  now = Date.now(),
): GoalActionResult {
  if (!universe.players[playerId]) {
    return { ok: false, error: "Unknown player." };
  }
  advanceUniverse(universe, now);
  return claimGoal(universe, playerId, goalId, now);
}

/** Hire / renew an officer for Starshards (7d wall-clock). */
export function activateOfficer(
  universe: UniverseState,
  playerId: string,
  officerId: OfficerId,
  now = Date.now(),
): StarshardActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = OFFICERS[officerId];
  if (!def) return { ok: false, error: "Unknown officer." };

  advanceUniverse(universe, now);
  pruneExpiredOfficers(player, now);

  const balance = Math.floor(player.starshards ?? 0);
  if (balance < def.cost) {
    return {
      ok: false,
      error: `Need ${def.cost} Starshards (have ${balance}).`,
    };
  }

  player.starshards = balance - def.cost;
  const others = (player.officers ?? []).filter(
    (o) => o.officerId !== officerId,
  );
  others.push({
    officerId,
    activatedAt: now,
    expiresAt: now + def.durationMs,
  });
  player.officers = others;
  ensureProgressionLevels(player);
  if ((player.officerLevels?.[officerId] ?? 0) < 1) {
    player.officerLevels = { ...(player.officerLevels ?? {}), [officerId]: 1 };
  }
  universe.players[player.id] = player;
  return { ok: true };
}

function fmtShards(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

/** Raise a hired officer's permanent level (max 10). Does not extend duty. */
export function raiseOfficer(
  universe: UniverseState,
  playerId: string,
  officerId: OfficerId,
  now = Date.now(),
): StarshardActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = OFFICERS[officerId];
  if (!def) return { ok: false, error: "Unknown officer." };

  advanceUniverse(universe, now);
  ensureProgressionLevels(player);
  const level = officerLevelOf(player, officerId);
  if (level < 1) {
    return { ok: false, error: `Hire ${def.name} before raising their level.` };
  }
  if (level >= OFFICER_MAX_LEVEL) {
    return { ok: false, error: `${def.name} is already at max level.` };
  }
  const cost = levelUpCost(def.cost, level);
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < cost) {
    return {
      ok: false,
      error: `Need ${fmtShards(cost)} Starshards (have ${fmtShards(balance)}).`,
    };
  }
  player.starshards = balance - cost;
  player.officerLevels = { ...(player.officerLevels ?? {}), [officerId]: level + 1 };
  universe.players[player.id] = player;
  return { ok: true };
}

/** Permanently unlock a skill node for Starshards. */
export function unlockSkill(
  universe: UniverseState,
  playerId: string,
  skillId: string,
  now = Date.now(),
): StarshardActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = SKILLS[skillId];
  if (!def) return { ok: false, error: "Unknown skill." };

  advanceUniverse(universe, now);
  ensureProgressionLevels(player);
  const level = skillLevelOf(player, skillId);
  if (level >= SKILL_MAX_LEVEL) {
    return { ok: false, error: `${def.name} is already at max level.` };
  }
  if (level < 1) {
    for (const req of def.requires) {
      if (skillLevelOf(player, req) < 1) {
        const reqName = SKILLS[req]?.name ?? "the previous skill";
        return { ok: false, error: `Requires ${reqName} first.` };
      }
    }
  }
  const cost = levelUpCost(def.cost, level);
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < cost) {
    return {
      ok: false,
      error: `Need ${fmtShards(cost)} Starshards (have ${fmtShards(balance)}).`,
    };
  }

  player.starshards = balance - cost;
  player.skillLevels = { ...(player.skillLevels ?? {}), [skillId]: level + 1 };
  const unlocked = new Set(player.skillsUnlocked ?? []);
  unlocked.add(skillId);
  player.skillsUnlocked = [...unlocked];
  universe.players[player.id] = player;
  return { ok: true };
}
