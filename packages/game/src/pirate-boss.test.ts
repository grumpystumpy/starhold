import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PIRATE_BOSS_TIERS } from "./data/tuning.js";
import { emptyDefenses, emptyFleetShips } from "./formulas.js";
import type { FleetMission } from "./types.js";
import {
  bossLeaderboard,
  bossParticipationTier,
  payBossParticipation,
  pirateBossSummary,
  recordBossDamage,
} from "./world-pirate-boss.js";
import {
  createUniverse,
  joinUniverse,
  playerView,
  resolvePirateRaidArrival,
  tickPirates,
} from "./world.js";

describe("seasonal pirate boss damage and rewards", () => {
  it("records damage, ranks it, and ignores a second copy of the same hit value only by adding", () => {
    const universe = createUniverse("Boss board", 1);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const bossId = universe.pirateBossBaseId!;
    const alpha = joinUniverse(universe, "Alpha", now).player;
    const beta = joinUniverse(universe, "Beta", now).player;
    recordBossDamage(universe, bossId, alpha.id, 100, now);
    recordBossDamage(universe, bossId, alpha.id, 50, now);
    recordBossDamage(universe, bossId, beta.id, 40, now);
    recordBossDamage(universe, "missing", alpha.id, 10, now);
    recordBossDamage(universe, bossId, alpha.id, 0, now);

    assert.equal(universe.pirateBases![bossId]!.bossDamage?.[alpha.id], 150);
    const board = bossLeaderboard(universe, 10);
    assert.equal(board[0]?.playerId, alpha.id);
    assert.equal(board[0]?.damage, 150);
    assert.equal(board[0]?.rank, 1);
    assert.equal(board[1]?.playerId, beta.id);
    assert.equal(board.length, 2);

    const view = playerView(universe, alpha.id, now);
    assert.equal(view.pirateBoss?.id, bossId);
    assert.equal(view.pirateBoss?.myDamage, 150);
    assert.equal(view.pirateBoss?.myRank, 1);
    assert.equal(view.pirateBoss?.myTier, "top1");
    assert.equal(view.pirateBoss?.totalDamage, 190);
    assert.ok((view.pirateBoss?.hpPct ?? 0) > 0);
    assert.ok((view.pirateBoss?.shipsLeft ?? 0) > 0);
    const betaView = pirateBossSummary(universe, beta.id, now);
    assert.equal(betaView?.myTier, "top10");
    assert.equal(betaView?.myRank, 2);
  });

  it("maps share to a tier and pays rank 1 plus share tiers once", () => {
    assert.equal(bossParticipationTier(1), "top1");
    assert.equal(bossParticipationTier(0.1), "top10");
    assert.equal(bossParticipationTier(0.01), "participant");
    assert.equal(bossParticipationTier(0.009), null);

    const universe = createUniverse("Boss pay", 1);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const boss = universe.pirateBases![universe.pirateBossBaseId!]!;
    const leader = joinUniverse(universe, "Leader", now);
    const wing = joinUniverse(universe, "Wing", now);
    const speck = joinUniverse(universe, "Speck", now);
    const beforeLeader = leader.planet.resources.metal;
    const beforeWing = wing.planet.resources.metal;
    recordBossDamage(universe, boss.id, leader.player.id, 80, now);
    recordBossDamage(universe, boss.id, wing.player.id, 20, now);
    recordBossDamage(universe, boss.id, speck.player.id, 1, now);
    payBossParticipation(universe, boss.id, now);
    payBossParticipation(universe, boss.id, now + 1);

    assert.equal(boss.bossRewardsPaid, true);
    assert.equal(
      leader.player.starshards,
      PIRATE_BOSS_TIERS.top1.starshards,
    );
    assert.equal(
      leader.planet.resources.metal - beforeLeader,
      PIRATE_BOSS_TIERS.top1.resources.metal,
    );
    assert.equal(wing.player.starshards, PIRATE_BOSS_TIERS.top10.starshards);
    assert.equal(
      wing.planet.resources.metal - beforeWing,
      PIRATE_BOSS_TIERS.top10.resources.metal,
    );
    assert.equal(speck.player.starshards ?? 0, 0);
  });

  it("puts boss damage on the combat report and keeps the killer bonus", () => {
    const universe = createUniverse("Boss report", 8);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const boss = universe.pirateBases![universe.pirateBossBaseId!]!;
    const { player, planet } = joinUniverse(universe, "Hunter", now + 1);
    boss.ships = { ...emptyFleetShips(), interceptor: 1 };
    boss.defenses = emptyDefenses();
    const fleet: FleetMission = {
      id: "boss-hit",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...boss.coords },
      targetPirateBaseId: boss.id,
      mission: "pirateRaid",
      ships: { ...emptyFleetShips(), swarmMothership: 1 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now,
      arrivesAt: now,
      phase: "outbound",
      reportId: null,
    };
    resolvePirateRaidArrival(universe, fleet, now);
    const report = Object.values(universe.reports).find(
      (row) => row.missionId === fleet.id,
    );
    assert.ok(report);
    assert.equal(typeof report.bossDamage, "number");
    assert.ok((report.bossDamage ?? 0) > 0);
    assert.equal(boss.bossDamage?.[player.id], report.bossDamage);
    assert.equal(boss.bossRewardsPaid, true);
    assert.ok((player.starshards ?? 0) > PIRATE_BOSS_TIERS.top1.starshards);
    const cooling = playerView(universe, player.id, now);
    assert.equal(cooling.pirateBoss?.activeUntil, undefined);
    assert.equal(cooling.pirateBoss?.nextSpawnAt, universe.pirateBossNextSpawnAt);
    assert.equal(cooling.pirateBoss?.hpPct, 0);
  });

  it("omits the boss summary on an old save with no boss and no cooldown", () => {
    const universe = createUniverse("Old boss save", 1, 1, { lazySeed: true });
    delete universe.pirateBossBaseId;
    delete universe.pirateBossActiveUntil;
    delete universe.pirateBossNextSpawnAt;
    universe.skipPirateTopUp = true;
    const { player } = joinUniverse(universe, "Old", 10);
    const view = playerView(universe, player.id, 10);
    assert.equal(view.pirateBoss, undefined);
    assert.equal(view.player.allianceId ?? null, null);
    assert.equal(view.player.name, "Old");
  });
});
