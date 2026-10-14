import {
  DEBRIS_FROM_SHIPS,
  DEFENSE_ORDER,
  DEFENSES,
  MAX_COMBAT_ROUNDS,
  RAID_LOOT_SHARE,
  SHIPS,
  SHIP_ORDER,
  SWARM_INTERCEPT_FRACTION,
  SWARM_INTERCEPT_SPLIT,
  SWARM_KAMIKAZE_HULL_DMG,
  SWARM_KAMIKAZE_HULL_FRAC,
  SWARM_KAMIKAZE_SHIELD_DMG,
  rapidFireFactor,
  type CombatUnitId,
} from "./catalog.js";
import type {
  CombatOutcome,
  DefenseId,
  DefenseStock,
  FleetShips,
  ResearchLevels,
  Resources,
  ShipId,
} from "./types.js";
import { swarmDroneAttackMult } from "./formulas-round2.js";
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

function unitAtk(
  attack: number,
  research: ResearchLevels | undefined,
): number {
  return attack * (1 + (research?.weaponsTech ?? 0) * 0.08);
}

function unitHp(
  shield: number,
  hull: number,
  research: ResearchLevels | undefined,
): number {
  const s = shield * (1 + (research?.shieldingTech ?? 0) * 0.08);
  const h = hull * (1 + (research?.armourTech ?? 0) * 0.08);
  return Math.max(1, s + h);
}

/**
 * Rough combat power score for UI / heuristics (not raid resolution).
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
    power += n * unitCombatPower(d.attack, d.shield, d.hull, research);
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
    power += n * unitCombatPower(d.attack, d.shield, d.hull, research);
  }
  return power;
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
    if (SHIPS[id].noDebris) continue;
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
  rounds: number;
  summary: string;
}

type SidePools = {
  ships: FleetShips;
  defenses: DefenseStock;
  /** Residual damage toward next kill, keyed by CombatUnitId. */
  residual: Partial<Record<CombatUnitId, number>>;
};

function shipCount(ships: FleetShips): number {
  let n = 0;
  for (const id of SHIP_ORDER) n += ships[id] ?? 0;
  return n;
}

function defenseCount(defenses: DefenseStock): number {
  let n = 0;
  for (const id of DEFENSE_ORDER) n += defenses[id] ?? 0;
  return n;
}

function livingShipIds(ships: FleetShips): ShipId[] {
  return SHIP_ORDER.filter((id) => (ships[id] ?? 0) > 0);
}

function livingDefenseIds(defenses: DefenseStock): DefenseId[] {
  return DEFENSE_ORDER.filter((id) => (defenses[id] ?? 0) > 0);
}

