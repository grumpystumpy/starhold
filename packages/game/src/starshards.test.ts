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
import { storageFor } from "./formulas-build.js";
import { playerBoosts, storageForPlanet } from "./world-boosts.js";
import { addCargoToPlanet, advancePlanet } from "./world-tick.js";
import {
  activateOfficer,
  claimDailyLogin,
  createUniverse,
  ensureUniverseShape,
  grantPirateDestroyStarshards,
  grantPirateFleetKillStarshards,
  joinUniverse,
  playerBoosts,
  playerView,
  tradeStarshardsForResources,
  unlockSkill,
  utcDayKey,
} from "./world.js";

describe("Thread D Starshards / officers / skills", () => {
  it("keeps old-save storage unchanged and boosts all caps while Vaultkeeper is active", () => {
    const universe = createUniverse("Legacy Storage", 8);
    const joined = joinUniverse(universe, "Legacy", 159_900_000);
    const player = universe.players[joined.player.id]!;
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings.metalStorage = 2;
    planet.buildings.crystalStorage = 3;
    planet.buildings.deutTank = 4;
    planet.resources = { metal: 123, crystal: 456, deuterium: 789 };
    delete player.officers;

    const legacyCaps = storageFor(planet, playerBoosts(player, 159_900_000).storageCapacity);
    assert.deepEqual(legacyCaps, storageFor(planet));
    assert.deepEqual(planet.resources, { metal: 123, crystal: 456, deuterium: 789 });

    player.officers = [{ officerId: "vaultkeeper", activatedAt: 159_900_000, expiresAt: 160_000_000 }];
    const boostedCaps = storageFor(planet, playerBoosts(player, 159_900_001).storageCapacity);
    const baseCaps = storageFor(planet);
    assert.deepEqual(boostedCaps, {
      metal: Math.floor(baseCaps.metal * 1.1),
      crystal: Math.floor(baseCaps.crystal * 1.1),
      deuterium: Math.floor(baseCaps.deuterium * 1.1),
    });
    assert.equal(playerBoosts(player, 160_000_000).storageCapacity, 1);
  });

  it("uses owned Vaultkeeper caps for production and delivery, never NPC caps", () => {
    const universe = createUniverse("Vaultkeeper Caps", 8);
    const joined = joinUniverse(universe, "Vault", 159_900_000);
    const player = universe.players[joined.player.id]!;
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings = { metalStorage: 2, crystalStorage: 2, deutTank: 2 };
    player.officers = [{ officerId: "vaultkeeper", activatedAt: 159_900_000, expiresAt: 200_000_000 }];

    const base = storageFor(planet);
    const boosted = storageForPlanet(universe, planet, 159_900_001);
    assert.ok(boosted.metal > 0);
    planet.resources = { ...boosted };
    planet.lastTickAt = 159_900_001;
    const produced = advancePlanet(planet, universe.speed, 159_900_001 + 3_600_000, 0, undefined, player);
    assert.deepEqual(produced.resources, boosted);
    const unboostedTick = advancePlanet(planet, universe.speed, 159_900_001 + 3_600_000, 0);
    assert.deepEqual(unboostedTick.resources, base);

    planet.resources = { metal: base.metal, crystal: base.crystal, deuterium: base.deuterium };
    addCargoToPlanet(universe, planet, { metal: 100_000, crystal: 100_000, deuterium: 100_000 }, 159_900_002);
    assert.deepEqual(planet.resources, boosted);

    const npc = structuredClone(planet);
    npc.id = "npc-planet";
    npc.ownerPlayerId = "pirate-npc";
    assert.deepEqual(storageForPlanet(universe, npc, 159_900_002), storageFor(npc));
    assert.deepEqual(storageForPlanet(universe, planet, 200_000_000), storageFor(planet));
  });

  it("trades 1500 Starshards for the fixed resource bundle and back", () => {
    const universe = createUniverse("Shard Exchange", 8);
    const a = joinUniverse(universe, "Trader", 159_900_000);
    universe.players[a.player.id]!.starshards = 1500;
    universe.planets[a.planet.id]!.resources = {
      metal: 100,
      crystal: 200,
      deuterium: 300,
    };

    const bought = tradeStarshardsForResources(
      universe,
      a.player.id,
      a.planet.id,
      "buy",
      159_900_000,
    );
    assert.equal(bought.ok, true);
    assert.equal(universe.players[a.player.id]!.starshards, 0);
    assert.deepEqual(universe.planets[a.planet.id]!.resources, {
      metal: 3100,
      crystal: 2200,
      deuterium: 1300,
    });

    universe.players[a.player.id]!.starshards = 0;
    const sold = tradeStarshardsForResources(
      universe,
      a.player.id,
      a.planet.id,
      "sell",
      159_900_000,
    );
    assert.equal(sold.ok, true);
    assert.equal(universe.players[a.player.id]!.starshards, 1500);
    assert.deepEqual(universe.planets[a.planet.id]!.resources, {
      metal: 100,
      crystal: 200,
      deuterium: 300,
    });
  });

  it("rejects trades without sufficient currency, resources, or storage", () => {
    const universe = createUniverse("Blocked Exchange", 8);
    const a = joinUniverse(universe, "Trader", 159_910_000);
    universe.players[a.player.id]!.starshards = 1499;
    const before = { ...universe.planets[a.planet.id]!.resources };
    assert.equal(
      tradeStarshardsForResources(
        universe,
        a.player.id,
        a.planet.id,
        "buy",
        159_910_000,
      ).ok,
      false,
    );
    assert.equal(universe.players[a.player.id]!.starshards, 1499);
    assert.deepEqual(universe.planets[a.planet.id]!.resources, before);

    universe.players[a.player.id]!.starshards = 0;
    universe.planets[a.planet.id]!.resources = {
      metal: 2999,
      crystal: 2000,
      deuterium: 1000,
    };
    const lowResources = { ...universe.planets[a.planet.id]!.resources };
    assert.equal(
      tradeStarshardsForResources(
        universe,
        a.player.id,
        a.planet.id,
        "sell",
        159_910_000,
      ).ok,
      false,
    );
    assert.equal(universe.players[a.player.id]!.starshards, 0);
    assert.deepEqual(universe.planets[a.planet.id]!.resources, lowResources);

    universe.players[a.player.id]!.starshards = 1500;
    const planet = universe.planets[a.planet.id]!;
    const caps = storageFor(planet);
    planet.resources = {
      metal: caps.metal - 2999,
      crystal: 0,
      deuterium: 0,
    };
    const beforeFull = { ...planet.resources };
    assert.equal(
      tradeStarshardsForResources(
        universe,
        a.player.id,
        a.planet.id,
        "buy",
        159_910_000,
      ).ok,
      false,
    );
    assert.equal(universe.players[a.player.id]!.starshards, 1500);
    assert.deepEqual(universe.planets[a.planet.id]!.resources, beforeFull);
  });

  it("keeps legacy progress when optional Starshards are absent", () => {
    const universe = createUniverse("Legacy Exchange", 8);
    const a = joinUniverse(universe, "Legacy trader", 159_920_000);
    const player = universe.players[a.player.id]!;
    const planet = universe.planets[a.planet.id]!;
    planet.buildings.metalMine = 7;
    planet.ships.smallCargo = 9;
    planet.resources = { metal: 4000, crystal: 2500, deuterium: 1400 };
    delete player.starshards;

    const legacy = JSON.parse(JSON.stringify(universe)) as typeof universe;
    ensureUniverseShape(legacy);
    assert.equal(legacy.planets[a.planet.id]!.buildings.metalMine, 7);
    assert.equal(legacy.planets[a.planet.id]!.ships.smallCargo, 9);

    const sold = tradeStarshardsForResources(
      legacy,
      a.player.id,
      a.planet.id,
      "sell",
      159_920_000,
    );
    assert.equal(sold.ok, true);
    assert.equal(legacy.players[a.player.id]!.starshards, 1500);
    assert.deepEqual(legacy.planets[a.planet.id]!.resources, {
      metal: 1000,
      crystal: 500,
      deuterium: 400,
    });
  });

  it("maps expedition rolls including 5% starshards band", () => {
    assert.equal(expeditionKindFromRoll(67), "nothing");
    assert.equal(expeditionKindFromRoll(68), "miniPlanet");
    assert.equal(expeditionKindFromRoll(69), "miniPlanet");
    assert.equal(expeditionKindFromRoll(70), "starshards");
    assert.equal(expeditionKindFromRoll(74), "starshards");
    assert.equal(expeditionKindFromRoll(75), "newPirateBase");
    assert.equal(expeditionKindFromRoll(79), "pirates");
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
    assert.equal(view.officerCatalog.length, 7);
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
