import {
  ALIEN_BUILDUP_MS,
  ALIEN_EXPEDITION_FIND_CHANCE,
  ALIEN_EXCLUDED_SHIP_IDS,
  ALIEN_FREE_DEFENSE_BASE,
  ALIEN_FREE_DEFENSE_COMPOSITION,
  ALIEN_FREE_DEFENSE_PER_LEVEL,
  ALIEN_FREE_SHIP_BASE,
  ALIEN_FREE_SHIP_COMPOSITION,
  ALIEN_FREE_SHIP_PER_LEVEL,
  ALIEN_FREE_SPAWN_INTERVAL_MS,
  ALIEN_INITIAL_BASE_COUNT,
  ALIEN_LEVEL_DEFENSE_BASE,
  ALIEN_STARSHARD_REWARD_MULT,
  ALIEN_LEVEL_DEFENSE_COMPOSITION,
  ALIEN_LEVEL_DEFENSE_PER_LEVEL,
  ALIEN_MAX_BASE_COUNT,
  ALIEN_MAX_LEVEL,
  ALIEN_RAID_PERIOD_MS,
  ALIEN_SPLIT_CHILD_COUNT,
  ALIEN_SPLIT_CHILD_LEVEL,
  ALIEN_SPLIT_LEVEL,
  ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS,
  ALIEN_STRENGTH_MULT,
  ALIEN_TECH_ABOVE_TOP_PLAYER,
  ALIEN_VS_ALIEN_RAID_PERIOD_MULT,
  DEFENSE_ORDER,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  MINI_RELIC_PIRATE_WEIGHT,
  NPC_AI_BATCH_SIZE,
  NPC_RAID_CATCHUP_MAX,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_EXCLUDED_SHIP_IDS,
  PIRATE_FREE_DEFENSE_BASE,
  PIRATE_FREE_DEFENSE_COMPOSITION,
  PIRATE_FREE_DEFENSE_PER_LEVEL,
  PIRATE_FREE_SHIP_BASE,
  PIRATE_FREE_SHIP_COMPOSITION,
  PIRATE_FREE_SHIP_PER_LEVEL,
  PIRATE_FREE_SPAWN_INTERVAL_MS,
  PIRATE_LEVEL_DEFENSE_BASE,
  PIRATE_LEVEL_DEFENSE_COMPOSITION,
  PIRATE_LEVEL_DEFENSE_PER_LEVEL,
  PIRATE_LEVEL_GROWTH_INTERVAL_MS,
  PIRATE_FATIGUE_EXTRA_HITS,
  PIRATE_FATIGUE_FIRST_HITS,
  PIRATE_FATIGUE_MULT,
  PIRATE_FATIGUE_WINDOW_MS,
  PIRATE_MAX_LEVEL,
  PIRATE_RAID_PERIOD_MS,
  PIRATE_RAID_POWER_FACTOR,
  PIRATE_RAID_POWER_FLOOR,
  PIRATE_RESPAWN_DELAY_MAX_MS,
  PIRATE_RESPAWN_DELAY_MIN_MS,
  PIRATE_SPLIT_CHILD_COUNT,
  PIRATE_SPLIT_CHILD_LEVEL,
  PIRATE_SPLIT_LEVEL,
  PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS,
  PIRATE_STARSHARD_REWARD_MULT,
  PIRATE_BASES_PER_GALAXY,
  PIRATE_SAME_TARGET_COOLDOWN_MS,
  PIRATE_TARGET_BASE_COUNT,
  PIRATE_VS_PIRATE_RAID_PERIOD_MULT,
  SHIPS,
  SHIP_ORDER,
} from "./catalog.js";
import {
  PIRATE_RAID_POWER_FACTOR_PLAYER,
  PIRATE_RAID_LEVEL_POWER_BONUS,
  PIRATE_RAID_DISTANCE_REF,
  PIRATE_STRENGTH_MULT,
  PIRATE_TECH_OFFSET,
  PIRATE_BOSS_COOLDOWN_MS,
  PIRATE_BOSS_DURATION_MS,
  PIRATE_BOSS_MOTHERSHIPS,
  PIRATE_BOSS_RESOURCE_REWARD_MULT,
  PIRATE_BOSS_STARSHARD_REWARD_MULT,
  PIRATE_BOSS_TIER,
  NPC_AI_SLICE_INTERVAL_MS,
} from "./data/tuning.js";
import { recordCombatReport } from "./combat-share.js";
import {
  computeRaidLoot,
  debrisFromDestroyed,
  debrisFromDestroyedDefenses,
  defenseCombatPower,
  defenseRebuildRate,
  destroyedShipResources,
  effectiveCombatResearch,
  emptyDefenses,
  emptyFleetShips,
  emptyResearch,
  fleetCombatPower,
  fleetShipCount,
  grantPlayerXp,
  normalizeFleetShips,
  rebuildDefenses,
  resolveCombat,
  resourcesCostTotal,
  spoilSkimmerDebris,
  xpForCombatLose,
  xpForCombatWin,
  xpForPirateBaseDestroy,
  xpForPirateShipKills,
} from "./formulas.js";
import { hashSeed } from "./formulas-position.js";
import { coordDistance, flightSecondsOneWay } from "./formulas-travel.js";
import {
  awardSeasonPirateKill,
  awardSeasonPveWin,
} from "./world-seasons.js";
import type {
  AlienBase,
  Coordinates,
  DefenseId,
  DefenseStock,
  FleetMission,
  FleetShips,
  PirateBase,
  PirateTechs,
  PlanetState,
  ResearchLevels,
  Resources,
  ShipId,
  UniverseState,
} from "./types.js";
import {
  applyStarshardMultiplier,
  grantPirateDestroyStarshards,
  grantPirateFleetKillStarshards,
  utcDayKey,
} from "./world-boosts.js";
import { noteAchievementCount } from "./world-achievements.js";
import { noteGoalMetric } from "./world-goals.js";
import { emptyCargo, planetAtCoords } from "./world-bootstrap.js";
import { consumeTickBudget, syncPlanetForTick, tickBudget } from "./tick-budget.js";
import {
  payBossParticipation,
  recordBossDamage,
} from "./world-pirate-boss.js";
import { tryFormMoon } from "./world-moons.js";
import {
  isNewbieBonusActive,
  NEWBIE_DEFENSE_MULT,
  pirateRaidPickWeight,
  planetRaidDeterrence,
  recordSuccessfulPirateRaid,
} from "./world-protection.js";
import { addDebris, subtractCargo } from "./world-tick.js";

export const ALIEN_TECH_OFFSET = 2;
export const ALIEN_RAID_POWER_FACTOR_MIN = 0.90;
export const ALIEN_RAID_POWER_FACTOR_MAX = 1.00;

const PIRATE_NAMES = [
  "Black Comet Hold",
  "Corsair Nest",
  "Rogue Drift",
  "Scarlet Wake",
  "Iron Maw Colony",
  "Void Reaver Camp",
  "Ashen Jolly",
  "Cutlass Beacon",
] as const;

const ALIEN_NAMES = [
  "Veil Spire",
  "Silent Lattice",
  "Pale Choir Nest",
  "Null Orchid",
  "Glass Hive",
  "Echo Thorn",
  "Hollow Prism",
  "Starblind Array",
] as const;

const PIRATE_EXCLUDED = new Set<string>(PIRATE_EXCLUDED_SHIP_IDS);
const ALIEN_EXCLUDED = new Set<string>(ALIEN_EXCLUDED_SHIP_IDS);

const PIRATE_ELIGIBLE_LIST: ShipId[] = SHIP_ORDER.filter((id) => {
  if (PIRATE_EXCLUDED.has(id)) return false;
  const def = SHIPS[id];
  if (def.classExclusive) return false;
  if (def.stationary) return false;
  return true;
});
const PIRATE_ELIGIBLE = new Set<ShipId>(PIRATE_ELIGIBLE_LIST);

export function pirateEligibleShipIds(): ShipId[] {
  return PIRATE_ELIGIBLE_LIST;
}

export function pirateTechsForLevel(level: number): PirateTechs {
  const v = Math.min(2, Math.floor(Math.max(0, Math.floor(level)) / 4));
  return { weapons: v, armour: v, shielding: v };
}

export function pirateCombatResearchForOpponent(
  opponentResearch?: ResearchLevels,
): ResearchLevels {
  const research = emptyResearch();
  if (!opponentResearch) return research;
  research.weaponsTech = Math.max(0, (opponentResearch.weaponsTech ?? 0) - PIRATE_TECH_OFFSET);
  research.armourTech = Math.max(0, (opponentResearch.armourTech ?? 0) - PIRATE_TECH_OFFSET);
  research.shieldingTech = Math.max(0, (opponentResearch.shieldingTech ?? 0) - PIRATE_TECH_OFFSET);
  return research;
}

export function alienCombatResearchForOpponent(
  opponentResearch?: ResearchLevels,
): ResearchLevels {
  const research = emptyResearch();
  research.weaponsTech = Math.max(
    0,
    (opponentResearch?.weaponsTech ?? 0) + ALIEN_TECH_OFFSET,
  );
  research.armourTech = Math.max(
    0,
    (opponentResearch?.armourTech ?? 0) + ALIEN_TECH_OFFSET,
  );
  research.shieldingTech = Math.max(
    0,
    (opponentResearch?.shieldingTech ?? 0) + ALIEN_TECH_OFFSET,
  );
  return research;
}

export function pirateCombatResearch(
  base: PirateBase | AlienBase,
  opponentResearch?: ResearchLevels,
): ResearchLevels {
  if (opponentResearch && base.id.startsWith("aln:")) {
    return alienCombatResearchForOpponent(opponentResearch);
  }
  if (opponentResearch && base.id.startsWith("pir:")) {
    return pirateCombatResearchForOpponent(opponentResearch);
  }
  const techs = base.techs ?? pirateTechsForLevel(base.level ?? base.tier ?? 0);
  const research = emptyResearch();
  research.weaponsTech = techs.weapons;
  research.armourTech = techs.armour;
  research.shieldingTech = techs.shielding;
  return research;
}

export function alienTechsFromUniverse(universe: UniverseState): PirateTechs {
  let weapons = 0;
  let armour = 0;
  let shielding = 0;
  for (const player of Object.values(universe.players)) {
    const r = player.research;
    if (!r) continue;
    weapons = Math.max(weapons, r.weaponsTech ?? 0);
    armour = Math.max(armour, r.armourTech ?? 0);
    shielding = Math.max(shielding, r.shieldingTech ?? 0);
  }
  const plus = ALIEN_TECH_ABOVE_TOP_PLAYER;
  return { weapons: weapons + plus, armour: armour + plus, shielding: shielding + plus };
}

function normalizeDefenses(stock: Partial<DefenseStock> | undefined): DefenseStock {
  const out = emptyDefenses();
  if (!stock) return out;
  for (const id of DEFENSE_ORDER) out[id] = Math.max(0, Math.floor(stock[id] ?? 0));
  return out;
}

function addDefenses(into: DefenseStock, add: DefenseStock): DefenseStock {
  const out = normalizeDefenses(into);
  for (const id of DEFENSE_ORDER) out[id] = (out[id] ?? 0) + (add[id] ?? 0);
  return out;
}

function defenseCount(stock: DefenseStock): number {
  let n = 0;
  for (const id of DEFENSE_ORDER) n += stock[id] ?? 0;
  return n;
}

function distributeByComposition(
  total: number,
  composition: Readonly<Record<string, number>>,
  asDefense: boolean,
): DefenseStock | FleetShips {
  const out = asDefense ? emptyDefenses() : emptyFleetShips();
  const entries = Object.entries(composition).filter(([, w]) => w > 0);
  const weightSum = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let remaining = Math.max(0, Math.floor(total));
  for (let i = 0; i < entries.length; i++) {
    const [id, w] = entries[i]!;
    const n =
      i === entries.length - 1
        ? remaining
        : Math.floor((remaining * w) / weightSum);
    remaining -= n;
    if (asDefense) {
      if ((DEFENSE_ORDER as string[]).includes(id)) {
        (out as DefenseStock)[id as DefenseId] =
          ((out as DefenseStock)[id as DefenseId] ?? 0) + n;
      }
    } else if ((SHIP_ORDER as string[]).includes(id)) {
      (out as FleetShips)[id as ShipId] =
        ((out as FleetShips)[id as ShipId] ?? 0) + n;
    }
  }
  return out;
}

export function npcDefensesForLevelGrant(
  level: number,
  alien = false,
): DefenseStock {
  const base = alien ? ALIEN_LEVEL_DEFENSE_BASE : PIRATE_LEVEL_DEFENSE_BASE;
  const per = alien ? ALIEN_LEVEL_DEFENSE_PER_LEVEL : PIRATE_LEVEL_DEFENSE_PER_LEVEL;
  const comp = alien
    ? ALIEN_LEVEL_DEFENSE_COMPOSITION
    : PIRATE_LEVEL_DEFENSE_COMPOSITION;
  const total = base + per * Math.max(0, Math.floor(level));
  // Higher levels unlock denser composition: scale total further by level band.
  const band = 1 + Math.floor(Math.max(0, level) / 20) * 0.25;
  return distributeByComposition(
    Math.floor(total * band),
    comp,
    true,
  ) as DefenseStock;
}

