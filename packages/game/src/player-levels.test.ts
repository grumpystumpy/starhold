import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import {
  buildingUpgradeSeconds,
  effectiveCombatResearch,
  emptyFleetShips,
  grantPlayerXp,
  levelBonuses,
  researchUpgradeSeconds,
  shipBuildSeconds,
  xpForBuilding,
  xpForCombatLose,
  xpForCombatWin,
  xpForExpedition,
  xpForPirateBaseDestroy,
  xpForPirateShipKills,
  xpForResearch,
  xpToNext,
} from "./formulas.js";
import {
  expeditionKindFromRoll,
  expeditionRoll,
  resolveExpeditionArrival,
} from "./world-expedition.js";
import {
  activePirateBases,
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  playerView,
  queueBuildingUpgrade,
  queueResearch,
  queueShipBuild,
} from "./world.js";
import type { FleetMission } from "./types.js";

describe("Thread I player levels / XP formulas", () => {
  it("xpToNext follows floor(100 * L^1.45)", () => {
    assert.equal(xpToNext(1), Math.floor(100 * Math.pow(1, 1.45)));
    assert.equal(xpToNext(2), Math.floor(100 * Math.pow(2, 1.45)));
    assert.equal(xpToNext(10), Math.floor(100 * Math.pow(10, 1.45)));
  });

  it("level bonuses match contract floors", () => {
    const l1 = levelBonuses(1);
    assert.equal(l1.production, 1);
    assert.equal(l1.buildTime, 1);
    assert.equal(l1.weaponsBonus, 0);

    const l11 = levelBonuses(11); // n = 10
    assert.equal(l11.production, 1.05);
    assert.ok(Math.abs(l11.buildTime - 0.96) < 1e-9);
    assert.equal(l11.weaponsBonus, 2);
    assert.equal(l11.shieldingBonus, 2);

    const high = levelBonuses(1 + 1000);
    assert.equal(high.buildTime, 0.7);
    assert.equal(high.researchTime, 0.7);
    assert.equal(high.fleetTime, 0.75);
    assert.equal(high.shipBuild, 0.65);
  });

  it("XP award helpers match contract amounts", () => {
    assert.equal(xpForBuilding(5), 8 + 2 * 5);
    assert.equal(xpForResearch(4), 12 + 3 * 4);
    assert.equal(xpForCombatWin(0), 25);
    assert.equal(xpForCombatWin(500_000), 25 + 200);
    assert.equal(xpForCombatWin(2500), 25 + 5);
    assert.equal(xpForCombatLose(), 8);
    assert.equal(xpForExpedition(), 15);
    assert.equal(xpForPirateBaseDestroy(3), 50 + 30);
    assert.equal(xpForPirateShipKills(2500), 10);
    assert.equal(xpForPirateShipKills(1_000_000), 100);
  });

  it("grantPlayerXp levels up with leftover xp", () => {
    const universe = createUniverse("XP Curve", 8);
    const { player } = joinUniverse(universe, "Rookie", 300_000_000);
    assert.equal(player.level, 1);
    assert.equal(player.xp, 0);

    const need = xpToNext(1);
    const gained = grantPlayerXp(player, need + 12);
    assert.equal(gained, 1);
    assert.equal(player.level, 2);
    assert.equal(player.xp, 12);
    assert.equal(player.xpTotal, need + 12);

    // Prior leftover xp (12) carries into the next thresholds.
    const before = player.level;
    grantPlayerXp(player, xpToNext(2) + xpToNext(3) + 5);
    assert.equal(player.level, before + 2);
    assert.equal(player.xp, 12 + 5);
  });
});

