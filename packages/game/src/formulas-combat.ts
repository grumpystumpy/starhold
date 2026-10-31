import {
  DEBRIS_FROM_DEFENSES,
  DEBRIS_FROM_SHIPS,
  DEFENSE_ORDER,
  DEFENSE_REBUILD_MINER_RATE,
  DEFENSE_REBUILD_RATE,
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
  CombatRoundLog,
  CombatRoundLosses,
  DefenseId,
  DefenseStock,
  FleetShips,
  ResearchLevels,
  Resources,
  ShipId,
} from "./types.js";
import { swarmDroneAttackMult } from "./formulas-round2.js";
import { hashSeed } from "./formulas-position.js";
import {
  emptyDefenses,
  emptyFleetShips,
  fleetCargoCapacity,
  normalizeFleetShips,
} from "./formulas-travel.js";

export const ION_SHIELD_RECHARGE_FACTOR = 0.95;
export const ION_DISABLE_MAX_CHANCE = 0.03;

export function ionDisableChance(
  ionShare: number,
  armorLeftFraction: number,
): number {
  const normIon = Math.min(1, Math.max(0, ionShare));
  const normArmorLeft = Math.min(1, Math.max(0, armorLeftFraction));
  return (
    ION_DISABLE_MAX_CHANCE *
    normIon *
    Math.min(1, Math.max(0, (1 - normArmorLeft) / 0.8))
  );
}

export function hullExplosionChance(hullLeftFraction: number): number {
  if (hullLeftFraction >= 1) return 0;
  return Math.min(0.40, Math.max(0, (0.40 * (1 - hullLeftFraction)) / 0.9));
}

export function sampleBinomialOrNormal(
  n: number,
  p: number,
  rng: () => number,
): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;

  if (n <= 64) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (rng() < p) count++;
    }
    return count;
  }

  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  return Math.min(n, Math.max(0, Math.round(mean + z * sd)));
}

export const sampleCount = sampleBinomialOrNormal;

function getUnitWeaponShare(
  id: CombatUnitId,
  weapon: "ion" | "gravitational",
): number {
  if ((SHIP_ORDER as readonly string[]).includes(id)) {
    return SHIPS[id as ShipId].weapons?.[weapon] ?? 0;
  }
  return DEFENSES[id as DefenseId].weapons?.[weapon] ?? 0;
}

export function unitCombatPower(
  attack: number,
  shield: number,
  armor: number,
  hull: number,
  research: ResearchLevels | undefined,
): number {
  const w = 1 + (research?.weaponsTech ?? 0) * 0.08;
  const s = 1 + (research?.shieldingTech ?? 0) * 0.08;
  const a = 1 + (research?.armourTech ?? 0) * 0.08;
  return attack * w + 0.5 * shield * s + 0.3 * armor * a + 0.3 * hull * a;
}

function unitAtk(
  attack: number,
  research: ResearchLevels | undefined,
): number {
  return attack * (1 + (research?.weaponsTech ?? 0) * 0.08);
}

export function unitHp(
  shield: number,
  armor: number,
  hull: number,
  research: ResearchLevels | undefined,
): number {
  const s = shield * (1 + (research?.shieldingTech ?? 0) * 0.08);
  const a = armor * (1 + (research?.armourTech ?? 0) * 0.08);
  const h = hull * (1 + (research?.armourTech ?? 0) * 0.08);
  return Math.max(1, s + a + h);
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
    power += n * unitCombatPower(d.attack, d.shield, d.armor, d.hull, research);
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
    power += n * unitCombatPower(d.attack, d.shield, d.armor, d.hull, research);
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

/** 5% of metal/crystal on defenses that stay destroyed after rebuild. */
export function debrisFromDestroyedDefenses(
  permanentlyLost: Partial<Record<DefenseId, number>>,
): Resources {
  let metal = 0;
  let crystal = 0;
  for (const id of DEFENSE_ORDER) {
    const n = permanentlyLost[id] ?? 0;
    if (n <= 0) continue;
    const cost = DEFENSES[id].cost;
    metal += cost.metal * n;
    crystal += cost.crystal * n;
  }
  return {
    metal: Math.floor(metal * DEBRIS_FROM_DEFENSES),
    crystal: Math.floor(crystal * DEBRIS_FROM_DEFENSES),
    deuterium: 0,
  };
}

export function defenseRebuildRate(classId: string | null | undefined): number {
  return classId === "miner" ? DEFENSE_REBUILD_MINER_RATE : DEFENSE_REBUILD_RATE;
}

export interface DefenseRebuild {
  defensesAfter: DefenseStock;
  defensesDestroyed: Partial<Record<DefenseId, number>>;
  defensesRebuilt: Partial<Record<DefenseId, number>>;
  defensesPermanentlyLost: Partial<Record<DefenseId, number>>;
}

/** Restore a fraction of defenses destroyed in combat. Does not change the shot loop. */
export function rebuildDefenses(
  before: DefenseStock,
  afterCombat: DefenseStock,
  rate: number,
): DefenseRebuild {
  const defensesAfter = emptyDefenses();
  const defensesDestroyed: Partial<Record<DefenseId, number>> = {};
  const defensesRebuilt: Partial<Record<DefenseId, number>> = {};
  const defensesPermanentlyLost: Partial<Record<DefenseId, number>> = {};
  for (const id of DEFENSE_ORDER) {
    const had = before[id] ?? 0;
    const left = afterCombat[id] ?? 0;
    const lost = Math.max(0, had - left);
    const rebuilt = Math.round(lost * rate);
    const permanentlyLost = Math.max(0, lost - rebuilt);
    defensesAfter[id] = left + rebuilt;
    if (lost > 0) defensesDestroyed[id] = lost;
    if (rebuilt > 0) defensesRebuilt[id] = rebuilt;
    if (permanentlyLost > 0) defensesPermanentlyLost[id] = permanentlyLost;
  }
  return {
    defensesAfter,
    defensesDestroyed,
    defensesRebuilt,
    defensesPermanentlyLost,
  };
}

/** Sparse ship losses (before → after). Omits zeros. */
export function sparseShipLosses(
  before: FleetShips,
  after: FleetShips,
): Partial<FleetShips> {
  const out: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (before[id] ?? 0) - (after[id] ?? 0));
    if (lost > 0) out[id] = lost;
  }
  return out;
}