export function npcFreeSpawnDefenses(
  level: number,
  alien = false,
): DefenseStock {
  const base = alien ? ALIEN_FREE_DEFENSE_BASE : PIRATE_FREE_DEFENSE_BASE;
  const per = alien ? ALIEN_FREE_DEFENSE_PER_LEVEL : PIRATE_FREE_DEFENSE_PER_LEVEL;
  const comp = alien
    ? ALIEN_FREE_DEFENSE_COMPOSITION
    : PIRATE_FREE_DEFENSE_COMPOSITION;
  const total = base + per * Math.max(0, Math.floor(level));
  return distributeByComposition(total, comp, true) as DefenseStock;
}

function shipsLookStripped(ships: FleetShips, banned: Set<string>): boolean {
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if ((banned.has(id) || !PIRATE_ELIGIBLE.has(id)) && n !== 0) return false;
  }
  return true;
}

function defensesLookNormalized(stock: DefenseStock | undefined): boolean {
  if (!stock) return false;
  for (const id of DEFENSE_ORDER) {
    const n = stock[id];
    if (typeof n !== "number" || n < 0 || n !== Math.floor(n)) return false;
  }
  return true;
}

function stripExcludedShips(
  ships: FleetShips,
  alien = false,
  seasonalBoss = false,
): FleetShips {
  const banned = alien ? ALIEN_EXCLUDED : PIRATE_EXCLUDED;
  const eligible = (id: ShipId) =>
    PIRATE_ELIGIBLE.has(id) || (seasonalBoss && id === "swarmMothership");
  if (!seasonalBoss && shipsLookStripped(ships, banned)) return ships;
  if (
    SHIP_ORDER.every((id) =>
      (banned.has(id) && !(seasonalBoss && id === "swarmMothership")) ||
      eligible(id) ||
      (ships[id] ?? 0) === 0,
    )
  ) return ships;
  const out = normalizeFleetShips(ships);
  for (const id of SHIP_ORDER) {
    if (
      (banned.has(id) && !(seasonalBoss && id === "swarmMothership")) ||
      !eligible(id)
    ) out[id] = 0;
  }
  return out;
}

export function ensurePirateBaseShape(
  base: PirateBase,
  now = Date.now(),
): PirateBase {
  const tier = Math.max(0, Math.floor(base.tier ?? base.level ?? 0));
  base.tier = Math.min(PIRATE_MAX_LEVEL, tier);
  base.level = base.tier;
  if (!base.techs) base.techs = pirateTechsForLevel(base.level);
  if (base.lastFreeSpawnAt == null) base.lastFreeSpawnAt = base.lastGrewAt ?? now;
  if (!base.coalitionId) {
    base.coalitionId =
      (base as { familyId?: string }).familyId ?? base.id;
  }
  if (base.splitDone == null) {
    base.splitDone =
      (base as { hasSplit?: boolean }).hasSplit ??
      base.level > PIRATE_SPLIT_LEVEL;
  }
  if (!defensesLookNormalized(base.defenses)) {
    base.defenses = normalizeDefenses(base.defenses);
  }
  const ships = base.ships ?? emptyFleetShips();
  base.ships = stripExcludedShips(ships, false, base.seasonalBoss === true);
  if (base.nextRaidAt == null || base.nextRaidAt <= 0) {
    base.nextRaidAt = rollNextRaidAt(base.id, now, PIRATE_RAID_PERIOD_MS);
  }
  pruneRecentRaidTargets(base, now);
  return base;
}

export function ensureAlienBaseShape(
  base: AlienBase,
  universe: UniverseState,
  now = Date.now(),
): AlienBase {
  const tier = Math.max(0, Math.floor(base.tier ?? base.level ?? 0));
  base.tier = Math.min(ALIEN_MAX_LEVEL, tier);
  base.level = base.tier;
  base.techs = alienTechsFromUniverse(universe);
  if (base.lastFreeSpawnAt == null) base.lastFreeSpawnAt = base.lastGrewAt ?? now;
  if (base.foundAt == null) {
    base.foundAt = (base as { settledAt?: number }).settledAt ?? now;
  }
  if (base.buildupEndsAt == null) {
    base.buildupEndsAt = base.foundAt + ALIEN_BUILDUP_MS;
  }
  if (!base.coalitionId) {
    base.coalitionId =
      (base as { familyId?: string }).familyId ?? base.id;
  }
  if (base.splitDone == null) {
    base.splitDone =
      (base as { hasSplit?: boolean }).hasSplit ??
      base.level > ALIEN_SPLIT_LEVEL;
  }
  if (!base.foundByPlayerId) base.foundByPlayerId = "";
  base.defenses = normalizeDefenses(base.defenses);
  base.ships = stripExcludedShips(base.ships ?? emptyFleetShips(), true);
  if (base.nextRaidAt == null || base.nextRaidAt <= 0) {
    base.nextRaidAt = Math.max(
      base.buildupEndsAt,
      rollNextRaidAt(base.id, now, ALIEN_RAID_PERIOD_MS),
    );
  }
  pruneRecentRaidTargets(base, now);
  return base;
}

export function pirateBaseId(galaxy: number, system: number, slot: number): string {
  return `pir:${galaxy}:${system}:${slot}`;
}

export function alienBaseId(galaxy: number, system: number, slot: number): string {
  return `aln:${galaxy}:${system}:${slot}`;
}

export function pirateDestroyStarshards(
  tier: number,
  faction: "pirate" | "alien" = "pirate",
  seed?: string,
  rewardMultiplier = 1,
): number {
  const oldAmount =
    PIRATE_DESTROY_STARSHARDS_BASE +
    PIRATE_DESTROY_STARSHARDS_PER_TIER * Math.max(0, Math.floor(tier));
  const mult =
    faction === "alien"
      ? ALIEN_STARSHARD_REWARD_MULT
      : PIRATE_STARSHARD_REWARD_MULT;
  return applyStarshardMultiplier(
    oldAmount,
    mult * Math.max(1, rewardMultiplier),
    seed,
  );
}

function rollInRange(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashSeed(seed) % span);
}

/** nextRaidAt = periodStart + random offset within the period; after `afterMs`. */
export function rollNextRaidAt(
  baseId: string,
  afterMs: number,
  periodMs: number,
  salt = "raid",
): number {
  const periodStart = Math.floor(afterMs / periodMs) * periodMs;
  let start = periodStart;
  // If still inside current period after afterMs, schedule this period's offset
  // only when offset is still in the future; else next period.
  const offset = hashSeed(`${baseId}:${salt}:${start}`) % periodMs;
  let at = start + offset;
  if (at <= afterMs) {
    start += periodMs;
    const offset2 = hashSeed(`${baseId}:${salt}:${start}`) % periodMs;
    at = start + offset2;
  }
  return at;
}

function scaleShips(base: FleetShips, factor: number): FleetShips {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, Math.floor((base[id] ?? 0) * factor + 1e-9));
  }
  if (fleetShipCount(out) < 1 && fleetShipCount(base) > 0) {
    for (const id of SHIP_ORDER) {
      if ((base[id] ?? 0) > 0) {
        out[id] = 1;
        break;
      }
    }
  }
  return out;
}

export function alienRaidPowerFactor(seed: string): number {
  return (
    ALIEN_RAID_POWER_FACTOR_MIN +
    ((hashSeed(seed) % 1001) / 1000) *
      (ALIEN_RAID_POWER_FACTOR_MAX - ALIEN_RAID_POWER_FACTOR_MIN)
  );
}

export function scaleAlienRaidFleet(
  full: FleetShips,
  defenderPower: number,
  seed: string,
): FleetShips {
  const eligible = normalizeFleetShips(full);
  const cap = Math.max(0, defenderPower * alienRaidPowerFactor(seed));
  const factor = Math.min(1, cap / Math.max(1, fleetCombatPower(eligible)));
  return scaleShips(eligible, factor);
}

function mergeHangarAtLeast(current: FleetShips, template: FleetShips): FleetShips {
  const out = normalizeFleetShips(current);
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(out[id] ?? 0, template[id] ?? 0);
  }
  return out;
}

function addShips(into: FleetShips, add: FleetShips): FleetShips {
  return addShipsTimes(into, add, 1);
}

function subtractShips(hangar: FleetShips, sent: FleetShips): FleetShips {
  const out = normalizeFleetShips(hangar);
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, (out[id] ?? 0) - (sent[id] ?? 0));
  }
  return out;
}

function addShipsTimes(
  into: FleetShips,
  add: FleetShips,
  times: number,
): FleetShips {
  const out = normalizeFleetShips(into);
  if (times <= 0) return out;
  for (const id of SHIP_ORDER) {
    out[id] = (out[id] ?? 0) + (add[id] ?? 0) * times;
  }
  return out;
}

function addDefensesTimes(
  into: DefenseStock,
  add: DefenseStock,
  times: number,
): DefenseStock {
  const out = normalizeDefenses(into);
  if (times <= 0) return out;
  for (const id of DEFENSE_ORDER) {
    out[id] = (out[id] ?? 0) + (add[id] ?? 0) * times;
  }
  return out;
}

/** Unscaled ordinary hull table. Boss spawn uses this; pirates then apply PIRATE_STRENGTH_MULT. */
function pirateShipTemplate(tier: number): FleetShips {
  const t = Math.max(0, Math.min(PIRATE_MAX_LEVEL, Math.floor(tier)));
  const ships = emptyFleetShips();
  ships.scout = 2 + Math.floor(t * 0.4);
  ships.interceptor = t >= 1 ? Math.max(1, Math.floor(t * 0.25)) : 0;
  ships.hauler = t >= 1 ? Math.ceil(t / 8) : 0;
  ships.probe = t >= 2 ? 1 + Math.floor(t / 20) : 0;
  ships.cruiser = t >= 3 ? Math.max(1, Math.floor((t - 2) / 6)) : 0;
  ships.bomber = t >= 5 ? Math.max(1, Math.floor((t - 4) / 8)) : 0;
  ships.keelSovereign = t >= 8 ? Math.max(0, Math.floor((t - 7) / 10)) : 0;
  ships.rakeCorsair = t >= 10 ? Math.max(0, Math.floor((t - 9) / 10)) : 0;
  ships.recycler = t >= 12 ? Math.max(1, Math.floor((t - 11) / 12)) : 0;
  ships.colonyShip = t >= 15 ? 1 : 0;
  ships.anvilDread = t >= 20 ? Math.max(0, Math.floor((t - 19) / 12)) : 0;
  ships.wardbreaker = t >= 25 ? Math.max(0, Math.floor((t - 24) / 12)) : 0;
  if (t >= 35) {
    ships.swarmDrone = 4 + Math.floor((t - 35) / 5);
    ships.swarmHarvester = t >= 45 ? 1 + Math.floor((t - 45) / 20) : 0;
  }
  return stripExcludedShips(ships, false);
}

/**
 * One cut for ordinary pirate hulls. Hangar templates and free-spawn counts
 * both go through here. Raid detachments are taken from the hangar, so they
 * inherit it. Seasonal boss hangar does not call this.
 */
function scaleOrdinaryPirateShips(ships: FleetShips): FleetShips {
  return scaleShips(ships, PIRATE_STRENGTH_MULT);
}

export function pirateShipsForTier(tier: number): FleetShips {
  return scaleOrdinaryPirateShips(pirateShipTemplate(tier));
}

export function alienShipsForTier(tier: number): FleetShips {
  return stripExcludedShips(
    scaleShips(pirateShipTemplate(tier), ALIEN_STRENGTH_MULT),
    true,
  );
}

export function pirateFreeSpawnShips(level: number): FleetShips {
  const total =
    PIRATE_FREE_SHIP_BASE +
    PIRATE_FREE_SHIP_PER_LEVEL * Math.max(0, Math.floor(level));
  return scaleOrdinaryPirateShips(
    stripExcludedShips(
      distributeByComposition(
        total,
        PIRATE_FREE_SHIP_COMPOSITION,
        false,
      ) as FleetShips,
      false,
    ),
  );
}

export function alienFreeSpawnShips(level: number): FleetShips {
  const total =
    ALIEN_FREE_SHIP_BASE +
    ALIEN_FREE_SHIP_PER_LEVEL * Math.max(0, Math.floor(level));
  return stripExcludedShips(
    distributeByComposition(
      total,
      ALIEN_FREE_SHIP_COMPOSITION,
      false,
    ) as FleetShips,
    true,
  );
}

function pirateResourcesForTier(tier: number): Resources {
  const t = Math.max(0, Math.floor(tier));
  return {
    metal: 800 + t * 400,
    crystal: 400 + t * 250,
    deuterium: 100 + t * 80,
  };
}

function pirateName(seed: string, galaxy: number, system: number): string {
  return PIRATE_NAMES[hashSeed(`${seed}:pname:${galaxy}:${system}`) % PIRATE_NAMES.length]!;
}

function alienName(seed: string, galaxy: number, system: number): string {
  return ALIEN_NAMES[hashSeed(`${seed}:aname:${galaxy}:${system}`) % ALIEN_NAMES.length]!;
}

