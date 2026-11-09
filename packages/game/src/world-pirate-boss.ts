import { PIRATE_BOSS_COOLDOWN_MS, PIRATE_BOSS_TIERS } from "./data/tuning.js";
import { fleetShipCount } from "./formulas.js";
import type {
  PirateBossTierId,
  PirateBossView,
  PirateBase,
  Resources,
  UniverseState,
} from "./types.js";
import { grantStarshards } from "./world-boosts.js";
import { pirateBossSeasonFlavor, seasonIdFromTime } from "./world-seasons.js";
import { addCargoToPlanet } from "./world-tick.js";

export type BossLeaderboardRow = {
  playerId: string;
  name: string;
  damage: number;
  rank: number;
};

function seasonalBases(universe: UniverseState): PirateBase[] {
  return Object.values(universe.pirateBases ?? {}).filter(
    (base) => base.seasonalBoss === true,
  );
}

function livingBoss(universe: UniverseState): PirateBase | undefined {
  const tracked = universe.pirateBossBaseId
    ? universe.pirateBases?.[universe.pirateBossBaseId]
    : undefined;
  if (tracked?.seasonalBoss && tracked.destroyedAt == null) return tracked;
  return seasonalBases(universe).find((base) => base.destroyedAt == null);
}

function latestBoss(universe: UniverseState): PirateBase | undefined {
  const living = livingBoss(universe);
  if (living) return living;
  return seasonalBases(universe)
    .slice()
    .sort((a, b) => (b.destroyedAt ?? 0) - (a.destroyedAt ?? 0))[0];
}

function rankedDamage(
  base: PirateBase | undefined,
): { playerId: string; damage: number }[] {
  return Object.entries(base?.bossDamage ?? {})
    .map(([playerId, damage]) => ({
      playerId,
      damage: Math.max(0, Math.floor(damage)),
    }))
    .filter((row) => row.damage > 0)
    .sort(
      (a, b) => b.damage - a.damage || a.playerId.localeCompare(b.playerId),
    );
}

/** Share of total damage. Rank 1 is paid separately in `payBossParticipation`. */
export function bossParticipationTier(share: number): PirateBossTierId | null {
  if (!Number.isFinite(share) || share <= 0) return null;
  if (share + 1e-12 >= PIRATE_BOSS_TIERS.top1.minShare) return "top1";
  if (share + 1e-12 >= PIRATE_BOSS_TIERS.top10.minShare) return "top10";
  if (share + 1e-12 >= PIRATE_BOSS_TIERS.participant.minShare) {
    return "participant";
  }
  return null;
}

export function recordBossDamage(
  universe: UniverseState,
  bossId: string,
  playerId: string,
  killedValue: number,
  _now: number,
): void {
  const base = universe.pirateBases?.[bossId];
  if (!base?.seasonalBoss || !playerId) return;
  const added = Math.floor(killedValue);
  if (added <= 0) return;
  if (!base.bossDamage) base.bossDamage = {};
  base.bossDamage[playerId] = (base.bossDamage[playerId] ?? 0) + added;
}

export function bossLeaderboard(
  universe: UniverseState,
  limit = 10,
): BossLeaderboardRow[] {
  const cap = Math.max(0, Math.floor(limit));
  return rankedDamage(latestBoss(universe))
    .slice(0, cap)
    .map((row, index) => ({
      playerId: row.playerId,
      name: universe.players[row.playerId]?.name ?? row.playerId,
      damage: row.damage,
      rank: index + 1,
    }));
}

function tierReward(id: PirateBossTierId): {
  starshards: number;
  resources: Resources;
} {
  const tier = PIRATE_BOSS_TIERS[id];
  return { starshards: tier.starshards, resources: { ...tier.resources } };
}

/** Pay each contributor once. Rank 1 gets the top prize; everyone else is by share. */
export function payBossParticipation(
  universe: UniverseState,
  bossId: string,
  now: number,
): void {
  const base = universe.pirateBases?.[bossId];
  if (!base?.seasonalBoss || base.bossRewardsPaid) return;
  base.bossRewardsPaid = true;
  const rows = rankedDamage(base);
  const total = rows.reduce((sum, row) => sum + row.damage, 0);
  if (total <= 0) return;
  rows.forEach((row, index) => {
    const share = row.damage / total;
    const tier =
      index === 0 ? "top1" : bossParticipationTier(Math.min(share, 0.999));
    if (!tier) return;
    const reward = tierReward(tier);
    const player = universe.players[row.playerId];
    if (!player) return;
    grantStarshards(player, reward.starshards);
    const home = universe.planets[player.homePlanetId];
    if (home) addCargoToPlanet(universe, home, reward.resources, now);
    universe.players[player.id] = player;
  });
}

function hpPct(base: PirateBase): number {
  const left = fleetShipCount(base.ships);
  if (base.destroyedAt != null || left <= 0) return 0;
  const spawned = base.bossShipsAtSpawn ?? left;
  if (spawned <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((left / spawned) * 100)));
}

/** Undefined when no boss is active and the cooldown has not started. */
export function pirateBossSummary(
  universe: UniverseState,
  playerId: string,
  now: number,
): PirateBossView | undefined {
  const living = livingBoss(universe);
  const cooldownAt = universe.pirateBossNextSpawnAt ?? 0;
  const cooling = !living && cooldownAt > now;
  const base = living ?? (cooling ? latestBoss(universe) : undefined);
  if (!living && !cooling) return undefined;
  const rows = rankedDamage(base);
  const totalDamage = rows.reduce((sum, row) => sum + row.damage, 0);
  const mine = rows.findIndex((row) => row.playerId === playerId);
  const myDamage = mine >= 0 ? rows[mine]!.damage : 0;
  const share = totalDamage > 0 ? myDamage / totalDamage : 0;
  const myTier =
    myDamage > 0 && mine === 0
      ? "top1"
      : bossParticipationTier(Math.min(share, 0.999));
  const coords = base?.coords ?? { galaxy: 1, system: 1, slot: 1 };
  const seasonId = seasonIdFromTime(now);
  const flavor = pirateBossSeasonFlavor(seasonId);
  const windowEnd = universe.pirateBossActiveUntil;
  const projectedSpawnAt = living
    ? (windowEnd ?? now) + PIRATE_BOSS_COOLDOWN_MS
    : cooling
      ? cooldownAt
      : undefined;
  return {
    id: base?.id ?? "",
    coords: { ...coords },
    shipsLeft: base && base.destroyedAt == null ? fleetShipCount(base.ships) : 0,
    hpPct: base && base.destroyedAt == null ? hpPct(base) : 0,
    activeUntil: living ? universe.pirateBossActiveUntil : undefined,
    nextSpawnAt: cooling ? cooldownAt : undefined,
    myDamage,
    myRank: mine >= 0 ? mine + 1 : null,
    totalDamage,
    myTier: myDamage > 0 ? myTier : null,
    top: rows.slice(0, 10).map((row) => ({
      playerId: row.playerId,
      name: universe.players[row.playerId]?.name ?? row.playerId,
      damage: row.damage,
    })),
    seasonId,
    flavorTitle: flavor.title,
    flavorLine: flavor.line,
    projectedSpawnAt,
  };
}