/** Sparse defense losses (before → after). Omits zeros. */
export function sparseDefenseLosses(
  before: DefenseStock,
  after: DefenseStock,
): Partial<DefenseStock> {
  const out: Partial<DefenseStock> = {};
  for (const id of DEFENSE_ORDER) {
    const lost = Math.max(0, (before[id] ?? 0) - (after[id] ?? 0));
    if (lost > 0) out[id] = lost;
  }
  return out;
}

function cloneFleetShips(ships: FleetShips): FleetShips {
  return { ...ships };
}

function cloneDefenses(defenses: DefenseStock): DefenseStock {
  return { ...defenses };
}

function lossesFromSnapshots(
  shipsBefore: FleetShips,
  shipsAfter: FleetShips,
  defensesBefore?: DefenseStock,
  defensesAfter?: DefenseStock,
): CombatRoundLosses {
  const ships = sparseShipLosses(shipsBefore, shipsAfter);
  const defenses =
    defensesBefore && defensesAfter
      ? sparseDefenseLosses(defensesBefore, defensesAfter)
      : undefined;
  const losses: CombatRoundLosses = { ships };
  if (defenses && Object.keys(defenses).length > 0) {
    losses.defenses = defenses;
  }
  return losses;
}

/** Debris from sparse ship losses this round (defenses never debris). */
export function debrisFromShipLosses(
  ...sides: Array<Partial<FleetShips>>
): Resources {
  const before = emptyFleetShips();
  for (const ships of sides) {
    for (const id of SHIP_ORDER) {
      before[id] = (before[id] ?? 0) + (ships[id] ?? 0);
    }
  }
  return debrisFromDestroyed(destroyedShipResources(before, emptyFleetShips()));
}

export interface CombatResolution {
  outcome: CombatOutcome;
  attackerAfter: FleetShips;
  defenderAfter: FleetShips;
  defensesAfter: DefenseStock;
  rounds: number;
  summary: string;
  /** Empty when no rounds fought (unopposed / no attackers). */
  roundLog: CombatRoundLog[];
}

type UnitDamageState = {
  frontShieldDmg: number;
  frontArmorDmg: number;
  frontHullDmg: number;
};