export function activePirateBases(universe: UniverseState): PirateBase[] {
  return Object.values(universe.pirateBases ?? {}).filter((b) => b.destroyedAt == null);
}

export function activeAlienBases(universe: UniverseState): AlienBase[] {
  return Object.values(universe.alienBases ?? {}).filter((b) => b.destroyedAt == null);
}

export function pirateBaseAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PirateBase | null {
  return (
    activePirateBases(universe).find(
      (b) =>
        b.coords.galaxy === coords.galaxy &&
        b.coords.system === coords.system &&
        b.coords.slot === coords.slot,
    ) ?? null
  );
}

export function alienBaseAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): AlienBase | null {
  return (
    activeAlienBases(universe).find(
      (b) =>
        b.coords.galaxy === coords.galaxy &&
        b.coords.system === coords.system &&
        b.coords.slot === coords.slot,
    ) ?? null
  );
}

export function slotBlocked(universe: UniverseState, coords: Coordinates): boolean {
  return Boolean(
    planetAtCoords(universe, coords) ||
      pirateBaseAtCoords(universe, coords) ||
      alienBaseAtCoords(universe, coords),
  );
}

/**
 * Find a free slot in a galaxy (slots 1..15 only, never slot 16, never occupied, never on a mini planet).
 * Iterates through systems 1..MAP_SYSTEMS in the given galaxy.
 */
export function findFreeSlotInGalaxy(
  universe: UniverseState,
  galaxy: number,
  seedKey: string,
): Coordinates | null {
  const freeSlots: Coordinates[] = [];
  for (let system = 1; system <= MAP_SYSTEMS; system++) {
    for (let slot = 1; slot <= 15; slot++) {
      const coords = { galaxy, system, slot };
      if (!slotBlocked(universe, coords)) {
        freeSlots.push(coords);
      }
    }
  }

  if (freeSlots.length === 0) return null;
  const idx = hashSeed(seedKey) % freeSlots.length;
  return freeSlots[idx]!;
}

function systemOccupiedByNpc(
  universe: UniverseState,
  galaxy: number,
  system: number,
  exceptId?: string,
): boolean {
  if (
    activePirateBases(universe).some(
      (b) =>
        b.id !== exceptId &&
        b.coords.galaxy === galaxy &&
        b.coords.system === system,
    )
  ) {
    return true;
  }
  return activeAlienBases(universe).some(
    (b) =>
      b.id !== exceptId &&
      b.coords.galaxy === galaxy &&
      b.coords.system === system,
  );
}

function pickEmptySlot(
  universe: UniverseState,
  galaxy: number,
  system: number,
  seedKey: string,
): number | null {
  const start = 1 + (hashSeed(seedKey) % MAP_SLOTS);
  for (let i = 0; i < MAP_SLOTS; i++) {
    const slot = ((start - 1 + i) % MAP_SLOTS) + 1;
    if (!slotBlocked(universe, { galaxy, system, slot })) return slot;
  }
  return null;
}

/** Nearest open slot 1-3 to origin, with the existing open-slot fallback. */
export function findNearestOpenSlot1(
  universe: UniverseState,
  origin: Coordinates,
  seedKey: string,
): Coordinates | null {
  const occupiedCoords = new Set<string>();
  const occupiedSystems = new Set<string>();
  for (const planet of Object.values(universe.planets)) {
    if (planet.kind !== "moon") {
      occupiedCoords.add(`${planet.coords.galaxy}:${planet.coords.system}:${planet.coords.slot}`);
    }
  }
  for (const base of [...activePirateBases(universe), ...activeAlienBases(universe)]) {
    const systemKey = `${base.coords.galaxy}:${base.coords.system}`;
    occupiedSystems.add(systemKey);
    occupiedCoords.add(`${systemKey}:${base.coords.slot}`);
  }
  const isOccupied = (galaxy: number, system: number) =>
    occupiedSystems.has(`${galaxy}:${system}`);

  const preferred: Coordinates[] = [];
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      if (isOccupied(galaxy, system)) continue;
      for (let slot = 1; slot <= 3; slot++) {
        const coords = { galaxy, system, slot };
        if (!occupiedCoords.has(`${galaxy}:${system}:${slot}`)) preferred.push(coords);
      }
    }
  }
  if (preferred.length) {
    preferred.sort((a, b) =>
      coordDistance(origin, a) - coordDistance(origin, b) ||
      a.galaxy - b.galaxy ||
      a.system - b.system ||
      a.slot - b.slot,
    );
    const nearestDistance = coordDistance(origin, preferred[0]!);
    const nearest = preferred.filter((coords) => coordDistance(origin, coords) === nearestDistance);
    return nearest[hashSeed(`${seedKey}:nearest-slot`) % nearest.length]!;
  }

  // If no preferred slot is free anywhere, use the same seeded any-slot choice.
  const fallback: Coordinates[] = [];
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      if (isOccupied(galaxy, system)) continue;
      const slotStart = 1 + (hashSeed(`${seedKey}:fallback:${galaxy}:${system}`) % MAP_SLOTS);
      let slot: number | null = null;
      for (let i = 0; i < MAP_SLOTS; i++) {
        const candidate = ((slotStart - 1 + i) % MAP_SLOTS) + 1;
        if (!occupiedCoords.has(`${galaxy}:${system}:${candidate}`)) {
          slot = candidate;
          break;
        }
      }
      if (slot != null) fallback.push({ galaxy, system, slot });
    }
  }
  if (!fallback.length) return null;
  fallback.sort((a, b) => coordDistance(origin, a) - coordDistance(origin, b));
  const nearestDistance = coordDistance(origin, fallback[0]!);
  const nearest = fallback.filter((coords) => coordDistance(origin, coords) === nearestDistance);
  return nearest[hashSeed(`${seedKey}:fallback`) % nearest.length]!;
}

function findNearbyEmptySlots(
  universe: UniverseState,
  origin: Coordinates,
  count: number,
  seedKey: string,
  radiusCap: number,
  exceptId?: string,
): Coordinates[] {
  const found: Coordinates[] = [];
  for (let radius = 1; radius <= radiusCap && found.length < count; radius++) {
    for (let dg = -radius; dg <= radius && found.length < count; dg++) {
      for (let ds = -radius; ds <= radius && found.length < count; ds++) {
        if (Math.max(Math.abs(dg), Math.abs(ds)) !== radius) continue;
        const galaxy = origin.galaxy + dg;
        const system = origin.system + ds;
        if (galaxy < 1 || galaxy > MAP_GALAXIES) continue;
        if (system < 1 || system > MAP_SYSTEMS) continue;
        if (systemOccupiedByNpc(universe, galaxy, system, exceptId)) continue;
        const slot = pickEmptySlot(
          universe,
          galaxy,
          system,
          `${seedKey}:near:${galaxy}:${system}:${found.length}`,
        );
        if (slot != null) found.push({ galaxy, system, slot });
      }
    }
  }
  return found;
}

export function createPirateBase(
  universeSeed: string,
  galaxy: number,
  system: number,
  slot: number,
  now: number,
  tier = 0,
  coalitionId?: string,
): PirateBase {
  const id = pirateBaseId(galaxy, system, slot);
  const level = Math.max(0, Math.min(PIRATE_MAX_LEVEL, Math.floor(tier)));
  let defenses = emptyDefenses();
  for (let L = 1; L <= level; L++) {
    defenses = addDefenses(defenses, npcDefensesForLevelGrant(L, false));
  }
  return ensurePirateBaseShape(
    {
      id,
      coords: { galaxy, system, slot },
      name: pirateName(universeSeed, galaxy, system),
      tier: level,
      level,
      ships: pirateShipsForTier(level),
      defenses,
      resources: pirateResourcesForTier(level),
      techs: pirateTechsForLevel(level),
      lastGrewAt: now,
      lastRaidAt: now,
      nextRaidAt: rollNextRaidAt(id, now, PIRATE_RAID_PERIOD_MS),
      lastFreeSpawnAt: now,
      destroyedAt: null,
      coalitionId: coalitionId ?? id,
      splitDone: level > PIRATE_SPLIT_LEVEL,
    },
    now,
  );
}

export function createAlienBase(
  universe: UniverseState,
  galaxy: number,
  system: number,
  slot: number,
  now: number,
  foundByPlayerId: string,
  tier = 0,
  coalitionId?: string,
): AlienBase {
  const seed = universe.seed ?? universe.id;
  const id = alienBaseId(galaxy, system, slot);
  const level = Math.max(0, Math.min(ALIEN_MAX_LEVEL, Math.floor(tier)));
  let defenses = emptyDefenses();
  for (let L = 1; L <= level; L++) {
    defenses = addDefenses(defenses, npcDefensesForLevelGrant(L, true));
  }
  const buildupEndsAt = now + ALIEN_BUILDUP_MS;
  return ensureAlienBaseShape(
    {
      id,
      coords: { galaxy, system, slot },
      name: alienName(seed, galaxy, system),
      tier: level,
      level,
      ships: alienShipsForTier(level),
      defenses,
      resources: pirateResourcesForTier(level),
      techs: alienTechsFromUniverse(universe),
      lastGrewAt: now,
      lastRaidAt: now,
      nextRaidAt: Math.max(
        buildupEndsAt,
        rollNextRaidAt(id, buildupEndsAt, ALIEN_RAID_PERIOD_MS),
      ),
      lastFreeSpawnAt: now,
      destroyedAt: null,
      coalitionId: coalitionId ?? id,
      splitDone: level > ALIEN_SPLIT_LEVEL,
      buildupEndsAt,
      foundAt: now,
      foundByPlayerId,
    },
    universe,
    now,
  );
}

/**
 * Rank key for pirate spawn sites. FNV-1a alone barely changes for keys
 * that differ only in the last characters, so whole galaxies sorted
 * together and some got 0 pirates. The murmur3 finalizer spreads the keys.
 */
export function pirateRankKey(seed: string, galaxy: number, system: number): number {
  let h = hashSeed(`${seed}:pirate-rank:${galaxy}:${system}`);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function collectPirateSpawnSites(
  universe: UniverseState,
  seed: string,
  target: number,
  perGalaxyCap?: number,
): Coordinates[] {
  const occupied = new Set<string>();
  const taken = new Set<string>();
  for (const base of Object.values(universe.pirateBases ?? {})) {
    if (base.destroyedAt != null) continue;
    occupied.add(`${base.coords.galaxy}:${base.coords.system}`);
    taken.add(`${base.coords.galaxy}:${base.coords.system}:${base.coords.slot}`);
  }
  for (const base of Object.values(universe.alienBases ?? {})) {
    if (base.destroyedAt != null) continue;
    occupied.add(`${base.coords.galaxy}:${base.coords.system}`);
    taken.add(`${base.coords.galaxy}:${base.coords.system}:${base.coords.slot}`);
  }
  type Ranked = { key: number; galaxy: number; system: number };
  const byGalaxy: Ranked[][] = [];
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    const systems: Ranked[] = [];
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      systems.push({
        key: pirateRankKey(seed, galaxy, system),
        galaxy,
        system,
      });
    }
    systems.sort((a, b) => a.key - b.key || a.system - b.system);
    byGalaxy.push(systems);
  }

  const pointers = new Array<number>(MAP_GALAXIES).fill(0);
  const sites: Coordinates[] = [];
  const galaxyCount =
    perGalaxyCap != null ? nonBossCountByGalaxy(universe) : null;
  const closed = new Array<boolean>(MAP_GALAXIES).fill(false);

  while (sites.length < target) {
    let placedAnyInRound = false;
    for (let gIndex = 0; gIndex < MAP_GALAXIES; gIndex++) {
      if (sites.length >= target) break;
      if (closed[gIndex]) continue;
      const galaxy = gIndex + 1;
      if (
        galaxyCount &&
        perGalaxyCap != null &&
        (galaxyCount[galaxy] ?? 0) >= perGalaxyCap
      ) {
        closed[gIndex] = true;
        continue;
      }
      const galaxyList = byGalaxy[gIndex]!;
      let placedHere = false;
      while (pointers[gIndex]! < galaxyList.length) {
        const row = galaxyList[pointers[gIndex]!++]!;
        if (occupied.has(`${row.galaxy}:${row.system}`)) continue;
        const slot = pickEmptySlotFrom(
          universe,
          row.galaxy,
          row.system,
          `${seed}:pirate-slot:${row.galaxy}:${row.system}`,
          taken,
        );
        if (slot == null) continue;
        sites.push({ galaxy: row.galaxy, system: row.system, slot });
        taken.add(`${row.galaxy}:${row.system}:${slot}`);
        occupied.add(`${row.galaxy}:${row.system}`);
        if (galaxyCount) galaxyCount[galaxy] = (galaxyCount[galaxy] ?? 0) + 1;
        placedAnyInRound = true;
        placedHere = true;
        break;
      }
      if (!placedHere && pointers[gIndex]! >= galaxyList.length) {
        closed[gIndex] = true;
      }
    }
    if (!placedAnyInRound) break;
  }

  return sites;
}