function pickFocusTarget(
  ships: FleetShips,
  defenses: DefenseStock,
): CombatUnitId | null {
  let best: CombatUnitId | null = null;
  let bestCount = 0;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  for (const id of DEFENSE_ORDER) {
    const n = defenses[id] ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

function targetHp(
  id: CombatUnitId,
  research: ResearchLevels | undefined,
): number {
  if ((SHIP_ORDER as string[]).includes(id)) {
    const d = SHIPS[id as ShipId];
    return unitHp(d.shield, d.hull, research);
  }
  const d = DEFENSES[id as DefenseId];
  return unitHp(d.shield, d.hull, research);
}

function targetCount(side: SidePools, id: CombatUnitId): number {
  if ((SHIP_ORDER as string[]).includes(id)) {
    return side.ships[id as ShipId] ?? 0;
  }
  return side.defenses[id as DefenseId] ?? 0;
}

function applyDamageToTarget(
  side: SidePools,
  id: CombatUnitId,
  damage: number,
  research: ResearchLevels | undefined,
): void {
  if (damage <= 0) return;
  const hp = targetHp(id, research);
  const pool = (side.residual[id] ?? 0) + damage;
  const kills = Math.floor(pool / hp);
  const rem = pool - kills * hp;
  side.residual[id] = rem;
  if (kills <= 0) return;
  if ((SHIP_ORDER as string[]).includes(id)) {
    const sid = id as ShipId;
    side.ships[sid] = Math.max(0, (side.ships[sid] ?? 0) - kills);
    if (side.ships[sid] === 0) side.residual[id] = 0;
  } else {
    const did = id as DefenseId;
    side.defenses[did] = Math.max(0, (side.defenses[did] ?? 0) - kills);
    if (side.defenses[did] === 0) side.residual[id] = 0;
  }
}

/**
 * Redirect mothership-targeted damage to escorts.
 * Drones alone take SWARM_INTERCEPT_FRACTION; with harvesters, intercepted
 * portion splits 50/50 (drones priority for odd remainder).
 */
export function redistributeSwarmIntercept(
  target: CombatUnitId,
  damage: number,
  side: SidePools,
): Array<{ target: CombatUnitId; damage: number }> {
  if (target !== "swarmMothership" || damage <= 0) {
    return [{ target, damage }];
  }
  const drones = side.ships.swarmDrone ?? 0;
  const harvesters = side.ships.swarmHarvester ?? 0;
  if (drones <= 0 && harvesters <= 0) {
    return [{ target, damage }];
  }
  const intercepted = damage * SWARM_INTERCEPT_FRACTION;
  const toMother = damage - intercepted;
  const out: Array<{ target: CombatUnitId; damage: number }> = [];
  if (toMother > 0) out.push({ target: "swarmMothership", damage: toMother });

  if (drones > 0 && harvesters > 0) {
    const toDrones = intercepted * SWARM_INTERCEPT_SPLIT;
    const toHarv = intercepted - toDrones;
    if (toDrones > 0) out.push({ target: "swarmDrone", damage: toDrones });
    if (toHarv > 0) out.push({ target: "swarmHarvester", damage: toHarv });
  } else if (drones > 0) {
    out.push({ target: "swarmDrone", damage: intercepted });
  } else {
    out.push({ target: "swarmHarvester", damage: intercepted });
  }
  return out;
}

function mothershipHullFraction(
  side: SidePools,
  research: ResearchLevels | undefined,
): number {
  const count = side.ships.swarmMothership ?? 0;
  if (count <= 0) return 0;
  const hp = targetHp("swarmMothership", research);
  const residual = side.residual.swarmMothership ?? 0;
  return Math.max(0, Math.min(1, 1 - residual / hp));
}

/**
 * When mothership hull fraction < 30%, each harvester suicides:
 * shieldDmg + hullDmg to a focus enemy combatant.
 */
export function applyHarvesterKamikaze(
  own: SidePools,
  enemy: SidePools,
  ownResearch: ResearchLevels | undefined,
  enemyResearch: ResearchLevels | undefined,
): number {
  const harvesters = own.ships.swarmHarvester ?? 0;
  if (harvesters <= 0) return 0;
  if ((own.ships.swarmMothership ?? 0) <= 0) return 0;
  if (mothershipHullFraction(own, ownResearch) >= SWARM_KAMIKAZE_HULL_FRAC) {
    return 0;
  }
  const focus = pickFocusTarget(enemy.ships, enemy.defenses);
  if (!focus) {
    own.ships.swarmHarvester = 0;
    own.residual.swarmHarvester = 0;
    return harvesters;
  }
  const dmgPer =
    SWARM_KAMIKAZE_SHIELD_DMG + SWARM_KAMIKAZE_HULL_DMG;
  applyDamageToTarget(enemy, focus, harvesters * dmgPer, enemyResearch);
  own.ships.swarmHarvester = 0;
  own.residual.swarmHarvester = 0;
  return harvesters;
}

function applyShotWithIntercept(
  side: SidePools,
  target: CombatUnitId,
  damage: number,
  research: ResearchLevels | undefined,
): void {
  for (const part of redistributeSwarmIntercept(target, damage, side)) {
    applyDamageToTarget(side, part.target, part.damage, research);
  }
}

/** Snapshot damage intents from start-of-round counts (simultaneous fire). */
function collectFire(
  firerShips: FleetShips,
  firerDefenses: DefenseStock | null,
  targetShips: FleetShips,
  targetDefenses: DefenseStock,
  firerResearch: ResearchLevels | undefined,
  opts?: { attackMult?: number; defenseSlot?: number },
): Array<{ target: CombatUnitId; damage: number }> {
  const shots: Array<{ target: CombatUnitId; damage: number }> = [];
  const focus = pickFocusTarget(targetShips, targetDefenses);
  if (!focus) return shots;
  const attackMult = Math.max(0.01, opts?.attackMult ?? 1);
  const slot = opts?.defenseSlot;

  for (const id of livingShipIds(firerShips)) {
    const def = SHIPS[id];
    let atk = unitAtk(def.attack, firerResearch) * attackMult;
    if (id === "swarmDrone") {
      atk *= swarmDroneAttackMult(firerShips.swarmDrone ?? 0);
    }
    if (atk <= 0) continue;
    const n = firerShips[id] ?? 0;
    const rf = rapidFireFactor(id, focus);
    shots.push({ target: focus, damage: n * atk * rf });
  }
  if (firerDefenses) {
    for (const id of livingDefenseIds(firerDefenses)) {
      const def = DEFENSES[id];
      let atk = unitAtk(def.attack, firerResearch) * attackMult;
      if (
        slot != null &&
        def.slotAttackBonus &&
        def.slotAttackBonus.slots.includes(slot)
      ) {
        atk *= def.slotAttackBonus.factor;
      }
      if (atk <= 0) continue;
      const n = firerDefenses[id] ?? 0;
      const rf = rapidFireFactor(id, focus);
      shots.push({ target: focus, damage: n * atk * rf });
    }
  }
  return shots;
}

export interface CombatMods {
  /** Multiplies defender ship/defense firepower and effective HP (officer/skill). */
  defensePower?: number;
  /** Multiplies attacker ship firepower (Fleeter class). */
  attackMult?: number;
  /** Defender planet slot (Frost Lance cold-slot bonus). */
  defenseSlot?: number;
}

/**
 * Deterministic multi-round raid resolution with rapid-fire multipliers.
 */
export function resolveCombat(
  attacker: FleetShips,
  defender: FleetShips,
  defenses: DefenseStock = emptyDefenses(),
  attackerResearch?: ResearchLevels,
  defenderResearch?: ResearchLevels,
  mods?: CombatMods,
): CombatResolution {
  const defensePowerMult = Math.max(0.01, mods?.defensePower ?? 1);
  const attackMult = Math.max(0.01, mods?.attackMult ?? 1);
  const defenseSlot = mods?.defenseSlot;
  const atkSide: SidePools = {
    ships: normalizeFleetShips(attacker),
    defenses: emptyDefenses(),
    residual: {},
  };
  const defSide: SidePools = {
    ships: normalizeFleetShips(defender),
    defenses: { ...emptyDefenses(), ...defenses },
    residual: {},
  };

  if (shipCount(atkSide.ships) <= 0) {
    return {
      outcome: "defender_win",
      attackerAfter: emptyFleetShips(),
      defenderAfter: defSide.ships,
      defensesAfter: defSide.defenses,
      rounds: 0,
      summary: "No attacking ships.",
    };
  }

  if (shipCount(defSide.ships) + defenseCount(defSide.defenses) <= 0) {
    return {
      outcome: "attacker_win",
      attackerAfter: { ...atkSide.ships },
      defenderAfter: emptyFleetShips(),
      defensesAfter: emptyDefenses(),
      rounds: 0,
      summary: "Unopposed landing. Garrison empty.",
    };
  }

  let rounds = 0;
  for (let r = 1; r <= MAX_COMBAT_ROUNDS; r++) {
    rounds = r;
    const atkShots = collectFire(
      atkSide.ships,
      null,
      defSide.ships,
      defSide.defenses,
      attackerResearch,
      { attackMult },
    );
    const defShots = collectFire(
      defSide.ships,
      defSide.defenses,
      atkSide.ships,
      emptyDefenses(),
      defenderResearch,
      { defenseSlot },
    );

    for (const shot of atkShots) {
      // Higher defensePower → harder to kill (incoming damage reduced).
      applyShotWithIntercept(
        defSide,
        shot.target,
        shot.damage / defensePowerMult,
        defenderResearch,
      );
    }
    for (const shot of defShots) {
      applyShotWithIntercept(
        atkSide,
        shot.target,
        shot.damage * defensePowerMult,
        attackerResearch,
      );
    }

    applyHarvesterKamikaze(
      atkSide,
      defSide,
      attackerResearch,
      defenderResearch,
    );
    applyHarvesterKamikaze(
      defSide,
      atkSide,
      defenderResearch,
      attackerResearch,
    );

    const atkAlive = shipCount(atkSide.ships) > 0;
    const defAlive =
      shipCount(defSide.ships) + defenseCount(defSide.defenses) > 0;
    if (!atkAlive || !defAlive) break;
  }

  const atkAlive = shipCount(atkSide.ships) > 0;
  const defAlive =
    shipCount(defSide.ships) + defenseCount(defSide.defenses) > 0;

  let outcome: CombatOutcome;
  if (atkAlive && !defAlive) outcome = "attacker_win";
  else if (!atkAlive && defAlive) outcome = "defender_win";
  else if (!atkAlive && !defAlive) outcome = "draw";
  else outcome = "draw";

  const atkPower = fleetCombatPower(atkSide.ships, attackerResearch);
  const defPower =
    fleetCombatPower(defSide.ships, defenderResearch) +
    defenseCombatPower(defSide.defenses, defenderResearch);

  return {
    outcome,
    attackerAfter: atkSide.ships,
    defenderAfter: defSide.ships,
    defensesAfter: defSide.defenses,
    rounds,
    summary: `${outcome.split("_").join(" ")} after ${rounds} round${rounds === 1 ? "" : "s"} (surviving power atk ${atkPower.toFixed(0)} / def ${defPower.toFixed(0)}).`,
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
  return 1 + Math.max(0, astrophysics);
}

/** Concurrent deep-space expeditions (home empire). */
export function maxExpeditions(astrophysics: number): number {
  return 1 + Math.max(0, astrophysics);
}
