import type {
  PlayerState,
  ResearchLevels,
  Resources,
} from "./types.js";

/** XP required to advance from level L → L+1 (v1). */
export function xpToNext(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return Math.floor(100 * Math.pow(L, 1.45));
}

export interface LevelBonuses {
  /** Resource production multiplier. */
  production: number;
  /** Building time multiplier (floor 0.70). */
  buildTime: number;
  /** Research time multiplier (floor 0.70). */
  researchTime: number;
  /** Fleet flight time multiplier (floor 0.75). */
  fleetTime: number;
  /** Ship build time multiplier (floor 0.65). */
  shipBuild: number;
  /** Virtual weapons tech levels. */
  weaponsBonus: number;
  /** Virtual shielding tech levels. */
  shieldingBonus: number;
}

/** Per-level bonuses at player level L; n = L - 1. */
export function levelBonuses(level: number): LevelBonuses {
  const n = Math.max(0, Math.floor(level) - 1);
  return {
    production: 1 + 0.005 * n,
    buildTime: Math.max(0.7, 1 - 0.004 * n),
    researchTime: Math.max(0.7, 1 - 0.004 * n),
    fleetTime: Math.max(0.75, 1 - 0.003 * n),
    shipBuild: Math.max(0.65, 1 - 0.005 * n),
    weaponsBonus: Math.floor(n / 5),
    shieldingBonus: Math.floor(n / 5),
  };
}

/** Ensure progress fields exist (defaults: level 1, xp 0). */
export function ensurePlayerProgress(player: PlayerState): void {
  if (player.level == null || player.level < 1) player.level = 1;
  if (player.xp == null || player.xp < 0) player.xp = 0;
  if (player.xpTotal == null || player.xpTotal < 0) player.xpTotal = 0;
}

/**
 * Grant XP and apply level-ups. Mutates player.
 * @returns levels gained
 */
export function grantPlayerXp(player: PlayerState, amount: number): number {
  const add = Math.max(0, Math.floor(amount));
  if (add <= 0) return 0;
  ensurePlayerProgress(player);
  let level = player.level ?? 1;
  let xp = player.xp ?? 0;
  let xpTotal = player.xpTotal ?? 0;
  xpTotal += add;
  xp += add;
  let gained = 0;
  // No max level — loop until xp is below the current threshold.
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    gained += 1;
  }
  player.level = level;
  player.xp = xp;
  player.xpTotal = xpTotal;
  return gained;
}

export function xpForBuilding(targetLevel: number): number {
  return 8 + 2 * Math.max(1, Math.floor(targetLevel));
}

export function xpForResearch(targetLevel: number): number {
  return 12 + 3 * Math.max(1, Math.floor(targetLevel));
}

/** Win combat: 25 + floor(cost/500), bonus capped +200. */
export function xpForCombatWin(destroyedEnemyCost: number): number {
  const bonus = Math.min(200, Math.floor(Math.max(0, destroyedEnemyCost) / 500));
  return 25 + bonus;
}

export function xpForCombatLose(): number {
  return 8;
}

/** Expedition resolve with any non-empty outcome. */
export function xpForExpedition(): number {
  return 15;
}

/** Mini-planet discovery (Thread L) — stub amount. */
export function xpForMiniPlanetDiscovery(): number {
  return 40;
}

export function xpForPirateBaseDestroy(baseLevel: number): number {
  return 50 + 10 * Math.max(0, Math.floor(baseLevel));
}

/**
 * Pirate ship kills: 5 XP per 1000 ship cost destroyed, cap 100 / battle.
 */
export function xpForPirateShipKills(destroyedEnemyCost: number): number {
  return Math.min(
    100,
    Math.floor(Math.max(0, destroyedEnemyCost) / 1000) * 5,
  );
}

/** Sum metal+crystal+deuterium as a single cost figure for XP formulas. */
export function resourcesCostTotal(res: Resources): number {
  return (
    Math.max(0, res.metal) +
    Math.max(0, res.crystal) +
    Math.max(0, res.deuterium ?? 0)
  );
}

/** Research levels with virtual weapons/shielding from player level. */
export function effectiveCombatResearch(
  player: PlayerState | undefined,
): ResearchLevels | undefined {
  if (!player) return undefined;
  ensurePlayerProgress(player);
  const lb = levelBonuses(player.level ?? 1);
  return {
    ...player.research,
    weaponsTech: (player.research.weaponsTech ?? 0) + lb.weaponsBonus,
    shieldingTech: (player.research.shieldingTech ?? 0) + lb.shieldingBonus,
  };
}

export interface PlayerProgressView {
  level: number;
  xp: number;
  xpToNext: number;
  xpTotal: number;
}

export function playerProgressView(player: PlayerState): PlayerProgressView {
  ensurePlayerProgress(player);
  const level = player.level ?? 1;
  const xp = player.xp ?? 0;
  const xpTotal = player.xpTotal ?? 0;
  return {
    level,
    xp,
    xpToNext: xpToNext(level),
    xpTotal,
  };
}