function pickEmptySlotFrom(
  universe: UniverseState,
  galaxy: number,
  system: number,
  seedKey: string,
  taken: Set<string>,
): number | null {
  const start = 1 + (hashSeed(seedKey) % MAP_SLOTS);
  for (let i = 0; i < MAP_SLOTS; i++) {
    const slot = ((start - 1 + i) % MAP_SLOTS) + 1;
    if (taken.has(`${galaxy}:${system}:${slot}`)) continue;
    if (planetAtCoords(universe, { galaxy, system, slot })) continue;
    return slot;
  }
  return null;
}

/**
 * Place the next `limit` pirates from an already-sorted rank list.
 * Skips systems that already have an NPC, so repeated calls resume.
 * Returns how many were created.
 */
export function placePiratesFromRanked(
  universe: UniverseState,
  ranked: { key: number; galaxy: number; system: number }[],
  limit: number,
  now: number,
): { placed: number; scanned: number } {
  const seed = universe.seed ?? universe.id;
  if (!universe.pirateBases) universe.pirateBases = {};
  let placed = 0;
  let scanned = 0;
  let living = activePirateBases(universe).length;
  const counts = nonBossCountByGalaxy(universe);
  for (const row of ranked) {
    if (placed >= limit || living >= PIRATE_TARGET_BASE_COUNT) break;
    scanned += 1;
    if ((counts[row.galaxy] ?? 0) >= PIRATE_BASES_PER_GALAXY) continue;
    if (systemOccupiedByNpc(universe, row.galaxy, row.system)) continue;
    const slot = pickEmptySlot(
      universe,
      row.galaxy,
      row.system,
      `${seed}:pirate-slot:${row.galaxy}:${row.system}`,
    );
    if (slot == null) continue;
    const base = createPirateBase(seed, row.galaxy, row.system, slot, now, 0);
    universe.pirateBases[base.id] = base;
    counts[row.galaxy] = (counts[row.galaxy] ?? 0) + 1;
    placed += 1;
    living += 1;
  }
  return { placed, scanned };
}

/**
 * Bootstrap seed to PIRATE_TARGET_BASE_COUNT. Aliens stay empty
 * (ALIEN_INITIAL_BASE_COUNT = 0). Never wipes players.
 */
export function seedUniversePirates(
  universe: UniverseState,
  now = Date.now(),
): void {
  const seed = universe.seed ?? universe.id;
  if (!universe.pirateBases) universe.pirateBases = {};
  universe.alienBases = universe.alienBases ?? {};
  void ALIEN_INITIAL_BASE_COUNT; // documented zero — do not seed

  const kept: Record<string, PirateBase> = {};
  const seasonalBosses: Record<string, PirateBase> = {};
  for (const [id, base] of Object.entries(universe.pirateBases)) {
    if (base.destroyedAt != null) kept[id] = ensurePirateBaseShape(base, now);
    else if (base.seasonalBoss) seasonalBosses[id] = base;
  }
  universe.pirateBases = { ...kept, ...seasonalBosses };
  const livingBossCount = Object.values(seasonalBosses).filter(
    (base) => base.destroyedAt == null,
  ).length;
  const room = Math.max(0, PIRATE_TARGET_BASE_COUNT - livingBossCount);
  const living: Record<string, PirateBase> = {};
  for (const site of collectPirateSpawnSites(
    universe,
    seed,
    room,
    PIRATE_BASES_PER_GALAXY,
  )) {
    const base = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      0,
    );
    living[base.id] = base;
  }
  universe.pirateBases = { ...kept, ...living, ...seasonalBosses };
}

function aiCatchUpBaseId(universe: UniverseState): string | null {
  const saved = universe.aiCatchUpCursor;
  if (!saved) return null;
  const separator = saved.indexOf(":");
  if (separator > 0 && Number.isFinite(Number(saved.slice(0, separator)))) {
    return saved.slice(separator + 1) || null;
  }
  return saved;
}

function isProtectedPirateBoss(universe: UniverseState, base: PirateBase): boolean {
  return (
    base.seasonalBoss === true ||
    (universe.pirateBossBaseId != null && base.id === universe.pirateBossBaseId)
  );
}

/** Inactive, then low level, then not due to raid, then id. */
function compareCullPriority(a: PirateBase, b: PirateBase, now: number): number {
  const raidA = a.lastRaidAt ?? 0;
  const raidB = b.lastRaidAt ?? 0;
  if (raidA !== raidB) return raidA < raidB ? -1 : 1;
  const levelA = a.level ?? 0;
  const levelB = b.level ?? 0;
  if (levelA !== levelB) return levelA - levelB;
  const dueA = a.nextRaidAt <= now ? 1 : 0;
  const dueB = b.nextRaidAt <= now ? 1 : 0;
  if (dueA !== dueB) return dueA - dueB;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Drop excess living non-boss bases until each galaxy has at most
 * `PIRATE_BASES_PER_GALAXY` and the living total is at most
 * `PIRATE_TARGET_BASE_COUNT` (`PIRATE_BASES_PER_GALAXY * MAP_GALAXIES`).
 * Over-full galaxies are trimmed first. The seasonal boss stays.
 * A finished cull writes no raid report. Returns how many bases were removed.
 */
export function cullExcessPirateBases(universe: UniverseState, now: number): number {
  if (!universe.pirateBases) return 0;
  const living = activePirateBases(universe);
  const bosses: PirateBase[] = [];
  const byGalaxy = new Map<number, PirateBase[]>();
  for (const base of living) {
    if (isProtectedPirateBoss(universe, base)) {
      bosses.push(base);
      continue;
    }
    const galaxy = base.coords.galaxy;
    const list = byGalaxy.get(galaxy);
    if (list) list.push(base);
    else byGalaxy.set(galaxy, [base]);
  }
  const galaxyOver = [...byGalaxy.values()].some(
    (list) => list.length > PIRATE_BASES_PER_GALAXY,
  );
  if (!galaxyOver && living.length <= PIRATE_TARGET_BASE_COUNT) return 0;
  const survivors: PirateBase[] = [];
  const doomed: PirateBase[] = [];
  const galaxies = [...byGalaxy.keys()].sort((a, b) => a - b);
  for (const galaxy of galaxies) {
    const list = byGalaxy.get(galaxy)!;
    list.sort((a, b) => compareCullPriority(a, b, now));
    const extra = list.length - PIRATE_BASES_PER_GALAXY;
    if (extra > 0) {
      doomed.push(...list.slice(0, extra));
      survivors.push(...list.slice(extra));
    } else {
      survivors.push(...list);
    }
  }
  const keepNonBoss = Math.max(0, PIRATE_TARGET_BASE_COUNT - bosses.length);
  if (survivors.length > keepNonBoss) {
    survivors.sort((a, b) => compareCullPriority(a, b, now));
    const more = survivors.length - keepNonBoss;
    doomed.push(...survivors.splice(0, more));
  }
  if (doomed.length === 0) return 0;
  const pinned = aiCatchUpBaseId(universe);
  let removed = 0;
  for (const base of doomed) {
    markPirateDestroyed(base, now);
    delete universe.pirateBases[base.id];
    removed += 1;
  }
  if (pinned && universe.pirateBases[pinned] == null) {
    universe.aiCatchUpCursor = null;
  }
  return removed;
}

function nonBossCountByGalaxy(universe: UniverseState): number[] {
  const counts = new Array<number>(MAP_GALAXIES + 1).fill(0);
  for (const base of activePirateBases(universe)) {
    if (isProtectedPirateBoss(universe, base)) continue;
    const galaxy = base.coords.galaxy;
    if (galaxy >= 1 && galaxy <= MAP_GALAXIES) counts[galaxy] += 1;
  }
  return counts;
}

/** Total living cap and the destination galaxy both have room for one more non-boss base. */
export function pirateGalaxyAcceptsSpawn(
  universe: UniverseState,
  galaxy: number,
): boolean {
  if (galaxy < 1 || galaxy > MAP_GALAXIES) return false;
  if (activePirateBases(universe).length >= PIRATE_TARGET_BASE_COUNT) return false;
  return (nonBossCountByGalaxy(universe)[galaxy] ?? 0) < PIRATE_BASES_PER_GALAXY;
}

/** Top up to the design target. Prunes excess non-boss bases first. Never removes players. */
export function ensurePiratePopulation(
  universe: UniverseState,
  now = Date.now(),
): void {
  if (universe.seedCursor && !universe.seedCursor.done) return;
  if (!universe.pirateBases) universe.pirateBases = {};
  if (!universe.alienBases) universe.alienBases = {};
  cullExcessPirateBases(universe, now);
  // No occupancy data: placing would land on a planet this request did not load.
  if (universe.skipPirateTopUp) return;
  // Ranking every system is a few milliseconds. A budgeted page load skips it.
  // The npc job (skipNpcRaids is false) still tops up under a Workers budget.
  if (tickBudget() && universe.skipNpcRaids) return;
  let living = activePirateBases(universe).length;
  if (living >= PIRATE_TARGET_BASE_COUNT) return;
  for (const base of Object.values(universe.pirateBases)) {
    ensurePirateBaseShape(base, now);
  }
  living = activePirateBases(universe).length;
  if (living >= PIRATE_TARGET_BASE_COUNT) return;
  const seed = universe.seed ?? universe.id;
  const need = PIRATE_TARGET_BASE_COUNT - living;
  for (const site of collectPirateSpawnSites(
    universe,
    `${seed}:topup`,
    need,
    PIRATE_BASES_PER_GALAXY,
  )) {
    if (living >= PIRATE_TARGET_BASE_COUNT) break;
    const base = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      0,
    );
    universe.pirateBases[base.id] = base;
    living += 1;
  }
}

/** @deprecated Prefer rollNextRaidAt / base.nextRaidAt. */
export function npcRaidOffsetMs(baseId: string): number {
  return hashSeed(`${baseId}:raid-offset`) % PIRATE_RAID_PERIOD_MS;
}

/** @deprecated Prefer base.nextRaidAt. */
export function nextNpcRaidAt(baseId: string, lastRaidAt: number): number {
  return rollNextRaidAt(baseId, lastRaidAt, PIRATE_RAID_PERIOD_MS);
}

export function pirateRespawnAt(destroyedAt: number, baseId: string): number {
  return (
    destroyedAt +
    rollInRange(
      `${baseId}:respawn:${destroyedAt}`,
      PIRATE_RESPAWN_DELAY_MIN_MS,
      PIRATE_RESPAWN_DELAY_MAX_MS,
    )
  );
}

export function applyStrongShipCap(
  baseShips: FleetShips,
  defenderShips?: FleetShips,
): FleetShips {
  if (!defenderShips) return normalizeFleetShips(baseShips);

  const interceptorCost = resourcesCostTotal(SHIPS.interceptor.cost);
  const out = normalizeFleetShips(baseShips);

  for (const id of SHIP_ORDER) {
    const cost = resourcesCostTotal(SHIPS[id].cost);
    if (cost > interceptorCost) {
      let defenderStrongerCount = 0;
      for (const otherId of SHIP_ORDER) {
        const otherCost = resourcesCostTotal(SHIPS[otherId].cost);
        if (otherCost >= cost) {
          defenderStrongerCount += defenderShips[otherId] ?? 0;
        }
      }
      out[id] = Math.min(out[id] ?? 0, defenderStrongerCount);
    }
  }

  return out;
}

/**
 * Level 0 keeps `baseFactor`. Level PIRATE_MAX_LEVEL multiplies it by
 * 1 + PIRATE_RAID_LEVEL_POWER_BONUS (1.5×). Aliens do not call this.
 */
export function pirateRaidPowerFactor(baseFactor: number, level: number): number {
  const clamped = Math.max(0, Math.min(PIRATE_MAX_LEVEL, Math.floor(level) || 0));
  return baseFactor * (1 + PIRATE_RAID_LEVEL_POWER_BONUS * (clamped / PIRATE_MAX_LEVEL));
}

export function scalePirateRaidFleet(
  full: FleetShips,
  defenderPower: number,
  defenderShips?: FleetShips,
  factorOverride?: number,
): FleetShips {
  const factor =
    factorOverride ??
    (defenderShips ? PIRATE_RAID_POWER_FACTOR_PLAYER : PIRATE_RAID_POWER_FACTOR);
  const eligible = defenderShips ? applyStrongShipCap(full, defenderShips) : normalizeFleetShips(full);
  const eligiblePower = Math.max(1, fleetCombatPower(eligible));
  const cap = defenderShips
    ? Math.max(0, defenderPower * factor)
    : Math.max(PIRATE_RAID_POWER_FLOOR, defenderPower * factor) || PIRATE_RAID_POWER_FLOOR;
  const scaleFactor = Math.min(1, cap / eligiblePower);
  return scaleShips(eligible, scaleFactor);
}

function applyFreeSpawnsPirate(base: PirateBase, now: number): void {
  // Ships and defenses on a base that already exists. This does not create a base.
  if (base.destroyedAt != null) return;
  const interval = PIRATE_FREE_SPAWN_INTERVAL_MS;
  const steps = Math.floor((now - base.lastFreeSpawnAt) / interval);
  if (steps <= 0) return;
  // Growth runs first, so every missed interval uses the post-growth level.
  base.ships = addShipsTimes(base.ships, pirateFreeSpawnShips(base.level), steps);
  base.defenses = addDefensesTimes(
    base.defenses,
    npcFreeSpawnDefenses(base.level, false),
    steps,
  );
  base.lastFreeSpawnAt += steps * interval;
}

