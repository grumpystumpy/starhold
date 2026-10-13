import { OFFICERS } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import {
  PIRATE_DEFENSE_WIN_STARSHARDS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
} from "./catalog.js";
import type {
  OfficerEffect,
  OfficerState,
  PlayerState,
} from "./types.js";

/** Aggregated officer + skill multipliers / flat adds for the player. */
export interface PlayerBoosts {
  mineOutput: number;
  researchSpeed: number;
  fleetSpeed: number;
  fleetSlots: number;
  defensePower: number;
  energyOutput: number;
  espionageLevel: number;
}

export function emptyBoosts(): PlayerBoosts {
  return {
    mineOutput: 1,
    researchSpeed: 1,
    fleetSpeed: 1,
    fleetSlots: 0,
    defensePower: 1,
    energyOutput: 1,
    espionageLevel: 0,
  };
}

function applyEffect(boosts: PlayerBoosts, effect: OfficerEffect): void {
  switch (effect.kind) {
    case "mineOutput":
    case "researchSpeed":
    case "fleetSpeed":
    case "defensePower":
    case "energyOutput":
      boosts[effect.kind] *= effect.value;
      break;
    case "fleetSlots":
    case "espionageLevel":
      boosts[effect.kind] += effect.value;
      break;
    default: {
      const _exhaustive: never = effect.kind;
      throw new Error(`Unhandled effect kind: ${_exhaustive}`);
    }
  }
}

/** Drop expired officer hires (mutates player.officers). */
export function pruneExpiredOfficers(
  player: PlayerState,
  now: number,
): OfficerState[] {
  const live = (player.officers ?? []).filter((o) => o.expiresAt > now);
  player.officers = live;
  return live;
}

/** Combine active officers + unlocked skills into boosts. */
export function playerBoosts(
  player: PlayerState | undefined,
  now: number,
): PlayerBoosts {
  const boosts = emptyBoosts();
  if (!player) return boosts;
  const officers = pruneExpiredOfficers(player, now);
  for (const o of officers) {
    const def = OFFICERS[o.officerId];
    if (!def) continue;
    for (const effect of def.effects) applyEffect(boosts, effect);
  }
  for (const id of player.skillsUnlocked ?? []) {
    const def = SKILLS[id];
    if (!def) continue;
    for (const effect of def.effects) applyEffect(boosts, effect);
  }
  return boosts;
}

export function grantStarshards(player: PlayerState, amount: number): number {
  const add = Math.max(0, Math.floor(amount));
  player.starshards = Math.max(0, Math.floor(player.starshards ?? 0) + add);
  return player.starshards;
}

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function canClaimDailyLogin(
  player: PlayerState,
  now: number,
): boolean {
  return player.lastDailyLoginUtc !== utcDayKey(now);
}

/**
 * Grant Starshards when a pirate base is destroyed (live `pirateRaid` win).
 * Amount matches `pirateDestroyStarshards(tier)` / contract v1.
 */
export function grantPirateDestroyStarshards(
  player: PlayerState,
  tier: number,
): number {
  const t = Math.max(0, Math.floor(tier));
  const amount =
    PIRATE_DESTROY_STARSHARDS_BASE + PIRATE_DESTROY_STARSHARDS_PER_TIER * t;
  grantStarshards(player, amount);
  return amount;
}

/**
 * Grant Starshards when the player wins defense vs an NPC pirate raid
 * (`PIRATE_DEFENSE_WIN_STARSHARDS`, contract pirate fleet kill).
 */
export function grantPirateFleetKillStarshards(player: PlayerState): number {
  grantStarshards(player, PIRATE_DEFENSE_WIN_STARSHARDS);
  return PIRATE_DEFENSE_WIN_STARSHARDS;
}

/** Deterministic Starshard find amount 5..25 from expedition roll. */
export function expeditionStarshardsAmount(roll: number): number {
  return 5 + (roll % 21);
}
