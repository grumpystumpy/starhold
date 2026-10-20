import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFICER_DURATION_MS,
  OFFICERS,
  PIRATE_DEFENSE_WIN_STARSHARDS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  SKILLS,
  STARSHARDS_DAILY_LOGIN,
} from "./catalog.js";
import { expeditionKindFromRoll } from "./world-expedition.js";
import {
  activateOfficer,
  claimDailyLogin,
  createUniverse,
  grantPirateDestroyStarshards,
  grantPirateFleetKillStarshards,
  joinUniverse,
  playerBoosts,
  playerView,
  unlockSkill,
  utcDayKey,
} from "./world.js";

describe("Thread D Starshards / officers / skills", () => {
  it("maps expedition rolls including 5% starshards band", () => {
    assert.equal(expeditionKindFromRoll(67), "nothing");
    assert.equal(expeditionKindFromRoll(68), "miniPlanet");
    assert.equal(expeditionKindFromRoll(69), "miniPlanet");
    assert.equal(expeditionKindFromRoll(70), "starshards");
    assert.equal(expeditionKindFromRoll(74), "starshards");
    assert.equal(expeditionKindFromRoll(75), "pirates");
  });

  it("claims daily login once per UTC day", () => {
    const universe = createUniverse("Shard Drift", 8);
    const a = joinUniverse(universe, "Daily", 160_000_000);
    const day = utcDayKey(160_000_000);
    const first = claimDailyLogin(universe, a.player.id, 160_000_000);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.starshardsGranted, STARSHARDS_DAILY_LOGIN);
    assert.equal(universe.players[a.player.id].starshards, STARSHARDS_DAILY_LOGIN);
    assert.equal(universe.players[a.player.id].lastDailyLoginUtc, day);

    const again = claimDailyLogin(universe, a.player.id, 160_000_000 + 60_000);
    assert.equal(again.ok, false);

    const nextDay = claimDailyLogin(
      universe,
      a.player.id,
      Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 + 1,
    );
    assert.equal(nextDay.ok, true);
    assert.equal(
      universe.players[a.player.id].starshards,
      STARSHARDS_DAILY_LOGIN * 2,
    );
  });

  it("hires officers with Starshards and applies mine boost", () => {
    const universe = createUniverse("Officer Drift", 8);
    const a = joinUniverse(universe, "Boss", 161_000_000);
    const player = universe.players[a.player.id];
    player.starshards = 200;
    const now = 161_000_100;
    const before = playerView(universe, a.player.id, now).economy
      .productionPerHour.metal;

    const hire = activateOfficer(universe, a.player.id, "quartermaster", now);
    assert.equal(hire.ok, true);
    assert.equal(
      universe.players[a.player.id].starshards,
      200 - OFFICERS.quartermaster.cost,
    );
    const active = universe.players[a.player.id].officers ?? [];
    assert.equal(active.length, 1);
    assert.equal(active[0]!.officerId, "quartermaster");
    assert.equal(active[0]!.expiresAt, now + OFFICER_DURATION_MS);

    const after = playerView(universe, a.player.id, now).economy
      .productionPerHour.metal;
    assert.ok(after > before);
    const boosts = playerBoosts(universe.players[a.player.id], now);
    assert.equal(boosts.mineOutput, 1.1);
  });

  it("scales officer hire and renewal cost and duration by renewal count", () => {
    const universe = createUniverse("Officer Renewals", 8);
    const a = joinUniverse(universe, "Renewing", 161_500_000);
    const player = universe.players[a.player.id];
    const base = OFFICERS.engineer.cost;
    const baseDuration = 20 * 60 * 60 * 1000;
    const now = 161_500_100;

    for (const renewals of [0, 1, 2]) {
      player.starshards = 1000;
      player.officerRenewals = { engineer: renewals };
      const expectedCost = Math.floor(base * (1 + 0.5 * renewals));
      const expectedDuration = baseDuration * (1 + 0.15 * renewals);
      const result = activateOfficer(universe, a.player.id, "engineer", now + renewals);
      assert.equal(result.ok, true);
      assert.equal(player.starshards, 1000 - expectedCost);
      assert.equal(player.officers?.[0]?.expiresAt, now + renewals + expectedDuration);
      assert.equal(player.officerRenewals?.engineer, renewals + 1);
    }
  });

  it("treats a legacy save without officer renewal counts as zero", () => {
    const universe = createUniverse("Legacy Officer", 8);
    const a = joinUniverse(universe, "Legacy", 161_600_000);
    const player = universe.players[a.player.id];
    player.starshards = 100;
    delete player.officerRenewals;

    const view = playerView(universe, a.player.id, 161_600_100);
    assert.equal(view.officerRenewals.engineer ?? 0, 0);
    assert.equal(activateOfficer(universe, a.player.id, "engineer", 161_600_100).ok, true);
    assert.equal(player.officers?.[0]?.expiresAt, 161_600_100 + 20 * 60 * 60 * 1000);
  });

  it("unlocks skills permanently with prerequisites", () => {
    const universe = createUniverse("Skill Drift", 8);
    const a = joinUniverse(universe, "Adept", 162_000_000);
    const player = universe.players[a.player.id];
    player.starshards = 200;

    const blocked = unlockSkill(universe, a.player.id, "eco_mines_2", 162_000_100);
    assert.equal(blocked.ok, false);

    const root = unlockSkill(universe, a.player.id, "eco_mines_1", 162_000_100);
    assert.equal(root.ok, true);
    assert.deepEqual(universe.players[a.player.id].skillsUnlocked, [
      "eco_mines_1",
    ]);
    assert.equal(
      universe.players[a.player.id].starshards,
      200 - SKILLS.eco_mines_1.cost,
    );

    const tier2 = unlockSkill(universe, a.player.id, "eco_mines_2", 162_000_200);
    assert.equal(tier2.ok, true);
    assert.ok(
      universe.players[a.player.id].skillsUnlocked?.includes("eco_mines_2"),
    );

    const again = unlockSkill(universe, a.player.id, "eco_mines_1", 162_000_300);
    assert.equal(again.ok, true);
    assert.equal(universe.players[a.player.id].skillLevels?.eco_mines_1, 2);

    const boosts = playerBoosts(universe.players[a.player.id], 162_000_300);
    // Strip Mining I at level 2 is +10%, Strip Mining II at level 1 is +5%.
    assert.ok(Math.abs(boosts.mineOutput - 1.1 * 1.05) < 1e-9);
  });

  it("pirate destroy / defense-win hooks match live pirateRaid amounts", () => {
    const universe = createUniverse("Pirate Hooks", 8);
    const a = joinUniverse(universe, "Hunter", 163_000_000);
    const player = universe.players[a.player.id];
    const destroy = grantPirateDestroyStarshards(player, 3);
    assert.equal(destroy, PIRATE_DESTROY_STARSHARDS_BASE + 5 * 3);
    const kill = grantPirateFleetKillStarshards(player);
    assert.equal(kill, PIRATE_DEFENSE_WIN_STARSHARDS);
    assert.equal(player.starshards, destroy + kill);
  });

  it("playerView includes catalogs and daily flag", () => {
    const universe = createUniverse("View Drift", 8);
    const a = joinUniverse(universe, "Viewer", 164_000_000);
    const view = playerView(universe, a.player.id, 164_000_000);
    assert.equal(view.starshards, 0);
    assert.equal(view.officerCatalog.length, 6);
    assert.equal(view.skillCatalog.length, 13);
    assert.equal(view.dailyLoginAvailable, true);
    assert.deepEqual(view.officers, []);
    assert.deepEqual(view.skillsUnlocked, []);
  });

  it("grants highscore top-3 Starshards once when rivals exist", () => {
    const universe = createUniverse("Rank Drift", 8);
    const a = joinUniverse(universe, "Alpha", 165_000_000);
    joinUniverse(universe, "Beta", 165_000_100);
    universe.planets[a.planet.id].buildings.metalMine = 20;
    const view = playerView(universe, a.player.id, 165_000_200);
    assert.equal(view.starshards, 50);
    assert.equal(universe.players[a.player.id].highscoreStarshardsClaimed, true);
    const again = playerView(universe, a.player.id, 165_000_300);
    assert.equal(again.starshards, 50);
  });
});