function applyFreeSpawnsAlien(base: AlienBase, now: number): void {
  if (base.destroyedAt != null) return;
  const interval = ALIEN_FREE_SPAWN_INTERVAL_MS;
  const steps = Math.floor((now - base.lastFreeSpawnAt) / interval);
  if (steps <= 0) return;
  base.ships = addShipsTimes(base.ships, alienFreeSpawnShips(base.level), steps);
  base.defenses = addDefensesTimes(
    base.defenses,
    npcFreeSpawnDefenses(base.level, true),
    steps,
  );
  base.lastFreeSpawnAt += steps * interval;
}

function tryPirateSplit(
  universe: UniverseState,
  base: PirateBase,
  now: number,
): void {
  if (base.splitDone) return;
  if (base.level !== PIRATE_SPLIT_LEVEL) return;
  base.splitDone = true;
  let living = activePirateBases(universe).length;
  if (living >= PIRATE_TARGET_BASE_COUNT) return;
  const counts = nonBossCountByGalaxy(universe);
  const seed = universe.seed ?? universe.id;
  const sites = findNearbyEmptySlots(
    universe,
    base.coords,
    PIRATE_SPLIT_CHILD_COUNT,
    `${seed}:psplit:${base.id}`,
    PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS,
    base.id,
  );
  if (!universe.pirateBases) universe.pirateBases = {};
  for (const site of sites) {
    if (living >= PIRATE_TARGET_BASE_COUNT) break;
    if ((counts[site.galaxy] ?? 0) >= PIRATE_BASES_PER_GALAXY) continue;
    const child = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      PIRATE_SPLIT_CHILD_LEVEL,
      base.coalitionId,
    );
    universe.pirateBases[child.id] = child;
    counts[site.galaxy] = (counts[site.galaxy] ?? 0) + 1;
    living += 1;
  }
}

function tryAlienSplit(
  universe: UniverseState,
  base: AlienBase,
  now: number,
): void {
  if (base.splitDone) return;
  if (base.level !== ALIEN_SPLIT_LEVEL) return;
  if (activeAlienBases(universe).length >= ALIEN_MAX_BASE_COUNT) {
    base.splitDone = true;
    return;
  }
  base.splitDone = true;
  const seed = universe.seed ?? universe.id;
  const sites = findNearbyEmptySlots(
    universe,
    base.coords,
    ALIEN_SPLIT_CHILD_COUNT,
    `${seed}:asplit:${base.id}`,
    ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS,
    base.id,
  );
  for (const site of sites) {
    if (activeAlienBases(universe).length >= ALIEN_MAX_BASE_COUNT) break;
    const child = createAlienBase(
      universe,
      site.galaxy,
      site.system,
      site.slot,
      now,
      base.foundByPlayerId,
      ALIEN_SPLIT_CHILD_LEVEL,
      base.coalitionId,
    );
    // Children skip buildup — already "active" lineage.
    child.buildupEndsAt = now;
    child.nextRaidAt = rollNextRaidAt(child.id, now, ALIEN_RAID_PERIOD_MS);
    universe.alienBases![child.id] = child;
  }
}

function growPirateBase(
  universe: UniverseState,
  base: PirateBase,
  now: number,
): void {
  if (base.destroyedAt != null) return;
  while (
    base.level < PIRATE_MAX_LEVEL &&
    now - base.lastGrewAt >= PIRATE_LEVEL_GROWTH_INTERVAL_MS
  ) {
    if (!consumeTickBudget("levelUps")) return;
    base.level += 1;
    base.tier = base.level;
    base.lastGrewAt += PIRATE_LEVEL_GROWTH_INTERVAL_MS;
    base.techs = pirateTechsForLevel(base.level);
    base.defenses = addDefenses(
      base.defenses,
      npcDefensesForLevelGrant(base.level, false),
    );
    base.ships = mergeHangarAtLeast(base.ships, pirateShipsForTier(base.level));
    const stock = pirateResourcesForTier(base.level);
    base.resources = {
      metal: Math.max(base.resources.metal, stock.metal),
      crystal: Math.max(base.resources.crystal, stock.crystal),
      deuterium: Math.max(base.resources.deuterium, stock.deuterium),
    };
    tryPirateSplit(universe, base, now);
  }
  if (
    base.level >= PIRATE_MAX_LEVEL &&
    now - base.lastGrewAt >= PIRATE_LEVEL_GROWTH_INTERVAL_MS
  ) {
    base.lastGrewAt = now;
  }
}

function growAlienBase(
  universe: UniverseState,
  base: AlienBase,
  now: number,
): void {
  if (base.destroyedAt != null) return;
  base.techs = alienTechsFromUniverse(universe);
  while (
    base.level < ALIEN_MAX_LEVEL &&
    now - base.lastGrewAt >= PIRATE_LEVEL_GROWTH_INTERVAL_MS
  ) {
    if (!consumeTickBudget("levelUps")) return;
    base.level += 1;
    base.tier = base.level;
    base.lastGrewAt += PIRATE_LEVEL_GROWTH_INTERVAL_MS;
    base.defenses = addDefenses(
      base.defenses,
      npcDefensesForLevelGrant(base.level, true),
    );
    base.ships = mergeHangarAtLeast(base.ships, alienShipsForTier(base.level));
    const stock = pirateResourcesForTier(base.level);
    base.resources = {
      metal: Math.max(base.resources.metal, stock.metal),
      crystal: Math.max(base.resources.crystal, stock.crystal),
      deuterium: Math.max(base.resources.deuterium, stock.deuterium),
    };
    tryAlienSplit(universe, base, now);
  }
  if (
    base.level >= ALIEN_MAX_LEVEL &&
    now - base.lastGrewAt >= PIRATE_LEVEL_GROWTH_INTERVAL_MS
  ) {
    base.lastGrewAt = now;
  }
}

function markPirateDestroyed(base: PirateBase, now: number): void {
  base.destroyedAt = now;
  base.ships = emptyFleetShips();
  base.defenses = emptyDefenses();
  base.resources = emptyCargo();
}

function finishSeasonalPirateBoss(
  universe: UniverseState,
  base: PirateBase,
  now: number,
): void {
  if (!base.seasonalBoss || universe.pirateBossBaseId !== base.id) return;
  payBossParticipation(universe, base.id, now);
  universe.pirateBossBaseId = undefined;
  universe.pirateBossActiveUntil = undefined;
  universe.pirateBossNextSpawnAt = now + PIRATE_BOSS_COOLDOWN_MS;
}

function tickSeasonalPirateBoss(
  universe: UniverseState,
  now: number,
  allowSpawn: boolean,
): void {
  const bossId = universe.pirateBossBaseId;
  const savedBoss = bossId ? universe.pirateBases?.[bossId] : undefined;
  const activeBoss =
    savedBoss?.seasonalBoss && savedBoss.destroyedAt == null
      ? savedBoss
      : Object.values(universe.pirateBases ?? {}).find(
          (base) => base.seasonalBoss && base.destroyedAt == null,
        );
  if (activeBoss) {
    const alreadyTracked = universe.pirateBossBaseId === activeBoss.id;
    universe.pirateBossBaseId = activeBoss.id;
    const activeUntil = alreadyTracked
      ? universe.pirateBossActiveUntil ??
        activeBoss.lastGrewAt + PIRATE_BOSS_DURATION_MS
      : activeBoss.lastGrewAt + PIRATE_BOSS_DURATION_MS;
    universe.pirateBossActiveUntil = activeUntil;
    if (now < activeUntil) return;
    markPirateDestroyed(activeBoss, activeUntil);
    finishSeasonalPirateBoss(universe, activeBoss, activeUntil);
    return;
  }

  if (bossId) {
    universe.pirateBossBaseId = undefined;
    universe.pirateBossActiveUntil = undefined;
    universe.pirateBossNextSpawnAt = Math.max(
      universe.pirateBossNextSpawnAt ?? 0,
      (savedBoss?.destroyedAt ?? now) + PIRATE_BOSS_COOLDOWN_MS,
    );
  }
  if (!allowSpawn || now < (universe.pirateBossNextSpawnAt ?? 0)) return;

  const seed = universe.seed ?? universe.id;
  const origin = {
    galaxy: 1 + (hashSeed(`${seed}:pirate-boss-origin:galaxy`) % MAP_GALAXIES),
    system: 1 + (hashSeed(`${seed}:pirate-boss-origin:system`) % MAP_SYSTEMS),
    slot: 1,
  };
  const site = findNearbyEmptySlots(
    universe,
    origin,
    1,
    `${seed}:pirate-boss:${now}`,
    5,
  )[0];
  if (!site) return;

  const id = pirateBaseId(site.galaxy, site.system, site.slot);
  if (universe.pirateBases?.[id]) return;
  // Boss spawn is the one path that may pass the living cap, by one base.
  // The post-spawn cull in tickPirates removes one ordinary base afterward.
  const boss = createPirateBase(
    seed,
    site.galaxy,
    site.system,
    site.slot,
    now,
    PIRATE_BOSS_TIER,
  );
  boss.name = "Seasonal Pirate Mothership";
  boss.seasonalBoss = true;
  // Boss hangar stays on the unscaled template. PIRATE_STRENGTH_MULT is ordinary pirates only.
  boss.ships = pirateShipTemplate(PIRATE_BOSS_TIER);
  boss.ships.swarmMothership = PIRATE_BOSS_MOTHERSHIPS;
  boss.bossShipsAtSpawn = fleetShipCount(boss.ships);
  boss.resources = {
    metal: boss.resources.metal * PIRATE_BOSS_RESOURCE_REWARD_MULT,
    crystal: boss.resources.crystal * PIRATE_BOSS_RESOURCE_REWARD_MULT,
    deuterium: boss.resources.deuterium * PIRATE_BOSS_RESOURCE_REWARD_MULT,
  };
  ensurePirateBaseShape(boss, now);
  universe.pirateBases ??= {};
  universe.pirateBases[boss.id] = boss;
  boss.nextRaidAt = Number.MAX_SAFE_INTEGER;
  universe.pirateBossBaseId = boss.id;
  universe.pirateBossActiveUntil = now + PIRATE_BOSS_DURATION_MS;
  universe.pirateBossNextSpawnAt = 0;
}

function markAlienDestroyed(base: AlienBase, now: number): void {
  base.destroyedAt = now;
  base.ships = emptyFleetShips();
  base.defenses = emptyDefenses();
  base.resources = emptyCargo();
}

function findRespawnSite(
  universe: UniverseState,
  seedKey: string,
): Coordinates | null {
  const startG = 1 + (hashSeed(`${seedKey}:g`) % MAP_GALAXIES);
  const startS = 1 + (hashSeed(`${seedKey}:s`) % MAP_SYSTEMS);
  const counts = nonBossCountByGalaxy(universe);
  for (let dg = 0; dg < MAP_GALAXIES; dg++) {
    const galaxy = ((startG - 1 + dg) % MAP_GALAXIES) + 1;
    if ((counts[galaxy] ?? 0) >= PIRATE_BASES_PER_GALAXY) continue;
    for (let ds = 0; ds < MAP_SYSTEMS; ds++) {
      const system = ((startS - 1 + ds) % MAP_SYSTEMS) + 1;
      if (systemOccupiedByNpc(universe, galaxy, system)) continue;
      const slot = pickEmptySlot(
        universe,
        galaxy,
        system,
        `${seedKey}:slot:${galaxy}:${system}`,
      );
      if (slot != null) return { galaxy, system, slot };
    }
  }
  return null;
}

function respawnDestroyedPirates(universe: UniverseState, now: number): void {
  if (universe.skipPirateTopUp) return;
  const seed = universe.seed ?? universe.id;
  const bases = universe.pirateBases ?? {};
  let living = activePirateBases(universe).length;
  if (living >= PIRATE_TARGET_BASE_COUNT) return;
  for (const id of Object.keys(bases)) {
    if (living >= PIRATE_TARGET_BASE_COUNT) return;
    const base = bases[id]!;
    if (base.seasonalBoss) continue;
    if (base.destroyedAt == null) continue;
    if (now < pirateRespawnAt(base.destroyedAt, base.id)) continue;
    const site = findRespawnSite(universe, `${seed}:respawn:${base.id}:${now}`);
    // A wreck stays until its replacement is actually placed.
    if (!site) continue;
    delete bases[id];
    const next = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      0,
    );
    bases[next.id] = next;
    living += 1;
  }
}

function planetDefensePower(planet: PlanetState, universe: UniverseState): number {
  const owner = universe.players[planet.ownerPlayerId];
  return (
    fleetCombatPower(planet.ships, owner?.research) +
    defenseCombatPower(planet.defenses ?? emptyDefenses(), owner?.research)
  );
}

export function isRelicWorldPlanet(planet: PlanetState): boolean {
  const flags = planet.flags as { mini?: boolean; miniKind?: string } | undefined;
  return Boolean(flags?.mini && flags.miniKind === "relic");
}

/**
 * Rolling 2-hour pirate attack fatigue multiplier.
 * 0-4 hits = x1, 5-7 hits = x0.5, 8+ hits = x0.25 (0.5 * 0.5).
 */