describe("Thread I XP grants live", () => {
  it("grants building + research XP on completion", () => {
    const universe = createUniverse("Build XP", 100);
    const a = joinUniverse(universe, "Builder", 301_000_000);
    const player = universe.players[a.player.id];
    universe.planets[a.planet.id].resources = {
      metal: 1_000_000,
      crystal: 1_000_000,
      deuterium: 1_000_000,
    };
    universe.planets[a.planet.id].buildings.researchLab = 5;

    const beforeXp = player.xpTotal ?? 0;
    const q = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      301_000_100,
    );
    assert.equal(q.ok, true);
    const queued = universe.planets[a.planet.id].buildQueue;
    assert.ok(queued);
    const target = queued!.targetLevel;
    advanceUniverse(universe, queued!.completesAt);
    assert.equal(universe.planets[a.planet.id].buildQueue, null);
    assert.equal(
      universe.players[a.player.id].xpTotal,
      beforeXp + xpForBuilding(target),
    );

    const beforeR = universe.players[a.player.id].xpTotal ?? 0;
    const rq = queueResearch(universe, a.player.id, "energyTech", 301_100_000);
    assert.equal(rq.ok, true);
    const rTarget = universe.players[a.player.id].researchQueue!.targetLevel;
    const rDone = universe.players[a.player.id].researchQueue!.completesAt;
    advanceUniverse(universe, rDone);
    assert.equal(
      universe.players[a.player.id].xpTotal,
      beforeR + xpForResearch(rTarget),
    );
  });

  it("grants expedition XP for non-empty outcomes only", () => {
    const universe = createUniverse("Xpd XP", 8);
    const a = joinUniverse(universe, "Explorer", 302_000_000);

    const fleet: FleetMission = {
      id: "flt_xpd_force",
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { galaxy: 1, system: 1, slot: 16 },
      targetAsteroidId: null,
      targetPirateBaseId: null,
      mission: "expedition",
      ships: { ...emptyFleetShips(), scout: 5 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 302_000_000,
      arrivesAt: 302_000_100,
      phase: "outbound",
      reportId: null,
    };

    let resourcesAt = fleet.arrivesAt;
    let nothingAt = fleet.arrivesAt;
    for (let t = 0; t < 500; t++) {
      const kind = expeditionKindFromRoll(
        expeditionRoll(fleet.id, fleet.arrivesAt + t),
      );
      if (kind === "resources") resourcesAt = fleet.arrivesAt + t;
      if (kind === "nothing") nothingAt = fleet.arrivesAt + t;
    }

    fleet.arrivesAt = resourcesAt;
    const before = universe.players[a.player.id].xpTotal ?? 0;
    resolveExpeditionArrival(universe, fleet, resourcesAt);
    assert.equal(
      universe.players[a.player.id].xpTotal,
      before + xpForExpedition(),
    );

    const beforeNothing = universe.players[a.player.id].xpTotal ?? 0;
    fleet.id = "flt_xpd_nothing";
    fleet.arrivesAt = nothingAt;
    fleet.reportId = null;
    // Re-find a nothing roll for the new fleet id.
    for (let t = 0; t < 500; t++) {
      if (
        expeditionKindFromRoll(expeditionRoll(fleet.id, nothingAt + t)) ===
        "nothing"
      ) {
        fleet.arrivesAt = nothingAt + t;
        break;
      }
    }
    resolveExpeditionArrival(universe, fleet, fleet.arrivesAt);
    assert.equal(universe.players[a.player.id].xpTotal, beforeNothing);
  });

  it("grants pirate destroy + kill XP on pirateRaid win", () => {
    const universe = createUniverse("Pirate XP", 8);
    const base = activePirateBases(universe)[0]!;
    base.tier = 2;
    base.ships = { ...emptyFleetShips(), scout: 2 };
    base.resources = { metal: 2000, crystal: 1000, deuterium: 200 };

    const { player, planet } = joinUniverse(universe, "Hunter", 303_000_000);
    const body = universe.planets[planet.id];
    body.ships.cruiser = 10;
    body.ships.interceptor = 20;
    body.resources.deuterium = 50_000;

    const before = universe.players[player.id].xpTotal ?? 0;
    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { cruiser: 5, interceptor: 10 },
      pirateBaseId: base.id,
      now: 303_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const after = universe.players[player.id].xpTotal ?? 0;
    assert.ok(after > before);
    assert.ok(after - before >= xpForPirateBaseDestroy(2) + xpForCombatWin(0));
  });
});

