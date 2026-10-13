import { OFFICERS } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import { STARSHARDS_DAILY_LOGIN } from "./catalog.js";
import type { OfficerId, UniverseState } from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import {
  canClaimDailyLogin,
  grantStarshards,
  pruneExpiredOfficers,
  utcDayKey,
} from "./world-boosts.js";
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
  const unlocked = new Set(player.skillsUnlocked ?? []);
  if (unlocked.has(skillId)) {
    return { ok: false, error: "Skill already unlocked." };
  }
  for (const req of def.requires) {
    if (!unlocked.has(req)) {
      return { ok: false, error: `Requires skill ${req} first.` };
    }
  }
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < def.cost) {
    return {
      ok: false,
      error: `Need ${def.cost} Starshards (have ${balance}).`,
    };
  }

  player.starshards = balance - def.cost;
  player.skillsUnlocked = [...unlocked, skillId];
  universe.players[player.id] = player;
  return { ok: true };
}