export function pirateFatigueMult(planet: PlanetState, now: number): number {
  if (!planet.pirateHitHistory || planet.pirateHitHistory.length === 0) {
    return 1;
  }
  const cutoff = now - PIRATE_FATIGUE_WINDOW_MS;
  let hits = 0;
  for (const ts of planet.pirateHitHistory) {
    if (ts >= cutoff) {
      hits++;
    }
  }
  if (hits >= PIRATE_FATIGUE_FIRST_HITS + PIRATE_FATIGUE_EXTRA_HITS) {
    return PIRATE_FATIGUE_MULT * PIRATE_FATIGUE_MULT;
  }
  if (hits >= PIRATE_FATIGUE_FIRST_HITS) {
    return PIRATE_FATIGUE_MULT;
  }
  return 1;
}

/**
 * Record a pirate raid hit timestamp on a planet and prune entries older than 2h.
 */
export function recordPirateHit(planet: PlanetState, now: number): void {
  const cutoff = now - PIRATE_FATIGUE_WINDOW_MS;
  const history = (planet.pirateHitHistory ?? []).filter((ts) => ts >= cutoff);
  history.push(now);
  planet.pirateHitHistory = history;
}

function pruneRecentRaidTargets(
  base: PirateBase | AlienBase,
  now: number,
): Record<string, number> | undefined {
  const raw = base.recentRaidTargets;
  if (!raw) return undefined;
  const cutoff = now - PIRATE_SAME_TARGET_COOLDOWN_MS;
  const next: Record<string, number> = {};
  for (const [key, at] of Object.entries(raw)) {
    if (typeof at === "number" && Number.isFinite(at) && at > cutoff) next[key] = at;
  }
  if (Object.keys(next).length === 0) {
    delete base.recentRaidTargets;
    return undefined;
  }
  base.recentRaidTargets = next;
  return next;
}

function targetOnCooldown(
  base: PirateBase | AlienBase,
  targetId: string,
  now: number,
): boolean {
  const recent = pruneRecentRaidTargets(base, now);
  if (!recent) return false;
  const at = recent[targetId];
  return at != null && now - at < PIRATE_SAME_TARGET_COOLDOWN_MS;
}

function rememberRaidTarget(
  base: PirateBase | AlienBase,
  targetId: string,
  now: number,
): void {
  const recent = pruneRecentRaidTargets(base, now) ?? {};
  recent[targetId] = now;
  base.recentRaidTargets = recent;
}

/**
 * Pirate player-planet distance factor.
 * `1 / (1 + (d / PIRATE_RAID_DISTANCE_REF)^2)` with ref 400.
 * Never zero. Aliens do not use it.
 */
export function pirateRaidDistanceWeight(distance: number): number {
  const ratio = distance / PIRATE_RAID_DISTANCE_REF;
  return 1 / (1 + ratio * ratio);
}

function pirateDistanceFactor(
  faction: "pirate" | "alien",
  attacker: PirateBase | AlienBase | undefined,
  planet: PlanetState,
): number {
  if (faction !== "pirate" || !attacker) return 1;
  return pirateRaidDistanceWeight(coordDistance(attacker.coords, planet.coords));
}

/**
 * Pre-deterrence pirate planet weight: relic × fairness × fatigue × distance.
 * Cooldown and a missing owner are 0. Distance never zeroes this on its own.
 */
export function piratePlanetPickWeight(
  universe: UniverseState,
  planet: PlanetState,
  now: number,
  attacker: PirateBase,
): number {
  if (targetOnCooldown(attacker, planet.id, now)) return 0;
  const owner = universe.players[planet.ownerPlayerId];
  if (!owner) return 0;
  return (
    planetRaidWeight(planet) *
    pirateRaidPickWeight(universe, owner, now) *
    pirateFatigueMult(planet, now) *
    pirateDistanceFactor("pirate", attacker, planet)
  );
}

/**
 * Pirate raids multiply relic weight by fairness (newbies weigh 0), fatigue, and
 * distance, then subtract deterrence. Alien raids keep relic weight and subtract
 * deterrence — fairness, fatigue, and distance do not apply.
 * A target this base raided inside the cooldown weighs 0.
 */
function npcPlanetPickWeight(
  universe: UniverseState,
  planet: PlanetState,
  now: number,
  faction: "pirate" | "alien",
  attacker?: PirateBase | AlienBase,
): number {
  if (attacker && targetOnCooldown(attacker, planet.id, now)) return 0;
  const relic = planetRaidWeight(planet);
  if (faction !== "pirate") return planetRaidDeterrence(planet, faction, relic);
  if (!attacker || isAlienBase(attacker)) return 0;
  const baseWeight = piratePlanetPickWeight(universe, planet, now, attacker);
  if (baseWeight <= 0) return 0;
  return planetRaidDeterrence(planet, faction, baseWeight);
}

function planetPickBaseWeight(
  universe: UniverseState,
  planet: PlanetState,
  now: number,
  faction: "pirate" | "alien",
  attacker?: PirateBase | AlienBase,
): number {
  if (attacker && targetOnCooldown(attacker, planet.id, now)) return 0;
  const relic = planetRaidWeight(planet);
  if (faction !== "pirate") return relic;
  if (!attacker || isAlienBase(attacker)) return 0;
  return piratePlanetPickWeight(universe, planet, now, attacker);
}

function pickWeightedPlayerPlanet(
  universe: UniverseState,
  planets: PlanetState[],
  roll: number,
  now: number,
  faction: "pirate" | "alien",
  attacker?: PirateBase | AlienBase,
): PlanetState | null {
  const baseWeights = planets.map((p) =>
    planetPickBaseWeight(universe, p, now, faction, attacker),
  );
  let baseTotal = 0;
  for (const w of baseWeights) baseTotal += w;
  if (baseTotal <= 0) return null;

  let slot = ((roll % 1_000_000) / 1_000_000) * baseTotal;
  for (let i = 0; i < planets.length; i++) {
    const baseW = baseWeights[i]!;
    if (baseW <= 0) continue;
    if (slot < baseW) {
      const effectiveW = planetRaidDeterrence(planets[i]!, faction, baseW);
      if (slot < effectiveW) {
        return planets[i]!;
      }
      return null;
    }
    slot -= baseW;
  }
  return null;
}

export function planetRaidWeight(planet: PlanetState): number {
  return isRelicWorldPlanet(planet) ? MINI_RELIC_PIRATE_WEIGHT : 1;
}

type NpcRaidTarget =
  | { kind: "planet"; planet: PlanetState }
  | { kind: "pirate"; other: PirateBase }
  | { kind: "alien"; other: AlienBase };

/**
 * Prefer players; NPC-vs-NPC slightly less often (period mult / skip).
 * Same coalitionId never targeted.
 */
export function pickRaidTarget(
  universe: UniverseState,
  base: PirateBase | AlienBase,
  now: number,
  faction: "pirate" | "alien",
): NpcRaidTarget | null {
  const roll = hashSeed(`${base.id}:target:${base.lastRaidAt}:${now}`);
  const planets = Object.values(universe.planets).filter(
    (p) => p.kind !== "moon" && !targetOnCooldown(base, p.id, now),
  );
  const vsMult =
    faction === "pirate"
      ? PIRATE_VS_PIRATE_RAID_PERIOD_MULT
      : ALIEN_VS_ALIEN_RAID_PERIOD_MULT;
  // Most rolls prefer a player. Building the NPC list walks every base, so
  // only do that when the roll actually wants an NPC or no player is eligible.
  if (planets.length > 0 && roll % 1000 < Math.floor(1000 / vsMult)) {
    const planet = pickWeightedPlayerPlanet(universe, planets, roll, now, faction, base);
    if (planet) return { kind: "planet", planet };
  }
  const pirateOthers = activePirateBases(universe).filter(
    (b) =>
      !b.seasonalBoss &&
      b.id !== base.id &&
      b.coalitionId !== base.coalitionId &&
      !targetOnCooldown(base, b.id, now),
  );
  const alienOthers = activeAlienBases(universe).filter(
    (b) =>
      b.id !== base.id &&
      b.coalitionId !== base.coalitionId &&
      !targetOnCooldown(base, b.id, now),
  );
  const npcPool: NpcRaidTarget[] = [
    ...pirateOthers.map((other) => ({ kind: "pirate" as const, other })),
    ...alienOthers.map((other) => ({ kind: "alien" as const, other })),
  ];
  if (npcPool.length === 0) {
    if (!planets.length) return null;
    const planet = pickWeightedPlayerPlanet(universe, planets, roll, now, faction, base);
    return planet ? { kind: "planet", planet } : null;
  }
  return npcPool[roll % npcPool.length]!;
}

function battleDebris(
  atkBefore: FleetShips,
  atkAfter: FleetShips,
  defBefore: FleetShips,
  defAfter: FleetShips,
  permanentlyLost: Partial<Record<DefenseId, number>>,
): Resources {
  const atk = debrisFromDestroyed(destroyedShipResources(atkBefore, atkAfter));
  const def = debrisFromDestroyed(destroyedShipResources(defBefore, defAfter));
  const guns = debrisFromDestroyedDefenses(permanentlyLost);
  return {
    metal: atk.metal + def.metal + guns.metal,
    crystal: atk.crystal + def.crystal + guns.crystal,
    deuterium: 0,
  };
}

function isAlienBase(base: PirateBase | AlienBase): base is AlienBase {
  return "foundByPlayerId" in base;
}

/**
 * Pirate hangar after the sent detachment fights.
 * Any outcome other than attacker_win removes the full sent detachment.
 * Survivors are not put back. On attacker_win, only destroyed sent hulls
 * leave (sent minus survived), with no 50% floor on the rest of the hangar.
 * B7-98 flight-time fleets must keep the same loss semantics: no return leg on a loss.
 */
function settlePirateHangarAfterRaid(
  hangar: FleetShips,
  sentFleet: FleetShips,
  survivedFleet: FleetShips,
  outcome: string,
): FleetShips {
  const out = normalizeFleetShips(hangar);
  const loseAllSent = outcome !== "attacker_win";
  for (const id of SHIP_ORDER) {
    const sent = sentFleet[id] ?? 0;
    const survived = survivedFleet[id] ?? 0;
    const remove = loseAllSent ? sent : Math.max(0, sent - survived);
    out[id] = Math.max(0, (out[id] ?? 0) - remove);
  }
  return out;
}

function settleAlienHangarAfterRaid(
  hangar: FleetShips,
  sent: number,
  survived: number,
): FleetShips {
  if (sent <= 0) return hangar;
  return scaleShips(hangar, Math.min(1, 0.5 + (survived / sent) * 0.5));
}

const NPC_PIRATE_OWNER_ID = "npc_pirates";

interface NpcPlanetFight {
  outcome: string;
  attackerAfter: FleetShips;
  loot: Resources;
  reportId: string;
}

/**
 * Planet combat, debris, report, and defender rewards shared by the instant
 * path and a pirate fleet arrival. Hangar settlement stays with the caller.
 * Loot is removed from the planet either way. `creditLootToBase` adds it to
 * the base immediately (instant raids). Flight wins carry it home instead.
 */
