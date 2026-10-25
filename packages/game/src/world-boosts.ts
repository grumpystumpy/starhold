import { OFFICERS } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import { scaleEffect } from "./formulas-levels.js";
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
import { officerLevelOf, skillLevelOf } from "./world-progression.js";
import { storageFor } from "./formulas-build.js";
import type { PlanetState, UniverseState } from "./types.js";

/** Aggregated officer + skill multipliers / flat adds for the player. */
export interface PlayerBoosts {
  mineOutput: number;
  researchSpeed: number;
  fleetSpeed: number;
  fleetSlots: number;
  defensePower: number;
  energyOutput: number;
  storageCapacity: number;
  espionageLevel: number;
  hullBuff: number;
  armorBuff: number;
  shieldBuff: number;
}

export function emptyBoosts(): PlayerBoosts {
  return {
    mineOutput: 1,
    researchSpeed: 1,
    fleetSpeed: 1,
    fleetSlots: 0,
    defensePower: 1,
    energyOutput: 1,
    storageCapacity: 1,
    espionageLevel: 0,
    hullBuff: 1,
    armorBuff: 1,
    shieldBuff: 1,
  };
}

function applyEffect(boosts: PlayerBoosts, effect: OfficerEffect): void {
  switch (effect.kind) {
    case "mineOutput":
    case "researchSpeed":
    case "fleetSpeed":
    case "defensePower":
    case "energyOutput":
    case "storageCapacity":
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
  if (player.officers !== undefined) player.officers = live;
  return live;
}

/** Storage caps with the active Vaultkeeper boost for owned planets only. */
export function storageForPlanet(
  source: UniverseState | PlayerState | undefined,
  planet: PlanetState,
  now: number,
) {
  const owner = source && "players" in source
    ? source.players[planet.ownerPlayerId]
    : source && "planetIds" in source
      ? source
      : undefined;
  const owned = !!owner?.planetIds.includes(planet.id);
  return storageFor(
    planet,
    owned ? playerBoosts(owner, now).storageCapacity : 1,
  );
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
    const level = Math.max(1, officerLevelOf(player, o.officerId));
    for (const effect of def.effects) {
      applyEffect(boosts, scaleEffect(effect, level));
    }
  }
  const skillIds = new Set<string>([
    ...Object.keys(player.skillLevels ?? {}),
    ...(player.skillsUnlocked ?? []),
  ]);
  for (const id of skillIds) {
    const level = skillLevelOf(player, id);
    if (level < 1) continue;
    const def = SKILLS[id];
    if (!def) continue;
    for (const effect of def.effects) {
      applyEffect(boosts, scaleEffect(effect, level));
    }
  }

  // Active item buffs
  if (player.itemBuffs && player.itemBuffs.length > 0) {
    const active = player.itemBuffs.filter((b) => b.expiresAt > now);
    for (const itemBuff of active) {
      if (itemBuff.category === "fleet_slots") {
        boosts.fleetSlots += itemBuff.bonus;
      } else if (itemBuff.category === "buff_hull") {
        boosts.hullBuff *= 1 + itemBuff.bonus / 100;
      } else if (itemBuff.category === "buff_armor") {
        boosts.armorBuff *= 1 + itemBuff.bonus / 100;
      } else if (itemBuff.category === "buff_shield") {
        boosts.shieldBuff *= 1 + itemBuff.bonus / 100;
      }
    }
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
