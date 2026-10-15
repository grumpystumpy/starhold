import {
  FLAT_BONUS_LEVELS_PER_STEP,
  OFFICER_MAX_LEVEL,
  SKILL_MAX_LEVEL,
} from "./catalog.js";
import type { OfficerEffect, OfficerEffectKind } from "./types.js";

const FLAT_KINDS = new Set<OfficerEffectKind>(["fleetSlots", "espionageLevel"]);

/**
 * How many copies of a flat bonus apply at this level.
 * Level 1 is one step (the old unlock). Every
 * `FLAT_BONUS_LEVELS_PER_STEP` levels after that adds another step.
 * Level 10 with a step of 3 is 4.
 */
export function flatBonusSteps(level: number): number {
  const lvl = Math.floor(level);
  if (lvl < 1) return 0;
  return 1 + Math.floor((lvl - 1) / FLAT_BONUS_LEVELS_PER_STEP);
}

/**
 * Scale a catalog effect to a skill or officer level.
 * Multipliers: `1 + (base - 1) * level` so level 1 matches the catalog value.
 * Flat adds: `base * flatBonusSteps(level)`.
 */
export function scaleEffect(effect: OfficerEffect, level: number): OfficerEffect {
  const lvl = Math.floor(level);
  if (FLAT_KINDS.has(effect.kind)) {
    return { kind: effect.kind, value: effect.value * flatBonusSteps(lvl) };
  }
  if (lvl < 1) return { kind: effect.kind, value: 1 };
  return { kind: effect.kind, value: 1 + (effect.value - 1) * lvl };
}

/**
 * Starshard cost to go from `currentLevel` to the next one.
 * Level 0 → 1 costs the catalog base (today's unlock / hire price).
 * Level L → L+1 costs `baseCost * (L + 1)`.
 */
export function levelUpCost(baseCost: number, currentLevel: number): number {
  const level = Math.max(0, Math.floor(currentLevel));
  return Math.floor(baseCost * (level + 1));
}

export function skillLevelCap(): number {
  return SKILL_MAX_LEVEL;
}

export function officerLevelCap(): number {
  return OFFICER_MAX_LEVEL;
}