describe("Thread I level bonuses wired", () => {
  it("boosts production and shortens build/research/ship times", () => {
    const universe = createUniverse("Boost XP", 1);
    const a = joinUniverse(universe, "Veteran", 304_000_000);
    const player = universe.players[a.player.id];
    const body = () => universe.planets[a.planet.id];
    body().resources = {
      metal: 5_000_000,
      crystal: 5_000_000,
      deuterium: 5_000_000,
    };
    body().buildings.metalMine = 5;
    body().buildings.solarPlant = 8;
    body().buildings.shipyard = 5;
    body().buildings.researchLab = 5;

    const baseView = playerView(universe, a.player.id, 304_000_100);
    const baseMetal = baseView.economy.productionPerHour.metal;

    player.level = 21; // n = 20 → +10% prod
    const boosted = playerView(universe, a.player.id, 304_000_200);
    assert.ok(
      Math.abs(boosted.economy.productionPerHour.metal / baseMetal - 1.1) <
        0.02,
    );
    assert.equal(boosted.progress.level, 21);

    const lb = levelBonuses(21);
    const rawBuild = buildingUpgradeSeconds("metalMine", 5);
    const q = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      304_000_300,
    );
    assert.equal(q.ok, true);
    const expectedBuild = Math.max(
      1,
      Math.ceil((rawBuild * lb.buildTime) / universe.speed),
    );
    const actualBuild = Math.round(
      (body().buildQueue!.completesAt - 304_000_300) / 1000,
    );
    assert.equal(actualBuild, expectedBuild);

    body().buildQueue = null;
    const rawShip = shipBuildSeconds("scout", 10, 5);
    const sq = queueShipBuild(universe, a.player.id, "scout", 10, 304_000_400);
    assert.equal(sq.ok, true);
    const expectedShip = Math.max(
      1,
      Math.ceil((rawShip * lb.shipBuild) / universe.speed),
    );
    const actualShip = Math.round(
      (body().shipQueue!.completesAt - 304_000_400) / 1000,
    );
    assert.equal(actualShip, expectedShip);

    body().shipQueue = null;
    const rawResearch = researchUpgradeSeconds("energyTech", 0, 5);
    const rq = queueResearch(universe, a.player.id, "energyTech", 304_000_500);
    assert.equal(rq.ok, true);
    const expectedResearch = Math.max(
      1,
      Math.ceil((rawResearch * lb.researchTime) / universe.speed),
    );
    const actualResearch = Math.round(
      (universe.players[a.player.id].researchQueue!.completesAt - 304_000_500) /
        1000,
    );
    assert.equal(actualResearch, expectedResearch);
  });

  it("adds virtual weapons/shielding tech from level", () => {
    const universe = createUniverse("Combat XP", 8);
    const a = joinUniverse(universe, "Gunner", 305_000_000);
    const player = universe.players[a.player.id];
    player.research.weaponsTech = 3;
    player.research.shieldingTech = 2;
    player.level = 26; // n=25 → +5 virtual
    const eff = effectiveCombatResearch(player)!;
    assert.equal(eff.weaponsTech, 8);
    assert.equal(eff.shieldingTech, 7);
  });
});

describe("Thread I schema migrate 2→3", () => {
  it("stamps schema 3 and backfills level/xp without reset", () => {
    assert.equal(UNIVERSE_SCHEMA_VERSION, 3);
    const universe = createUniverse("Legacy Lvl", 8);
    const a = joinUniverse(universe, "OldHand", 306_000_000);
    universe.schemaVersion = 2;
    delete universe.players[a.player.id].level;
    delete universe.players[a.player.id].xp;
    delete universe.players[a.player.id].xpTotal;

    const result = migrateOrResetUniverse(universe);
    assert.equal(result.didReset, false);
    assert.equal(result.universe.schemaVersion, 3);
    assert.equal(result.universe.players[a.player.id].level, 1);
    assert.equal(result.universe.players[a.player.id].xp, 0);
    assert.equal(result.universe.players[a.player.id].xpTotal, 0);
    assert.equal(Object.keys(result.universe.players).length, 1);
  });

  it("playerView exposes progress", () => {
    const universe = createUniverse("View XP", 8);
    const a = joinUniverse(universe, "Viewer", 307_000_000);
    grantPlayerXp(universe.players[a.player.id], 50);
    const view = playerView(universe, a.player.id, 307_000_100);
    assert.equal(view.progress.level, 1);
    assert.equal(view.progress.xp, 50);
    assert.equal(view.progress.xpToNext, xpToNext(1));
    assert.equal(view.progress.xpTotal, 50);
    assert.equal(view.highscores[0]!.level, 1);
    assert.equal(view.highscores[0]!.xpTotal, 50);
  });
});