function fightNpcRaidOnPlanet(
  universe: UniverseState,
  base: PirateBase | AlienBase,
  planet: PlanetState,
  now: number,
  faction: "pirate" | "alien",
  raidFleet: FleetShips,
  creditLootToBase: boolean,
): NpcPlanetFight | null {
  const owner = universe.players[planet.ownerPlayerId];
  if (!owner) return null;
  if (faction === "pirate") recordPirateHit(planet, now);
  const defenderResearch = effectiveCombatResearch(owner);
  const npcResearch = faction === "pirate"
    ? pirateCombatResearchForOpponent(defenderResearch)
    : alienCombatResearchForOpponent(defenderResearch);
  const defenderBefore = { ...planet.ships };
  const defensesBefore = planet.defenses ?? emptyDefenses();
  const combat = resolveCombat(
    raidFleet,
    defenderBefore,
    defensesBefore,
    npcResearch,
    defenderResearch,
    {
      defenderUnitStatMult: isNewbieBonusActive(universe, owner, now)
        ? NEWBIE_DEFENSE_MULT
        : 1,
    },
  );
  const rebuilt = rebuildDefenses(
    defensesBefore,
    combat.defensesAfter,
    defenseRebuildRate(owner.playerClass?.classId),
  );
  planet.ships = combat.defenderAfter;
  planet.defenses = rebuilt.defensesAfter;
  const debrisCreated = battleDebris(
    raidFleet,
    combat.attackerAfter,
    defenderBefore,
    combat.defenderAfter,
    rebuilt.defensesPermanentlyLost,
  );
  addDebris(universe, planet.coords, debrisCreated);
  let moonFormed = false;
  if (planet.kind !== "moon" && planet.coords.slot !== 16) {
    const moon = tryFormMoon(
      universe,
      planet,
      debrisCreated,
      `${base.id}:npc-raid:${now}`,
      now,
    );
    moonFormed = Boolean(moon);
  }
  if (!universe.reports) universe.reports = {};
  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const npcId = faction === "pirate" ? NPC_PIRATE_OWNER_ID : "npc_aliens";
  recordCombatReport(universe, {
    id: reportId,
    at: now,
    missionId: base.id,
    attackerPlayerId: npcId,
    defenderPlayerId: owner.id,
    attackerName: base.name,
    defenderName: owner.name,
    targetCoords: { ...planet.coords },
    attackerBefore: { ...raidFleet },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore,
    defensesAfter: rebuilt.defensesAfter,
    defensesDestroyed: rebuilt.defensesDestroyed,
    defensesRebuilt: rebuilt.defensesRebuilt,
    defensesPermanentlyLost: rebuilt.defensesPermanentlyLost,
    loot: emptyCargo(),
    debrisCreated,
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary: moonFormed
      ? `${combat.summary} A moon coalesced from the debris field.`
      : combat.summary,
    moonFormed,
    roundLog: combat.roundLog.length ? combat.roundLog : undefined,
  });
  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(planet.resources, combat.attackerAfter);
    subtractCargo(planet, loot);
    universe.reports[reportId]!.loot = loot;
    if (creditLootToBase) {
      base.resources = {
        metal: base.resources.metal + loot.metal,
        crystal: base.resources.crystal + loot.crystal,
        deuterium: base.resources.deuterium + loot.deuterium,
      };
    }
    grantPlayerXp(owner, xpForCombatLose());
  } else if (combat.outcome === "defender_win") {
    awardSeasonPveWin(universe, owner, now);
    grantPirateFleetKillStarshards(
      owner,
      faction,
      `${base.id}:kill_shards:${now}`,
    );
    if (faction === "pirate") noteGoalMetric(owner, "pirateWin", 1, now);
    const killed = resourcesCostTotal(
      destroyedShipResources(raidFleet, combat.attackerAfter),
    );
    grantPlayerXp(owner, xpForCombatWin(killed) + xpForPirateShipKills(killed));
  } else {
    grantPlayerXp(owner, xpForCombatLose());
  }
  // Successful pirate raid for fairness (#18) — aliens exempt; fires when raid lands.
  if (faction === "pirate") recordSuccessfulPirateRaid(owner, now);
  universe.players[owner.id] = owner;
  return {
    outcome: combat.outcome,
    attackerAfter: combat.attackerAfter,
    loot,
    reportId,
  };
}

export function applyNpcRaidOnPlanet(
  universe: UniverseState,
  base: PirateBase | AlienBase,
  planet: PlanetState,
  now: number,
  faction: "pirate" | "alien",
  markDestroyed: (b: PirateBase | AlienBase, n: number) => void,
): void {
  syncPlanetForTick(universe, planet.id, now);
  const live = universe.planets[planet.id] ?? planet;
  planet = live;
  const owner = universe.players[planet.ownerPlayerId];
  if (!owner) return;
  const raidFleet =
    faction === "pirate"
      ? scalePirateRaidFleet(
          base.ships,
          planetDefensePower(planet, universe),
          planet.ships,
          pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, base.level),
        )
      : scaleAlienRaidFleet(
          base.ships,
          planetDefensePower(planet, universe),
          `${base.id}:alien-raid:${now}`,
        );
  if (fleetShipCount(raidFleet) < 1) return;
  // Instant path (aliens, and direct callers). Pirate player fleets stamp cooldown at launch.
  rememberRaidTarget(base, planet.id, now);
  const fought = fightNpcRaidOnPlanet(
    universe,
    base,
    planet,
    now,
    faction,
    raidFleet,
    true,
  );
  if (!fought) return;
  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(fought.attackerAfter);
  if (faction === "pirate") {
    base.ships = settlePirateHangarAfterRaid(
      base.ships,
      raidFleet,
      fought.attackerAfter,
      fought.outcome,
    );
  } else {
    base.ships = settleAlienHangarAfterRaid(base.ships, sent, survived);
  }
  if (fleetShipCount(base.ships) <= 0 && defenseCount(base.defenses) <= 0) {
    markDestroyed(base, now);
  }
}

function piratePlayerRaidFleet(
  base: PirateBase,
  planet: PlanetState,
  universe: UniverseState,
): FleetShips {
  return scalePirateRaidFleet(
    base.ships,
    planetDefensePower(planet, universe),
    planet.ships,
    pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, base.level),
  );
}