type SidePools = {
  ships: FleetShips;
  defenses: DefenseStock;
  /** Fleet-wide pooled shields for current round. */
  shieldPool?: number;
  /** Damage state for front unit per CombatUnitId. */
  unitDamage?: Partial<Record<CombatUnitId, UnitDamageState>>;
  residual?: Partial<Record<CombatUnitId, number>>;
  /** Alliance ship-shield multiplier. Ships only. */
  shipShieldMult?: number;
  shipArmorMult?: number;
  shipHullMult?: number;
  /** Alliance defense hull/armor/shield multiplier. Defenses only. */
  defenseStatMult?: number;
  unitStatMult?: number;

  shieldCapMult?: Partial<Record<CombatUnitId, number>>;
  tookIonShieldDmgThisRound?: Partial<Record<CombatUnitId, boolean>>;
  ionArmorDmgThisRound?: Partial<Record<CombatUnitId, number>>;
  totalArmorDmgThisRound?: Partial<Record<CombatUnitId, number>>;
  disabledCount?: Partial<Record<CombatUnitId, number>>;
  pendingGravitational?: Array<{ targetId: CombatUnitId; rawDamage: number }>;
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

/**
 * Computes target weights for B3-07.
 * Exclusive rapid-fire preference: if shooter has rapid fire (N > 1) against any present target type,
 * candidate set is strictly the present target types with the maximum rapid fire factor N_max.
 * Otherwise (when max RF among present types is 1), all present target types are candidates
 * weighted by sqrt(toughness) * count * (isSwarmDrone && mothershipPresent ? 5 : 1).
 */
export function computeTargetWeights(
  shooterId: CombatUnitId,
  targetSideSnapshot: SidePools,
  targetSideLive?: SidePools,
  targetResearch?: ResearchLevels,
  battlefield?: BattlefieldMods,
): Partial<Record<CombatUnitId, number>> {
  const live = targetSideLive ?? targetSideSnapshot;
  const present: CombatUnitId[] = [];
  for (const id of SHIP_ORDER) {
    if ((live.ships[id] ?? 0) > 0) present.push(id);
  }
  for (const id of DEFENSE_ORDER) {
    if ((live.defenses[id] ?? 0) > 0) present.push(id);
  }

  if (present.length === 0) return {};

  let maxRF = 1;
  for (const id of present) {
    const rf = rapidFireFactor(shooterId, id);
    if (rf > maxRF) maxRF = rf;
  }

  const candidates =
    maxRF > 1
      ? present.filter((id) => rapidFireFactor(shooterId, id) === maxRF)
      : present;

  const mothershipPresent =
    (targetSideSnapshot.ships.swarmMothership ?? 0) > 0;
  const weights: Partial<Record<CombatUnitId, number>> = {};

  for (const id of candidates) {
    const count = targetCount(targetSideSnapshot, id);
    const stats = getUnitStats(id, targetResearch, battlefield);
    const toughness = unitHp(stats.maxS, stats.maxA, stats.maxH, undefined);
    let w = Math.sqrt(toughness) * count;
    if (id === "swarmDrone" && mothershipPresent) {
      w *= 5;
    }
    weights[id] = w;
  }

  return weights;
}

export function pickWeightedTarget(
  shooterId: CombatUnitId,
  targetSideSnapshot: SidePools,
  targetSideLive: SidePools,
  targetResearch: ResearchLevels | undefined,
  battlefield: BattlefieldMods | undefined,
  rng: () => number,
): CombatUnitId | null {
  const weights = computeTargetWeights(
    shooterId,
    targetSideSnapshot,
    targetSideLive,
    targetResearch,
    battlefield,
  );
  const candidates = Object.keys(weights) as CombatUnitId[];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  let totalWeight = 0;
  for (const id of candidates) {
    totalWeight += weights[id] ?? 0;
  }
  if (totalWeight <= 0) return candidates[0]!;

  let roll = rng() * totalWeight;
  for (const id of candidates) {
    const w = weights[id] ?? 0;
    roll -= w;
    if (roll <= 0) return id;
  }
  return candidates[candidates.length - 1]!;
}

function calculateSingleUnitAttack(
  firerId: CombatUnitId,
  firerResearch: ResearchLevels | undefined,
  swarmDroneCount: number,
  opts?: {
    attackMult?: number;
    weaponMult?: number;
    defenseSlot?: number;
    battlefield?: BattlefieldMods;
  },
): number {
  const attackMult = Math.max(0.01, opts?.attackMult ?? 1);
  const weaponMult = Math.max(0, opts?.weaponMult ?? 1);
  const battlefieldAtk = Math.max(0.01, opts?.battlefield?.attackMult ?? 1);
  const slot = opts?.defenseSlot;

  if ((SHIP_ORDER as string[]).includes(firerId)) {
    const def = SHIPS[firerId as ShipId];
    let atk =
      unitAtk(def.attack, firerResearch) *
      attackMult *
      battlefieldAtk *
      weaponMult;
    if (firerId === "swarmDrone") {
      atk *= swarmDroneAttackMult(swarmDroneCount);
    }
    return atk;
  } else {
    const def = DEFENSES[firerId as DefenseId];
    let atk = unitAtk(def.attack, firerResearch) * battlefieldAtk * weaponMult;
    if (
      slot != null &&
      def.slotAttackBonus &&
      def.slotAttackBonus.slots.includes(slot)
    ) {
      atk *= def.slotAttackBonus.factor;
    }
    return atk;
  }
}

function applyShotWithIntercept(
  side: SidePools,
  target: CombatUnitId,
  damage: number,
  research: ResearchLevels | undefined,
  battlefield?: BattlefieldMods,
  ionShareOfFirer: number = 0,
): number {
  let unabsorbed = 0;
  for (const part of redistributeSwarmIntercept(target, damage, side)) {
    const rem = applyDamageToTarget(
      side,
      part.target,
      part.damage,
      research,
      battlefield,
      ionShareOfFirer,
    );
    unabsorbed += rem;
  }
  return unabsorbed;
}


export function fireGroupShots(
  firerId: CombatUnitId,
  groupCount: number,
  targetSideSnapshot: SidePools,
  targetSideLive: SidePools,
  firerResearch: ResearchLevels | undefined,
  targetResearch: ResearchLevels | undefined,
  swarmDroneCount: number,
  isDefenderFirer: boolean,
  opts:
    | {
        defensePowerMult?: number;
        attackMult?: number;
        weaponMult?: number;
        defenseSlot?: number;
        battlefield?: BattlefieldMods;
      }
    | undefined,
  rng: () => number,
): void {
  if (groupCount <= 0) return;
  const unitAtkDamage = calculateSingleUnitAttack(
    firerId,
    firerResearch,
    swarmDroneCount,
    opts,
  );
  if (unitAtkDamage <= 0) return;

  const defensePowerMult = Math.max(0.01, opts?.defensePowerMult ?? 1);
  const unitEffectiveDamage = isDefenderFirer
    ? unitAtkDamage * defensePowerMult
    : unitAtkDamage / defensePowerMult;

  const ionShareOfFirer = getUnitWeaponShare(firerId, "ion");

  for (let i = 0; i < groupCount; i++) {
    let currentTarget = pickWeightedTarget(
      firerId,
      targetSideSnapshot,
      targetSideLive,
      targetResearch,
      opts?.battlefield,
      rng,
    );

    while (currentTarget != null) {
      applyShotWithIntercept(
        targetSideLive,
        currentTarget,
        unitEffectiveDamage,
        targetResearch,
        opts?.battlefield,
        ionShareOfFirer,
      );

      const rfFactor = rapidFireFactor(firerId, currentTarget);
      if (rfFactor <= 1) break;

      const pRepeat = (rfFactor - 1) / rfFactor;
      if (rng() >= pRepeat) break;

      currentTarget = pickWeightedTarget(
        firerId,
        targetSideSnapshot,
        targetSideLive,
        targetResearch,
        opts?.battlefield,
        rng,
      );
    }
  }
}

export function calculateSideShieldPool(
  side: SidePools,
  research: ResearchLevels | undefined,
  battlefield?: BattlefieldMods,
): number {
  let pool = 0;
  for (const id of SHIP_ORDER) {
    const count = side.ships[id] ?? 0;
    if (count > 0) {
      const stats = getUnitStats(id, research, battlefield, side);
      pool += count * stats.maxS;
    }
  }
  for (const id of DEFENSE_ORDER) {
    const count = side.defenses[id] ?? 0;
    if (count > 0) {
      const stats = getUnitStats(id, research, battlefield, side);
      pool += count * stats.maxS;
    }
  }
  return pool;
}

function applyGravitationalDamageToGroup(
  side: SidePools,
  id: CombatUnitId,
  rawDamage: number,
  research: ResearchLevels | undefined,
  battlefield?: BattlefieldMods,
): void {
  if (rawDamage <= 0) return;
  let count = targetCount(side, id);
  if (count <= 0) return;

  if (!side.unitDamage) side.unitDamage = {};
  const stats = getUnitStats(id, research, battlefield, side);
  const maxA = stats.maxA;
  const maxH = stats.maxH;

  let unitDmg = side.unitDamage[id] ?? {
    frontShieldDmg: 0,
    frontArmorDmg: 0,
    frontHullDmg: 0,
  };
  let remainingRaw = rawDamage;

  // 1. Shield layer (mult 0.7) - pooled across fleet
  if (side.shieldPool !== undefined && side.shieldPool > 0) {
    const rawNeededForShield = side.shieldPool / 0.7;
    const rawToShield = Math.min(remainingRaw, rawNeededForShield);
    const sAbs = rawToShield * 0.7;
    side.shieldPool -= sAbs;
    remainingRaw -= rawToShield;
  }

  while (remainingRaw > 0 && count > 0) {
    // 2. Armor layer (mult 1.4)
    if (remainingRaw > 0) {
      const curA = Math.max(0, maxA - unitDmg.frontArmorDmg);
      if (curA > 0) {
        const rawNeededForArmor = curA / 1.4;
        const rawToArmor = Math.min(remainingRaw, rawNeededForArmor);
        const aAbs = rawToArmor * 1.4;
        unitDmg.frontArmorDmg += aAbs;
        remainingRaw -= rawToArmor;
        if (!side.totalArmorDmgThisRound) side.totalArmorDmgThisRound = {};
        side.totalArmorDmgThisRound[id] =
          (side.totalArmorDmgThisRound[id] ?? 0) + aAbs;
      }
    }

    // 3. Hull layer (mult 1.4)
    if (remainingRaw > 0) {
      const curH = Math.max(0, maxH - unitDmg.frontHullDmg);
      if (curH > 0) {
        const rawNeededForHull = curH / 1.4;
        const rawToHull = Math.min(remainingRaw, rawNeededForHull);
        const hAbs = rawToHull * 1.4;
        unitDmg.frontHullDmg += hAbs;
        remainingRaw -= rawToHull;
      }
    }

    if (unitDmg.frontHullDmg >= maxH && maxH > 0) {
      count -= 1;
      setTargetCount(side, id, count);
      unitDmg = { frontShieldDmg: 0, frontArmorDmg: 0, frontHullDmg: 0 };
      if (count <= 0) break;
    }
  }
  side.unitDamage[id] = unitDmg;
}

function fireGravitationalVolley(
  firerId: CombatUnitId,
  activeCount: number,
  targetSideLive: SidePools,
  firerResearch: ResearchLevels | undefined,
  targetResearch: ResearchLevels | undefined,
  swarmDroneCount: number,
  isDefenderFirer: boolean,
  opts:
    | {
        defensePowerMult?: number;
        attackMult?: number;
        weaponMult?: number;
        defenseSlot?: number;
        battlefield?: BattlefieldMods;
      }
    | undefined,
): void {
  const gravShare = getUnitWeaponShare(firerId, "gravitational");
  if (gravShare <= 0 || activeCount <= 0) return;

  const unitAtkDamage = calculateSingleUnitAttack(
    firerId,
    firerResearch,
    swarmDroneCount,
    opts,
  );
  if (unitAtkDamage <= 0) return;

  const defensePowerMult = Math.max(0.01, opts?.defensePowerMult ?? 1);
  const unitEffectiveDamage = isDefenderFirer
    ? unitAtkDamage * defensePowerMult
    : unitAtkDamage / defensePowerMult;

  const gravTotalDamage = activeCount * unitEffectiveDamage * gravShare;
  if (gravTotalDamage <= 0) return;

  // Target selection (1/5 of enemy fleet)
  let totalEnemyUnits = 0;
  const candidateList: Array<{
    id: CombatUnitId;
    count: number;
    weight: number;
  }> = [];
  const mothershipPresent = (targetSideLive.ships.swarmMothership ?? 0) > 0;

  for (const id of SHIP_ORDER) {
    const c = targetSideLive.ships[id] ?? 0;
    if (c > 0) {
      totalEnemyUnits += c;
      const stats = getUnitStats(
        id,
        targetResearch,
        opts?.battlefield,
        targetSideLive,
      );
      const toughness = unitHp(stats.maxS, stats.maxA, stats.maxH, undefined);
      let w = Math.sqrt(toughness) * c;
      if (id === "swarmDrone" && mothershipPresent) w *= 5;
      candidateList.push({ id, count: c, weight: w });
    }
  }
  for (const id of DEFENSE_ORDER) {
    const c = targetSideLive.defenses[id] ?? 0;
    if (c > 0) {
      totalEnemyUnits += c;
      const stats = getUnitStats(
        id,
        targetResearch,
        opts?.battlefield,
        targetSideLive,
      );
      const toughness = unitHp(stats.maxS, stats.maxA, stats.maxH, undefined);
      candidateList.push({ id, count: c, weight: Math.sqrt(toughness) * c });
    }
  }

  if (candidateList.length === 0 || totalEnemyUnits <= 0) return;

  candidateList.sort((a, b) => b.weight - a.weight);

  const targetUnitsNeeded = Math.max(1, Math.ceil(totalEnemyUnits * 0.20));
  let coveredUnits = 0;
  const selectedGroups: Array<{ id: CombatUnitId; count: number }> = [];

  for (const cand of candidateList) {
    selectedGroups.push({ id: cand.id, count: cand.count });
    coveredUnits += cand.count;
    if (coveredUnits >= targetUnitsNeeded) break;
  }

  let totalSelectedUnits = 0;
  for (const g of selectedGroups) {
    totalSelectedUnits += g.count;
  }
  if (totalSelectedUnits <= 0) return;

  for (const g of selectedGroups) {
    const rawGroupDamage = gravTotalDamage * (g.count / totalSelectedUnits);
    applyGravitationalDamageToGroup(
      targetSideLive,
      g.id,
      rawGroupDamage * 0.5,
      targetResearch,
      opts?.battlefield,
    );
    if (!targetSideLive.pendingGravitational) {
      targetSideLive.pendingGravitational = [];
    }
    targetSideLive.pendingGravitational.push({
      targetId: g.id,
      rawDamage: rawGroupDamage * 0.5,
    });
  }
}

export interface BattlefieldMods {
  shieldMult: number;
  attackMult: number;
  armorMult: number;
}

function getUnitStats(
  id: CombatUnitId,
  research: ResearchLevels | undefined,
  battlefield?: BattlefieldMods,
  side?: SidePools,
) {
  const unitStatMult = side?.unitStatMult ?? 1;
  const sMult = (battlefield?.shieldMult ?? 1) * unitStatMult;
  const aMult = (battlefield?.armorMult ?? 1) * unitStatMult;
  let shield = 0;
  let armor = 0;
  let hull = 0;
  if ((SHIP_ORDER as string[]).includes(id)) {
    const d = SHIPS[id as ShipId];
    shield = d.shield * (side?.shipShieldMult ?? 1);
    armor = d.armor * (side?.shipArmorMult ?? 1);
    hull = d.hull * (side?.shipHullMult ?? 1);
  } else {
    const d = DEFENSES[id as DefenseId];
    const stat = side?.defenseStatMult ?? 1;
    shield = d.shield * stat;
    armor = d.armor * stat;
    hull = d.hull * stat;
  }
  const sCap = side?.shieldCapMult?.[id] ?? 1;
  const maxS =
    shield * sMult * (1 + (research?.shieldingTech ?? 0) * 0.08) * sCap;
  const maxA = armor * aMult * (1 + (research?.armourTech ?? 0) * 0.08);
  const maxH = hull * aMult * (1 + (research?.armourTech ?? 0) * 0.08);
  return { maxS, maxA, maxH };
}

function targetCount(side: SidePools, id: CombatUnitId): number {
  if ((SHIP_ORDER as string[]).includes(id)) {
    return side.ships[id as ShipId] ?? 0;
  }
  return side.defenses[id as DefenseId] ?? 0;
}

function setTargetCount(side: SidePools, id: CombatUnitId, count: number): void {
  if ((SHIP_ORDER as string[]).includes(id)) {
    side.ships[id as ShipId] = Math.max(0, count);
  } else {
    side.defenses[id as DefenseId] = Math.max(0, count);
  }
}

function applyDamageToTarget(
  side: SidePools,
  id: CombatUnitId,
  damage: number,
  research: ResearchLevels | undefined,
  battlefield?: BattlefieldMods,
  ionShareOfFirer: number = 0,
): number {
  if (damage <= 0) return 0;
  let count = targetCount(side, id);
  if (count <= 0) return damage;

  if (!side.unitDamage) side.unitDamage = {};

  const stats = getUnitStats(id, research, battlefield, side);
  const maxA = stats.maxA;
  const maxH = stats.maxH;

  let unitDmg = side.unitDamage[id] ?? {
    frontShieldDmg: 0,
    frontArmorDmg: 0,
    frontHullDmg: 0,
  };
  let remainingDamage = damage;

  // Layer 1: Fleet-wide pooled shield
  if (side.shieldPool !== undefined && side.shieldPool > 0) {
    const sAbs = Math.min(remainingDamage, side.shieldPool);
    side.shieldPool -= sAbs;
    remainingDamage -= sAbs;

    if (sAbs > 0 && ionShareOfFirer > 0) {
      if (!side.tookIonShieldDmgThisRound) {
        side.tookIonShieldDmgThisRound = {};
      }
      side.tookIonShieldDmgThisRound[id] = true;
    }
  }

  while (remainingDamage > 0 && count > 0) {
    const curA = Math.max(0, maxA - unitDmg.frontArmorDmg);
    const curH = Math.max(0, maxH - unitDmg.frontHullDmg);

    // Layer 2: Armor
    if (remainingDamage > 0) {
      const aAbs = Math.min(remainingDamage, curA);
      unitDmg.frontArmorDmg += aAbs;
      remainingDamage -= aAbs;

      if (aAbs > 0) {
        if (!side.totalArmorDmgThisRound) side.totalArmorDmgThisRound = {};
        side.totalArmorDmgThisRound[id] =
          (side.totalArmorDmgThisRound[id] ?? 0) + aAbs;
        if (ionShareOfFirer > 0) {
          if (!side.ionArmorDmgThisRound) side.ionArmorDmgThisRound = {};
          side.ionArmorDmgThisRound[id] =
            (side.ionArmorDmgThisRound[id] ?? 0) + aAbs * ionShareOfFirer;
        }
      }
    }

    // Layer 3: Hull
    if (remainingDamage > 0) {
      const hAbs = Math.min(remainingDamage, curH);
      unitDmg.frontHullDmg += hAbs;
      remainingDamage -= hAbs;
    }

    if (unitDmg.frontHullDmg >= maxH && maxH > 0) {
      count -= 1;
      setTargetCount(side, id, count);
      unitDmg = { frontShieldDmg: 0, frontArmorDmg: 0, frontHullDmg: 0 };
      if (count <= 0) break;
    }
  }
  side.unitDamage[id] = unitDmg;
  return remainingDamage;
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
  battlefield?: BattlefieldMods,
): number {
  const count = side.ships?.swarmMothership ?? 0;
  if (count <= 0) return 0;
  const stats = getUnitStats("swarmMothership", research, battlefield, side);
  if (stats.maxH <= 0) return 0;
  if (side.unitDamage?.swarmMothership) {
    const unitDmg = side.unitDamage.swarmMothership;
    const curH = Math.max(0, stats.maxH - unitDmg.frontHullDmg);
    return curH / stats.maxH;
  }
  const res = side.residual?.swarmMothership ?? 0;
  if (res > 0) {
    const hDmg = Math.max(0, res - stats.maxS - stats.maxA);
    const curH = Math.max(0, stats.maxH - hDmg);
    return curH / stats.maxH;
  }
  return 1;
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
  battlefield?: BattlefieldMods,
): number {
  const harvesters = own.ships.swarmHarvester ?? 0;
  if (harvesters <= 0) return 0;
  if ((own.ships.swarmMothership ?? 0) <= 0) return 0;
  if (
    mothershipHullFraction(own, ownResearch, battlefield) >=
    SWARM_KAMIKAZE_HULL_FRAC
  ) {
    return 0;
  }
  const focus = pickFocusTarget(enemy.ships, enemy.defenses);
  if (!focus) {
    own.ships.swarmHarvester = 0;
    if (own.unitDamage) {
      own.unitDamage.swarmHarvester = { frontShieldDmg: 0, frontArmorDmg: 0, frontHullDmg: 0 };
    }
    return harvesters;
  }
  const dmgPer =
    SWARM_KAMIKAZE_SHIELD_DMG + SWARM_KAMIKAZE_HULL_DMG;
  applyDamageToTarget(
    enemy,
    focus,
    harvesters * dmgPer,
    enemyResearch,
    battlefield,
  );
  own.ships.swarmHarvester = 0;
  if (own.unitDamage) {
    own.unitDamage.swarmHarvester = { frontShieldDmg: 0, frontArmorDmg: 0, frontHullDmg: 0 };
  }
  return harvesters;
}


export interface CombatMods {
  /** Multiplies defender ship/defense firepower and effective HP (officer/skill). */
  defensePower?: number;
  /** Multiplies attacker ship firepower (Fleeter class). */
  attackMult?: number;
  /** Defender planet slot (Cryo Ion Lance cold-slot bonus). */
  defenseSlot?: number;
  /** Location battlefield mods (e.g. Moving Fortress) — both sides. */
  battlefield?: BattlefieldMods;
  /** Seed for deterministic RNG. */
  seed?: string;
  /** Alliance ship shields for the attacker. */
  attackerShieldMult?: number;
  /** Alliance ship shields for the defender. */
  defenderShieldMult?: number;
  attackerArmorMult?: number;
  defenderArmorMult?: number;
  attackerHullMult?: number;
  defenderHullMult?: number;
  /** Alliance ship weapons for the attacker (after attackMult). */
  attackerWeaponMult?: number;
  /** Alliance ship weapons for the defender (ships only, not defense fire). */
  defenderWeaponMult?: number;
  /** Alliance defense hull, armor, and shields. */
  defenderDefenseStatMult?: number;
  defenderUnitStatMult?: number;
}

function createRng(seedStr?: string) {
  let s = hashSeed(seedStr ?? "starhold-combat-v1");
  return function nextFloat(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic multi-round raid resolution with 3-layer damage & rapid-fire multipliers.
 */
export function resolveCombat(
  attacker: FleetShips,
  defender: FleetShips,
  defenses: DefenseStock = emptyDefenses(),
  attackerResearch?: ResearchLevels,
  defenderResearch?: ResearchLevels,
  mods?: CombatMods,
): CombatResolution {
  const rng = createRng(mods?.seed);

  const defensePowerMult = Math.max(0.01, mods?.defensePower ?? 1);
  const attackMult = Math.max(0.01, mods?.attackMult ?? 1);
  const defenseSlot = mods?.defenseSlot;
  const battlefield = mods?.battlefield;
  const atkSide: SidePools = {
    ships: normalizeFleetShips(attacker),
    defenses: emptyDefenses(),
    unitDamage: {},
    shipShieldMult: mods?.attackerShieldMult ?? 1,
    shipArmorMult: mods?.attackerArmorMult ?? 1,
    shipHullMult: mods?.attackerHullMult ?? 1,
    defenseStatMult: 1,
  };
  const defSide: SidePools = {
    ships: normalizeFleetShips(defender),
    defenses: { ...emptyDefenses(), ...defenses },
    unitDamage: {},
    shipShieldMult: mods?.defenderShieldMult ?? 1,
    shipArmorMult: mods?.defenderArmorMult ?? 1,
    shipHullMult: mods?.defenderHullMult ?? 1,
    defenseStatMult: mods?.defenderDefenseStatMult ?? 1,
    unitStatMult: mods?.defenderUnitStatMult ?? 1,
  };

  if (shipCount(atkSide.ships) <= 0) {
    return {
      outcome: "defender_win",
      attackerAfter: emptyFleetShips(),
      defenderAfter: defSide.ships,
      defensesAfter: defSide.defenses,
      rounds: 0,
      summary: "No attacking ships.",
      roundLog: [],
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
      roundLog: [],
    };
  }

  let rounds = 0;
  const roundLog: CombatRoundLog[] = [];
  for (let r = 1; r <= MAX_COMBAT_ROUNDS; r++) {
    rounds = r;

    // 1. Shield recharge + Ion cap update + reset round tracking
    const allUnitIds = [...SHIP_ORDER, ...DEFENSE_ORDER] as CombatUnitId[];
    for (const side of [atkSide, defSide]) {
      for (const id of allUnitIds) {
        if (r >= 2) {
          if (side.tookIonShieldDmgThisRound?.[id]) {
            if (!side.shieldCapMult) side.shieldCapMult = {};
            side.shieldCapMult[id] = Math.max(
              0,
              (side.shieldCapMult[id] ?? 1) * ION_SHIELD_RECHARGE_FACTOR,
            );
          }
        }
        if (side.unitDamage?.[id]) {
          side.unitDamage[id]!.frontShieldDmg = 0;
        }
      }
      side.tookIonShieldDmgThisRound = {};
      side.ionArmorDmgThisRound = {};
      side.totalArmorDmgThisRound = {};
    }

    // Initialize / reset pooled shields for living units at start of round
    atkSide.shieldPool = calculateSideShieldPool(
      atkSide,
      attackerResearch,
      battlefield,
    );
    defSide.shieldPool = calculateSideShieldPool(
      defSide,
      defenderResearch,
      battlefield,
    );
    const atkInitialShieldPool = atkSide.shieldPool;
    const defInitialShieldPool = defSide.shieldPool;

    // 2. Apply pending gravitational damage (queued from previous round)
    for (const [side, research] of [
      [atkSide, attackerResearch],
      [defSide, defenderResearch],
    ] as const) {
      if (side.pendingGravitational && side.pendingGravitational.length > 0) {
        const pendingList = side.pendingGravitational;
        side.pendingGravitational = [];
        for (const item of pendingList) {
          if (targetCount(side, item.targetId) > 0) {
            applyGravitationalDamageToGroup(
              side,
              item.targetId,
              item.rawDamage,
              research,
              battlefield,
            );
          }
        }
      }
    }

    if (
      shipCount(atkSide.ships) <= 0 ||
      shipCount(defSide.ships) + defenseCount(defSide.defenses) <= 0
    ) {
      break;
    }

    const atkShipsBefore = cloneFleetShips(atkSide.ships);
    const defShipsBefore = cloneFleetShips(defSide.ships);
    const defDefsBefore = cloneDefenses(defSide.defenses);

    // Snapshots of target pools at the start of the round for simultaneous combat
    const atkSideSnapshot: SidePools = {
      ships: atkShipsBefore,
      defenses: emptyDefenses(),
    };
    const defSideSnapshot: SidePools = {
      ships: defShipsBefore,
      defenses: defDefsBefore,
    };

    // Attacker ships fire as groups against defSide live pool
    for (const id of SHIP_ORDER) {
      const n = atkShipsBefore[id] ?? 0;
      if (n <= 0) continue;
      const disabled = atkSide.disabledCount?.[id] ?? 0;
      const activeCount = Math.max(0, n - disabled);
      if (activeCount <= 0) continue;
      if (shipCount(defSide.ships) + defenseCount(defSide.defenses) <= 0) break;

      const gravShare = getUnitWeaponShare(id, "gravitational");
      if (gravShare > 0) {
        fireGroupShots(
          id,
          activeCount,
          defSideSnapshot,
          defSide,
          attackerResearch,
          defenderResearch,
          atkShipsBefore.swarmDrone ?? 0,
          false,
          {
            defensePowerMult,
            attackMult,
            weaponMult: (mods?.attackerWeaponMult ?? 1) * (1 - gravShare),
            battlefield,
          },
          rng,
        );
        fireGravitationalVolley(
          id,
          activeCount,
          defSide,
          attackerResearch,
          defenderResearch,
          atkShipsBefore.swarmDrone ?? 0,
          false,
          {
            defensePowerMult,
            attackMult,
            weaponMult: mods?.attackerWeaponMult,
            battlefield,
          },
        );
      } else {
        fireGroupShots(
          id,
          activeCount,
          defSideSnapshot,
          defSide,
          attackerResearch,
          defenderResearch,
          atkShipsBefore.swarmDrone ?? 0,
          false,
          {
            defensePowerMult,
            attackMult,
            weaponMult: mods?.attackerWeaponMult,
            battlefield,
          },
          rng,
        );
      }
    }

    // Defender ships fire as groups against atkSide live pool
    for (const id of SHIP_ORDER) {
      const n = defShipsBefore[id] ?? 0;
      if (n <= 0) continue;
      const disabled = defSide.disabledCount?.[id] ?? 0;
      const activeCount = Math.max(0, n - disabled);
      if (activeCount <= 0) continue;
      if (shipCount(atkSide.ships) <= 0) break;

      const gravShare = getUnitWeaponShare(id, "gravitational");
      if (gravShare > 0) {
        fireGroupShots(
          id,
          activeCount,
          atkSideSnapshot,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          {
            defensePowerMult,
            defenseSlot,
            weaponMult: (mods?.defenderWeaponMult ?? 1) * (1 - gravShare),
            battlefield,
          },
          rng,
        );
        fireGravitationalVolley(
          id,
          activeCount,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          {
            defensePowerMult,
            defenseSlot,
            weaponMult: mods?.defenderWeaponMult,
            battlefield,
          },
        );
      } else {
        fireGroupShots(
          id,
          activeCount,
          atkSideSnapshot,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          {
            defensePowerMult,
            defenseSlot,
            weaponMult: mods?.defenderWeaponMult,
            battlefield,
          },
          rng,
        );
      }
    }

    // Defender defenses fire as groups against atkSide live pool
    for (const id of DEFENSE_ORDER) {
      const n = defDefsBefore[id] ?? 0;
      if (n <= 0) continue;
      const disabled = defSide.disabledCount?.[id] ?? 0;
      const activeCount = Math.max(0, n - disabled);
      if (activeCount <= 0) continue;
      if (shipCount(atkSide.ships) <= 0) break;

      const gravShare = getUnitWeaponShare(id, "gravitational");
      if (gravShare > 0) {
        fireGroupShots(
          id,
          activeCount,
          atkSideSnapshot,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          {
            defensePowerMult,
            defenseSlot,
            weaponMult: 1 - gravShare,
            battlefield,
          },
          rng,
        );
        fireGravitationalVolley(
          id,
          activeCount,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          { defensePowerMult, defenseSlot, battlefield },
        );
      } else {
        fireGroupShots(
          id,
          activeCount,
          atkSideSnapshot,
          atkSide,
          defenderResearch,
          attackerResearch,
          defShipsBefore.swarmDrone ?? 0,
          true,
          { defensePowerMult, defenseSlot, battlefield },
          rng,
        );
      }
    }

    applyHarvesterKamikaze(
      atkSide,
      defSide,
      attackerResearch,
      defenderResearch,
      battlefield,
    );
    applyHarvesterKamikaze(
      defSide,
      atkSide,
      defenderResearch,
      attackerResearch,
      battlefield,
    );

    // End-of-round Ion Disables & Hull Explosions
    for (const [side, research] of [
      [atkSide, attackerResearch],
      [defSide, defenderResearch],
    ] as const) {
      const nextDisabled: Partial<Record<CombatUnitId, number>> = {};

      for (const id of allUnitIds) {
        let count = targetCount(side, id);
        if (count <= 0) continue;

        const stats = getUnitStats(id, research, battlefield, side);
        const unitDmg = side.unitDamage?.[id];

        // A. Ion Armor Disable (sampled for next round)
        const ionDmg = side.ionArmorDmgThisRound?.[id] ?? 0;
        const totalDmg = side.totalArmorDmgThisRound?.[id] ?? 0;
        if (ionDmg > 0 && totalDmg > 0) {
          const ionShare = ionDmg / totalDmg;
          const curA =
            stats.maxA > 0
              ? Math.max(0, stats.maxA - (unitDmg?.frontArmorDmg ?? 0))
              : 0;
          const armorLeftFraction = stats.maxA > 0 ? curA / stats.maxA : 0;
          const pDisable = ionDisableChance(ionShare, armorLeftFraction);
          const disabledCount = sampleBinomialOrNormal(count, pDisable, rng);
          if (disabledCount > 0) {
            nextDisabled[id] = disabledCount;
          }
        }

        // B. Hull Explosions (evaluated immediately at end of round)
        if (unitDmg && unitDmg.frontHullDmg > 0 && stats.maxH > 0) {
          const curH = Math.max(0, stats.maxH - unitDmg.frontHullDmg);
          const hullLeftFraction = curH / stats.maxH;
          const pExplode = hullExplosionChance(hullLeftFraction);
          if (pExplode > 0) {
            const explodedCount = sampleBinomialOrNormal(1, pExplode, rng);
            if (explodedCount > 0) {
              count -= 1;
              setTargetCount(side, id, count);
              if (!side.unitDamage) side.unitDamage = {};
              side.unitDamage[id] = {
                frontShieldDmg: 0,
                frontArmorDmg: 0,
                frontHullDmg: 0,
              };
            }
          }
        }
      }

      side.disabledCount = nextDisabled;
    }

    const attackerLosses = lossesFromSnapshots(atkShipsBefore, atkSide.ships);
    const defenderLosses = lossesFromSnapshots(
      defShipsBefore,
      defSide.ships,
      defDefsBefore,
      defSide.defenses,
    );
    roundLog.push({
      round: r,
      attackerLosses,
      defenderLosses,
      debrisThisRound: debrisFromShipLosses(
        attackerLosses.ships,
        defenderLosses.ships,
      ),
      shieldsAbsorbed: {
        attacker: Math.max(0, atkInitialShieldPool - (atkSide.shieldPool ?? 0)),
        defender: Math.max(0, defInitialShieldPool - (defSide.shieldPool ?? 0)),
      },
    });

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
    roundLog,
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
