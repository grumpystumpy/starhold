import {
  ALIEN_RAID_DETERRENCE_PENALTY,
  ALIEN_RAID_DETERRENCE_STEP_UNITS,
  DEFENSE_ORDER,
  NEWBIE_PROTECTION_POINTS,
  NPC_RAID_DETERRENCE_FLOOR,
  PIRATE_FAIRNESS_PENALTY_PER_RAID,
  PIRATE_FAIRNESS_POINTS_MAX,
  PIRATE_RAID_DETERRENCE_PENALTY,
  PIRATE_RAID_DETERRENCE_STEP_UNITS,
  SHIP_ORDER,
} from "./catalog.js";
import { empirePoints } from "./formulas.js";
import type { PlanetState, PlayerState, UniverseState } from "./types.js";
import { utcDayKey } from "./world-boosts.js";

/** Count stationed ships plus defense units on a planet. */
export function planetStationedUnits(planet: PlanetState): number {
  let count = 0;
  if (planet.ships) {
    for (const id of SHIP_ORDER) {
      count += Math.max(0, Math.floor(planet.ships[id] ?? 0));
    }
  }
  if (planet.defenses) {
    for (const id of DEFENSE_ORDER) {
      count += Math.max(0, Math.floor(planet.defenses[id] ?? 0));
    }
  }
  return count;
}

/**
 * Deterrence factor for NPC raids on a planet:
 * drops by 0.5% per full 1,500 ships+defenses for pirates,
 * 0.5% per full 3,000 ships+defenses for aliens; floor 3%.
 */
export function planetRaidDeterrence(
  planet: PlanetState,
  faction: "pirate" | "alien",
): number {
  const units = planetStationedUnits(planet);
  const stepUnits =
    faction === "pirate"
      ? PIRATE_RAID_DETERRENCE_STEP_UNITS
      : ALIEN_RAID_DETERRENCE_STEP_UNITS;
  const penalty =
    faction === "pirate"
      ? PIRATE_RAID_DETERRENCE_PENALTY
      : ALIEN_RAID_DETERRENCE_PENALTY;
  const fullSteps = Math.floor(units / stepUnits);
  return Math.max(NPC_RAID_DETERRENCE_FLOOR, 1.0 - fullSteps * penalty);
}

/** Pirates ignore a new player until 48 hours after creation. */
export const PIRATE_NEW_PLAYER_PROTECTION_MS = 48 * 60 * 60 * 1000;

export const NEWBIE_BONUS_DURATION_MS = 96 * 60 * 60 * 1000;
export const NEWBIE_PRODUCTION_MULT = 1.5;
export const NEWBIE_DEFENSE_MULT = 2.0;

export function newbieBonusRemainingMs(
  universe: UniverseState,
  player: PlayerState | undefined,
  now: number,
): number {
  if (
    !player || typeof player.createdAt !== "number" || player.createdAt <= 0 ||
    now < player.createdAt || now - player.createdAt >= NEWBIE_BONUS_DURATION_MS
  ) return 0;
  if (player.newbieForfeitedAt != null) return 0;
  if (isNewbieProtected(universe, player)) {
    return Math.max(0, player.createdAt + NEWBIE_BONUS_DURATION_MS - now);
  }
  return 0;
}

export function isNewbieBonusActive(
  universe: UniverseState,
  player: PlayerState | undefined,
  now: number,
): boolean {
  return newbieBonusRemainingMs(universe, player, now) > 0;
}

/** True while below the points threshold and before the player forfeits protection. */
export function isNewbieProtected(
  universe: UniverseState,
  player: PlayerState,
): boolean {
  return (
    player.newbieForfeitedAt == null &&
    empirePoints(universe, player) < NEWBIE_PROTECTION_POINTS
  );
}

/**
 * Pirate pick weight for a player planet target.
 * Newbie-protected → 0. At/above fairness max → 1. Otherwise
 * `max(0, 1 − raidsToday × 0.01)` with UTC-day reset.
 * Aliens must not call this path.
 */
export function pirateRaidPickWeight(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): number {
  const attackedPiratesAt = (player as PlayerState & { attackedPiratesAt?: number })
    .attackedPiratesAt;
  if (
    attackedPiratesAt == null &&
    now - player.createdAt < PIRATE_NEW_PLAYER_PROTECTION_MS
  ) {
    return 0;
  }
  const points = empirePoints(universe, player);
  if (points < NEWBIE_PROTECTION_POINTS) return 0;
  if (points >= PIRATE_FAIRNESS_POINTS_MAX) return 1;
  const day = utcDayKey(now);
  const state = player.pirateRaidFairness;
  const raids =
    state && state.dayKey === day ? Math.max(0, state.successfulRaids) : 0;
  return Math.max(0, 1 - raids * PIRATE_FAIRNESS_PENALTY_PER_RAID);
}

/** Record a successful pirate (not alien) raid on this player for the UTC day. */
export function recordSuccessfulPirateRaid(
  player: PlayerState,
  now: number,
): void {
  const day = utcDayKey(now);
  const prev = player.pirateRaidFairness;
  if (prev && prev.dayKey === day) {
    player.pirateRaidFairness = {
      dayKey: day,
      successfulRaids: prev.successfulRaids + 1,
    };
  } else {
    player.pirateRaidFairness = { dayKey: day, successfulRaids: 1 };
  }
}

/**
 * Clear newbie protection by raising storage buildings (no combat skew).
 * Used by unit fixtures and CI e2e hooks only.
 */
export function graduateNewbieProtection(
  universe: UniverseState,
  player: PlayerState,
): void {
  const planet = universe.planets[player.homePlanetId];
  if (!planet) return;
  planet.buildings.metalStorage = Math.max(
    planet.buildings.metalStorage ?? 0,
    20,
  );
  planet.buildings.crystalStorage = Math.max(
    planet.buildings.crystalStorage ?? 0,
    20,
  );
  planet.buildings.deutTank = Math.max(planet.buildings.deutTank ?? 0, 20);
}
