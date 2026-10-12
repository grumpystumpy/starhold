import {
  DEBRIS_FROM_SHIPS,
  DEFENSE_ORDER,
  DEFENSES,
  RAID_LOOT_SHARE,
  SHIPS,
  SHIP_ORDER,
} from "./catalog.js";
import type {
  CombatOutcome,
  DefenseStock,
  FleetShips,
  ResearchLevels,
  Resources,
  ShipId,
} from "./types.js";
import {
  emptyDefenses,
  emptyFleetShips,
  fleetCargoCapacity,
  normalizeFleetShips,
} from "./formulas-travel.js";

function unitCombatPower(
  attack: number,
  shield: number,
  hull: number,
  research: ResearchLevels | undefined,
): number {
  const w = 1 + (research?.weaponsTech ?? 0) * 0.08;
  const s = 1 + (research?.shieldingTech ?? 0) * 0.08;
  const a = 1 + (research?.armourTech ?? 0) * 0.08;
  return attack * w + 0.5 * shield * s + 0.3 * hull * a;
}

/**
 * Combat power score (invented):
 * power = sum count * (attack + 0.5*shield + 0.3*hull) with research bonuses
 */
export function fleetCombatPower(
  ships: FleetShips,
  research?: ResearchLevels,
): number {
  let power = 0;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n <= 0) continue;
    const d = SHIPS[id];
    power +=
      n * unitCombatPower(d.attack, d.shield, d.hull, research);
  }
  return power;
}

export function defenseCombatPower(
  defenses: DefenseStock,
  research?: ResearchLevels,
): number {
  let power = 0;
  for (const id of DEFENSE_ORDER) {
    const n = defenses[id] ?? 0;
    if (n <= 0) continue;
    const d = DEFENSES[id];
    power +=
      n * unitCombatPower(d.attack, d.shield, d.hull, research);
  }
  return power;
}

function scaleFleet(ships: FleetShips, keepRatio: number): FleetShips {
  const ratio = Math.min(1, Math.max(0, keepRatio));
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.floor((ships[id] ?? 0) * ratio);
  }
  return out;
}

function scaleDefenses(
  defenses: DefenseStock,
  keepRatio: number,
): DefenseStock {
  const ratio = Math.min(1, Math.max(0, keepRatio));
  const out = emptyDefenses();
  for (const id of DEFENSE_ORDER) {
    out[id] = Math.floor((defenses[id] ?? 0) * ratio);
  }
  return out;
}

/** Metal/crystal cost of ships that were destroyed (before -> after). */
export function destroyedShipResources(
  before: FleetShips,
  after: FleetShips,
): Resources {
  let metal = 0;
  let crystal = 0;
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (before[id] ?? 0) - (after[id] ?? 0));
    if (lost <= 0) continue;
    const c = SHIPS[id].cost;
    metal += c.metal * lost;
    crystal += c.crystal * lost;
  }
  return { metal, crystal, deuterium: 0 };
}

export function debrisFromDestroyed(destroyed: Resources): Resources {
  return {
    metal: Math.floor(destroyed.metal * DEBRIS_FROM_SHIPS),
    crystal: Math.floor(destroyed.crystal * DEBRIS_FROM_SHIPS),
    deuterium: 0,
  };
}

export interface CombatResolution {
  outcome: CombatOutcome;
  attackerAfter: FleetShips;
  defenderAfter: FleetShips;
  defensesAfter: DefenseStock;
  summary: string;
}

/**
 * Deterministic raid resolution (basics-first) including static defenses.
 */
export function resolveCombat(
  attacker: FleetShips,
  defender: FleetShips,
  defenses: DefenseStock = emptyDefenses(),
  attackerResearch?: ResearchLevels,
  defenderResearch?: ResearchLevels,
): CombatResolution {
  const atk = fleetCombatPower(attacker, attackerResearch);
  const def =
    fleetCombatPower(defender, defenderResearch) +
    defenseCombatPower(defenses, defenderResearch);

  if (def <= 0 && atk > 0) {
    return {
      outcome: "attacker_win",
      attackerAfter: { ...normalizeFleetShips(attacker) },
      defenderAfter: emptyFleetShips(),
      defensesAfter: emptyDefenses(),
      summary: `Unopposed landing (atk ${atk.toFixed(0)}). Garrison empty.`,
    };
  }

  if (atk >= def * 1.1) {
    return {
      outcome: "attacker_win",
      attackerAfter: scaleFleet(attacker, 0.8),
      defenderAfter: scaleFleet(defender, 0.3),
      defensesAfter: scaleDefenses(defenses, 0.3),
      summary: `Attacker breakthrough (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
    };
  }

  if (def >= atk * 1.1) {
    return {
      outcome: "defender_win",
      attackerAfter: scaleFleet(attacker, 0.3),
      defenderAfter: scaleFleet(defender, 0.8),
      defensesAfter: scaleDefenses(defenses, 0.8),
      summary: `Defenders held (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
    };
  }

  return {
    outcome: "draw",
    attackerAfter: scaleFleet(attacker, 0.6),
    defenderAfter: scaleFleet(defender, 0.6),
    defensesAfter: scaleDefenses(defenses, 0.6),
    summary: `Inconclusive clash (atk ${atk.toFixed(0)} vs def ${def.toFixed(0)}).`,
  };
}

/**
 * Loot on attacker win: RAID_LOOT_SHARE of each resource, capped by surviving cargo.
 * Priority fill: metal -> crystal -> deuterium.
 */
export function computeRaidLoot(
  defenderResources: Resources,
  survivingAttacker: FleetShips,
): Resources {
  const capacity = fleetCargoCapacity(survivingAttacker);
  if (capacity <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }

  const available = {
    metal: Math.floor(Math.floor(defenderResources.metal) * RAID_LOOT_SHARE),
    crystal: Math.floor(Math.floor(defenderResources.crystal) * RAID_LOOT_SHARE),
    deuterium: Math.floor(
      Math.floor(defenderResources.deuterium) * RAID_LOOT_SHARE,
    ),
  };

  let remaining = capacity;
  const loot: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  for (const key of ["metal", "crystal", "deuterium"] as const) {
    const take = Math.min(available[key], remaining);
    loot[key] = take;
    remaining -= take;
  }
  return loot;
}

/** Espionage detail 0-3 from spy tech vs target (target lab as counter). */
export function espionageDetail(
  spyTech: number,
  targetLabLevel: number,
): number {
  const score = spyTech - Math.floor(targetLabLevel / 2);
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  if (score >= 0) return 1;
  return 0;
}

export function maxFleetSlots(computerTech: number): number {
  return 1 + Math.max(0, computerTech);
}

export function maxColonies(astrophysics: number): number {
  // Home + astrophysics levels.
  return 1 + Math.max(0, astrophysics);
}