/** Pirate → player raids leave the hangar immediately and fly at player cruise formulas with techs 0. */
function launchPiratePlanetRaid(
  universe: UniverseState,
  base: PirateBase,
  planet: PlanetState,
  now: number,
): void {
  syncPlanetForTick(universe, planet.id, now);
  const live = universe.planets[planet.id] ?? planet;
  const owner = universe.players[live.ownerPlayerId];
  if (!owner) return;
  const raidFleet = piratePlayerRaidFleet(base, live, universe);
  if (fleetShipCount(raidFleet) < 1) return;
  rememberRaidTarget(base, live.id, now);
  base.ships = subtractShips(base.ships, raidFleet);
  const seconds = flightSecondsOneWay(
    base.coords,
    live.coords,
    raidFleet,
    universe.fleetSpeed,
    0,
    null,
    0,
  );
  const fleetId = `flt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const fleet: FleetMission = {
    id: fleetId,
    ownerPlayerId: NPC_PIRATE_OWNER_ID,
    originPlanetId: base.id,
    originPirateBaseId: base.id,
    targetPlanetId: live.id,
    targetPlayerId: owner.id,
    targetCoords: { ...live.coords },
    mission: "raid",
    ships: { ...raidFleet },
    cargo: emptyCargo(),
    departedAt: now,
    arrivesAt: now + seconds * 1000,
    phase: "outbound",
    reportId: null,
  };
  universe.fleets ??= {};
  universe.fleets[fleetId] = fleet;
}

function creditPirateHome(base: PirateBase, fleet: FleetMission): void {
  base.ships = addShips(base.ships, fleet.ships);
  base.resources = {
    metal: base.resources.metal + (fleet.cargo.metal ?? 0),
    crystal: base.resources.crystal + (fleet.cargo.crystal ?? 0),
    deuterium: base.resources.deuterium + (fleet.cargo.deuterium ?? 0),
  };
}

/**
 * Due NPC pirate fleet. Called from resolveFleetArrival before the missing-origin
 * delete. Outbound arrival fights once. A win flies survivors and loot home.
 * Any other outcome drops the fleet; sent ships stay out of the hangar.
 */
export function resolveNpcPiratePlayerFleet(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  const live = universe.fleets[fleet.id];
  if (!live || live.arrivesAt > now) return;
  const baseId = live.originPirateBaseId ?? live.originPlanetId;
  const base = baseId ? universe.pirateBases?.[baseId] : undefined;
  if (live.phase === "returning") {
    if (base && base.destroyedAt == null) creditPirateHome(base, live);
    delete universe.fleets[live.id];
    return;
  }
  if (live.phase !== "outbound") {
    delete universe.fleets[live.id];
    return;
  }
  const planet = live.targetPlanetId ? universe.planets[live.targetPlanetId] : undefined;
  if (!base || base.destroyedAt != null || !planet) {
    delete universe.fleets[live.id];
    return;
  }
  const fought = fightNpcRaidOnPlanet(
    universe,
    base,
    planet,
    now,
    "pirate",
    live.ships,
    false,
  );
  if (!fought || fought.outcome !== "attacker_win" || fleetShipCount(fought.attackerAfter) < 1) {
    delete universe.fleets[live.id];
    if (
      base.destroyedAt == null &&
      fleetShipCount(base.ships) <= 0 &&
      defenseCount(base.defenses) <= 0
    ) {
      markPirateDestroyed(base, now);
    }
    return;
  }
  live.ships = normalizeFleetShips(fought.attackerAfter);
  live.cargo = fought.loot;
  live.reportId = fought.reportId;
  live.phase = "returning";
  live.departedAt = now;
  const seconds = flightSecondsOneWay(
    planet.coords,
    base.coords,
    live.ships,
    universe.fleetSpeed,
    0,
    null,
    0,
  );
  live.arrivesAt = now + seconds * 1000;
  universe.fleets[live.id] = live;
}

export function applyNpcRaidOnNpc(
  universe: UniverseState,
  base: PirateBase | AlienBase,
  other: PirateBase | AlienBase,
  now: number,
  markBase: (b: PirateBase | AlienBase, n: number) => void,
  markOther: (b: PirateBase | AlienBase, n: number) => void,
): void {
  const otherPower =
    fleetCombatPower(other.ships, pirateCombatResearch(other)) +
    defenseCombatPower(
      other.defenses ?? emptyDefenses(),
      pirateCombatResearch(other),
    );
  const pirateAttacker = !isAlienBase(base);
  const raidFleet = pirateAttacker
    ? scalePirateRaidFleet(
        base.ships,
        otherPower,
        undefined,
        pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR, base.level),
      )
    : scalePirateRaidFleet(base.ships, otherPower);
  if (fleetShipCount(raidFleet) < 1) return;
  // NPC-vs-NPC stays instant. Pirate player raids stamp cooldown when the fleet launches.
  rememberRaidTarget(base, other.id, now);
  const defenderBefore = { ...other.ships };
  const defensesBefore = other.defenses ?? emptyDefenses();
  const combat = resolveCombat(
    raidFleet,
    defenderBefore,
    defensesBefore,
    pirateCombatResearch(base),
    pirateCombatResearch(other),
  );
  const rebuilt = rebuildDefenses(
    defensesBefore,
    combat.defensesAfter,
    defenseRebuildRate(null),
  );
  other.ships = combat.defenderAfter;
  other.defenses = rebuilt.defensesAfter;
  const debrisCreated = battleDebris(
    raidFleet,
    combat.attackerAfter,
    defenderBefore,
    combat.defenderAfter,
    rebuilt.defensesPermanentlyLost,
  );
  addDebris(universe, other.coords, debrisCreated);
  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(combat.attackerAfter);
  if (pirateAttacker) {
    base.ships = settlePirateHangarAfterRaid(
      base.ships,
      raidFleet,
      combat.attackerAfter,
      combat.outcome,
    );
  } else {
    base.ships = settleAlienHangarAfterRaid(base.ships, sent, survived);
  }
  if (combat.outcome === "attacker_win") {
    const loot = computeRaidLoot(other.resources, combat.attackerAfter);
    other.resources = {
      metal: Math.max(0, other.resources.metal - loot.metal),
      crystal: Math.max(0, other.resources.crystal - loot.crystal),
      deuterium: Math.max(0, other.resources.deuterium - loot.deuterium),
    };
    base.resources = {
      metal: base.resources.metal + loot.metal,
      crystal: base.resources.crystal + loot.crystal,
      deuterium: base.resources.deuterium + loot.deuterium,
    };
  }
  if (fleetShipCount(other.ships) <= 0 && defenseCount(other.defenses) <= 0) {
    markOther(other, now);
  }
  if (fleetShipCount(base.ships) <= 0 && defenseCount(base.defenses) <= 0) {
    markBase(base, now);
  }
}

function fireRaid(
  universe: UniverseState,
  base: PirateBase | AlienBase,
  now: number,
  faction: "pirate" | "alien",
): void {
  const target = pickRaidTarget(universe, base, now, faction);
  base.lastRaidAt = now;
  if (!target) return;
  const markP = (b: PirateBase | AlienBase, n: number) =>
    markPirateDestroyed(b as PirateBase, n);
  const markA = (b: PirateBase | AlienBase, n: number) =>
    markAlienDestroyed(b as AlienBase, n);
  if (target.kind === "planet") {
    if (faction === "pirate" && !isAlienBase(base)) {
      launchPiratePlanetRaid(universe, base, target.planet, now);
    } else {
      applyNpcRaidOnPlanet(
        universe,
        base,
        target.planet,
        now,
        faction,
        faction === "pirate" ? markP : markA,
      );
    }
  } else if (target.kind === "pirate") {
    applyNpcRaidOnNpc(
      universe,
      base,
      target.other,
      now,
      faction === "pirate" ? markP : markA,
      markP,
    );
  } else {
    applyNpcRaidOnNpc(
      universe,
      base,
      target.other,
      now,
      faction === "pirate" ? markP : markA,
      markA,
    );
  }
}

/**
 * CI / local Playwright sets STARHOLD_E2E=1 so pirate raids
 * do not strip the lone smoke player's metal before the shipyard e2e bank.
 * Schedule still advances so catch-up does not storm when the flag clears.
 */
function npcCombatEnabled(): boolean {
  return process.env.STARHOLD_E2E !== "1";
}

/** `true` when the global per-request raid budget stopped this base early. */
function catchUpRaidsPirate(universe: UniverseState, base: PirateBase, now: number): boolean {
  let fired = 0;
  while (base.destroyedAt == null && base.nextRaidAt <= now && fired < NPC_RAID_CATCHUP_MAX) {
    if (!consumeTickBudget("raids")) return true;
    const at = base.nextRaidAt;
    if (npcCombatEnabled()) {
      fireRaid(universe, base, at, "pirate");
    }
    base.nextRaidAt = rollNextRaidAt(base.id, at, PIRATE_RAID_PERIOD_MS);
    fired += 1;
  }
  return false;
}

function catchUpRaidsAlien(universe: UniverseState, base: AlienBase, now: number): boolean {
  if (now < base.buildupEndsAt) return false;
  let fired = 0;
  while (base.destroyedAt == null && base.nextRaidAt <= now && fired < NPC_RAID_CATCHUP_MAX) {
    const at = Math.max(base.nextRaidAt, base.buildupEndsAt);
    if (at > now) break;
    if (!consumeTickBudget("raids")) return true;
    if (npcCombatEnabled()) {
      fireRaid(universe, base, at, "alien");
    }
    base.nextRaidAt = rollNextRaidAt(base.id, at, ALIEN_RAID_PERIOD_MS);
    fired += 1;
  }
  return false;
}

/**
 * Lazy AI catch-up: one in-memory pass over pirate and alien bases.
 * Pirates raid every 90 minutes. Aliens raid every hour. Page loads set
 * skipNpcRaids so raids wait for the npc job, but top-up and respawn still run
 * when occupancy was loaded.
 */
export function tickPirates(universe: UniverseState, now: number): void {
  const phase: "both" | "grow" | "raid" =
    tickBudget() == null
      ? "both"
      : Math.floor(now / NPC_AI_SLICE_INTERVAL_MS) % 2 === 0
        ? "grow"
        : "raid";
  if (!universe.pirateBases) universe.pirateBases = {};
  if (!universe.alienBases) universe.alienBases = {};
  cullExcessPirateBases(universe, now);
  tickSeasonalPirateBoss(universe, now, false);
  // Page loads skip raids, but a destroyed base still has to come back and a
  // short universe still has to fill to the living cap when this request loaded occupancy.
  if (universe.skipNpcRaids) {
    ensureAlienDailySeed(universe, now);
    if (!universe.skipPirateTopUp) {
      respawnDestroyedPirates(universe, now);
      ensurePiratePopulation(universe, now);
      tickSeasonalPirateBoss(universe, now, true);
      cullExcessPirateBases(universe, now);
    }
    universe.lastAiSimAt = now;
    return;
  }
  const savedCursor =
    phase === "raid" ? universe.aiRaidCatchUpCursor : universe.aiCatchUpCursor;
  const separator = savedCursor?.indexOf(":") ?? -1;
  const savedAt = separator > 0 ? Number(savedCursor!.slice(0, separator)) : NaN;
  const targetAt = Number.isFinite(savedAt) ? savedAt : now;
  const nextId =
    separator > 0 && Number.isFinite(savedAt)
      ? savedCursor!.slice(separator + 1)
      : savedCursor;
  ensureAlienDailySeed(universe, targetAt);
  respawnDestroyedPirates(universe, targetAt);
  ensurePiratePopulation(universe, targetAt);
  tickSeasonalPirateBoss(universe, now, !universe.skipPirateTopUp);
  cullExcessPirateBases(universe, targetAt);
  const entries = [
    ...Object.values(universe.pirateBases).map((base) => ({
      id: base.id,
      faction: "pirate" as const,
      base,
    })),
    ...Object.values(universe.alienBases).map((base) => ({
      id: base.id,
      faction: "alien" as const,
      base,
    })),
  ];
  let startAt = nextId ? entries.findIndex((entry) => entry.id === nextId) : 0;
  if (startAt < 0) startAt = 0;

  const maxSteps = tickBudget() ? NPC_AI_BATCH_SIZE : entries.length;
  let processed = 0;
  let resumeId: string | null = null;
  for (let index = startAt; index < entries.length && processed < maxSteps; index++) {
    const entry = entries[index]!;
    if (entry.faction === "pirate") {
      const base = entry.base;
      ensurePirateBaseShape(base, targetAt);
      if (base.seasonalBoss) {
        base.nextRaidAt = Number.MAX_SAFE_INTEGER;
        processed += 1;
        continue;
      }
      // Level-up budget can run out mid-wave. Still spawn on a grow slice;
      // the next grow slice applies the missed levels at their own timestamps.
      if (phase !== "raid") {
        growPirateBase(universe, base, targetAt);
        applyFreeSpawnsPirate(base, targetAt);
      }
      if (phase !== "grow" && catchUpRaidsPirate(universe, base, targetAt)) {
        resumeId = entry.id;
        break;
      }
    } else {
      const base = entry.base;
      ensureAlienBaseShape(base, universe, targetAt);
      if (phase !== "raid") {
        growAlienBase(universe, base, targetAt);
        applyFreeSpawnsAlien(base, targetAt);
      }
      if (phase !== "grow" && catchUpRaidsAlien(universe, base, targetAt)) {
        resumeId = entry.id;
        break;
      }
    }
    processed += 1;
  }

  if (!resumeId) {
    const pending = entries.find((entry) => {
      const base = entry.base;
      if (base.destroyedAt != null) return false;
      if (entry.faction === "pirate" && entry.base.seasonalBoss) return false;
      if (phase !== "grow") {
        if (entry.faction === "alien") {
          if (targetAt >= entry.base.buildupEndsAt && base.nextRaidAt <= targetAt) return true;
        } else if (base.nextRaidAt <= targetAt) {
          return true;
        }
      }
      if (phase === "raid") return false;
      const maxLevel = entry.faction === "pirate" ? PIRATE_MAX_LEVEL : ALIEN_MAX_LEVEL;
      return (
        base.level < maxLevel &&
        targetAt - base.lastGrewAt >= PIRATE_LEVEL_GROWTH_INTERVAL_MS
      );
    });
    resumeId =
      pending?.id ??
      (phase !== "raid" && startAt + processed < entries.length
        ? entries[startAt + processed]!.id
        : null);
  }
  const cursor = resumeId ? `${targetAt}:${resumeId}` : null;
  if (phase === "raid") universe.aiRaidCatchUpCursor = cursor;
  else universe.aiCatchUpCursor = cursor;
  if (phase !== "grow") {
    respawnDestroyedPirates(universe, targetAt);
    if (phase === "raid") ensurePiratePopulation(universe, targetAt);
  }
  universe.lastAiSimAt = Math.max(universe.lastAiSimAt ?? 0, targetAt);
}

export function ensureAlienDailySeed(universe: UniverseState, now: number): void {
  const day = utcDayKey(now);
  if (universe.alienDailyFindDay !== day) {
    universe.alienDailyFindDay = day;
    universe.alienDailyFindSeed = hashSeed(
      `${universe.seed ?? universe.id}:alien-day:${day}`,
    );
    universe.alienFoundCountToday = 0;
  }
}

/**
 * Expedition alien find — 0.001% chance, daily seed window, settle slot-1.
 * Returns the new base or null.
 */
export function tryAlienExpeditionFind(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): AlienBase | null {
  ensureAlienDailySeed(universe, now);
  if (activeAlienBases(universe).length >= ALIEN_MAX_BASE_COUNT) return null;

  const day = universe.alienDailyFindDay ?? utcDayKey(now);
  const seed = universe.alienDailyFindSeed ?? 0;
  // Fine-grained roll using chance 0.00001
  const rollSpace = 100_000_000; // 1e8 → threshold = chance * 1e8
  const threshold = Math.max(1, Math.floor(ALIEN_EXPEDITION_FIND_CHANCE * rollSpace));
  const roll =
    hashSeed(`${fleet.id}:alien-find:${day}:${seed}:${fleet.arrivesAt}`) %
    rollSpace;
  if (roll >= threshold) return null;

  const originPlanet = universe.planets[fleet.originPlanetId];
  const origin = originPlanet?.coords ?? fleet.targetCoords;
  const site = findNearestOpenSlot1(
    universe,
    origin,
    `${universe.seed}:alien-settle:${fleet.id}`,
  );
  if (!site) return null;

  if (!universe.alienBases) universe.alienBases = {};
  const base = createAlienBase(
    universe,
    site.galaxy,
    site.system,
    site.slot,
    now,
    fleet.ownerPlayerId,
    0,
  );
  universe.alienBases[base.id] = base;
  universe.alienFoundCountToday = (universe.alienFoundCountToday ?? 0) + 1;
  return base;
}

function resolveNpcRaidArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
  kind: "pirate" | "alien",
): void {
  const base =
    kind === "pirate"
      ? fleet.targetPirateBaseId
        ? universe.pirateBases?.[fleet.targetPirateBaseId]
        : null
      : fleet.targetAlienBaseId
        ? universe.alienBases?.[fleet.targetAlienBaseId]
        : null;
  if (!base || base.destroyedAt != null) return;

  if (kind === "pirate") ensurePirateBaseShape(base as PirateBase, now);
  else ensureAlienBaseShape(base as AlienBase, universe, now);

  const owner = universe.players[fleet.ownerPlayerId];
  const defenderBefore = { ...base.ships };
  const defensesBefore = { ...base.defenses };
  const tierAtFight = base.tier;
  const attackerResearch = effectiveCombatResearch(owner);
  const defenderResearch = kind === "pirate"
    ? pirateCombatResearchForOpponent(attackerResearch)
    : alienCombatResearchForOpponent(attackerResearch);
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    defensesBefore,
    attackerResearch,
    defenderResearch,
  );
  const rebuilt = rebuildDefenses(
    defensesBefore,
    combat.defensesAfter,
    defenseRebuildRate(null),
  );
  base.ships = combat.defenderAfter;
  base.defenses = rebuilt.defensesAfter;
  let debrisCreated = battleDebris(
    fleet.ships,
    combat.attackerAfter,
    defenderBefore,
    combat.defenderAfter,
    rebuilt.defensesPermanentlyLost,
  );
  const killed = resourcesCostTotal(
    destroyedShipResources(defenderBefore, combat.defenderAfter),
  );
  const bossStrike =
    kind === "pirate" && (base as PirateBase).seasonalBoss === true;
  if (bossStrike) {
    recordBossDamage(universe, base.id, fleet.ownerPlayerId, killed, now);
  }
  let loot = emptyCargo();
  let attackerXp = 0;
  let starshardsGained = 0;
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(base.resources, combat.attackerAfter);
    base.resources = {
      metal: Math.max(0, base.resources.metal - loot.metal),
      crystal: Math.max(0, base.resources.crystal - loot.crystal),
      deuterium: Math.max(0, base.resources.deuterium - loot.deuterium),
    };
    const skim = spoilSkimmerDebris(debrisCreated, combat.attackerAfter);
    debrisCreated = skim.remaining;
    loot = {
      metal: loot.metal + skim.skimmed.metal,
      crystal: loot.crystal + skim.skimmed.crystal,
      deuterium: loot.deuterium,
    };
    if (kind === "pirate") {
      markPirateDestroyed(base as PirateBase, now);
      finishSeasonalPirateBoss(universe, base as PirateBase, now);
    }
    else markAlienDestroyed(base as AlienBase, now);
    if (owner) {
      awardSeasonPveWin(universe, owner, now);
      awardSeasonPirateKill(universe, owner, now);
      starshardsGained = grantPirateDestroyStarshards(
        owner,
        tierAtFight,
        kind,
        `${fleet.id}:destroy_shards:${now}`,
        kind === "pirate" && (base as PirateBase).seasonalBoss
          ? PIRATE_BOSS_STARSHARD_REWARD_MULT
          : 1,
      );
      if (kind === "pirate") {
        noteGoalMetric(owner, "pirateWin", 1, now);
        noteAchievementCount(owner, "pirateBasesDestroyed", 1);
      }
      attackerXp =
        xpForCombatWin(killed) +
        xpForPirateBaseDestroy(tierAtFight) +
        xpForPirateShipKills(killed);
      grantPlayerXp(owner, attackerXp);
      universe.players[owner.id] = owner;
    }
  } else if (owner) {
    attackerXp = xpForCombatLose();
    grantPlayerXp(owner, attackerXp);
    universe.players[owner.id] = owner;
  }

  addDebris(universe, base.coords, debrisCreated);

  const label = kind === "pirate" ? "Pirate" : "Alien";
  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  recordCombatReport(universe, {
    id: reportId,
    at: now,
    missionId: fleet.id,
    acsGroupId: fleet.acsGroupId ?? undefined,
    attackerPlayerId: fleet.ownerPlayerId,
    defenderPlayerId: kind === "pirate" ? "npc_pirates" : "npc_aliens",
    attackerName: owner?.name ?? "Unknown",
    defenderName: base.name,
    targetCoords: { ...base.coords },
    attackerBefore: { ...fleet.ships },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore,
    defensesAfter: rebuilt.defensesAfter,
    defensesDestroyed: rebuilt.defensesDestroyed,
    defensesRebuilt: rebuilt.defensesRebuilt,
    defensesPermanentlyLost: rebuilt.defensesPermanentlyLost,
    loot,
    debrisCreated,
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary:
      combat.outcome === "attacker_win"
        ? `${combat.summary} ${label} base destroyed (+${starshardsGained} Starshards).`
        : combat.summary,
    moonFormed: false,
    roundLog: combat.roundLog.length ? combat.roundLog : undefined,
    xpAwarded: { attacker: attackerXp, defender: 0 },
    bossDamage: bossStrike ? killed : undefined,
  });
  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}

export function resolvePirateRaidArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  resolveNpcRaidArrival(universe, fleet, now, "pirate");
}

export function resolveAlienRaidArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  resolveNpcRaidArrival(universe, fleet, now, "alien");
}
