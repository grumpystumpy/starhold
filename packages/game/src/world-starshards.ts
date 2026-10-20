import { OFFICERS, officerRenewalCost, officerRenewalDurationMs } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import { OFFICER_MAX_LEVEL, SKILL_MAX_LEVEL, STARSHARDS_DAILY_LOGIN } from "./catalog.js";
import { levelUpCost } from "./formulas-levels.js";
import { storageFor } from "./formulas-build.js";
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

export type ResourceTradeDirection = "buy" | "sell";

const STARSHARDS_PER_RESOURCE_TRADE = 1500;
const RESOURCES_PER_TRADE = { metal: 3000, crystal: 2000, deuterium: 1000 };

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

/** Exchange one fixed resource bundle for 1500 Starshards, or vice versa. */
export function tradeStarshardsForResources(
  universe: UniverseState,
  playerId: string,
  planetId: string | undefined,
  direction: ResourceTradeDirection,
  now = Date.now(),
): StarshardActionResult {
  if (!universe.players[playerId]) return { ok: false, error: "Unknown player." };
  if (direction !== "buy" && direction !== "sell") {
    return { ok: false, error: "Invalid trade direction." };
  }

  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const id = planetId || player.activePlanetId || player.homePlanetId;
  if (!player.planetIds.includes(id)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[id];
  if (!planet) return { ok: false, error: "Planet missing." };

  if (direction === "buy") {
    const balance = Math.floor(player.starshards ?? 0);
    if (balance < STARSHARDS_PER_RESOURCE_TRADE) {
      return {
        ok: false,
        error: `Need ${fmtShards(STARSHARDS_PER_RESOURCE_TRADE)} Starshards (have ${fmtShards(balance)}).`,
      };
    }
    const caps = storageFor(planet);
    for (const resource of ["metal", "crystal", "deuterium"] as const) {
      if (
        planet.resources[resource] + RESOURCES_PER_TRADE[resource] >
        caps[resource]
      ) {
        return {
          ok: false,
          error: `${resource} storage is too full for this trade.`,
        };
      }
    }
    player.starshards = balance - STARSHARDS_PER_RESOURCE_TRADE;
    planet.resources = {
      metal: planet.resources.metal + RESOURCES_PER_TRADE.metal,
      crystal: planet.resources.crystal + RESOURCES_PER_TRADE.crystal,
      deuterium: planet.resources.deuterium + RESOURCES_PER_TRADE.deuterium,
    };
  } else {
    for (const resource of ["metal", "crystal", "deuterium"] as const) {
      if (planet.resources[resource] < RESOURCES_PER_TRADE[resource]) {
        return {
          ok: false,
          error: `Need ${fmtShards(RESOURCES_PER_TRADE[resource])} ${resource} for this trade.`,
        };
      }
    }
    planet.resources = {
      metal: planet.resources.metal - RESOURCES_PER_TRADE.metal,
      crystal: planet.resources.crystal - RESOURCES_PER_TRADE.crystal,
      deuterium: planet.resources.deuterium - RESOURCES_PER_TRADE.deuterium,
    };
    player.starshards = Math.floor(player.starshards ?? 0) +
      STARSHARDS_PER_RESOURCE_TRADE;
  }
  universe.players[player.id] = player;
  universe.planets[planet.id] = planet;
  return { ok: true };
}

/** Hire / renew an officer for Starshards. */
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

  const renewals = Math.max(0, Math.floor(player.officerRenewals?.[officerId] ?? 0));
  const cost = officerRenewalCost(def.cost, renewals);
  const durationMs = officerRenewalDurationMs(renewals);

  const balance = Math.floor(player.starshards ?? 0);
  if (balance < cost) {
    return {
      ok: false,
      error: `Need ${cost} Starshards (have ${balance}).`,
    };
  }

  player.starshards = balance - cost;
  const others = (player.officers ?? []).filter(
    (o) => o.officerId !== officerId,
  );
  others.push({
    officerId,
    activatedAt: now,
    expiresAt: now + durationMs,
  });
  player.officers = others;
  player.officerRenewals = {
    ...(player.officerRenewals ?? {}),
    [officerId]: renewals + 1,
  };
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
