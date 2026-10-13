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
  XP_MIX_TARGET,
  xpForBuilding,
  xpForCombatLose,
  xpForCombatWin,
  xpForExpedition,
  xpForMiniPlanetDiscovery,
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

  it("XP award helpers match Micah mix (buildings = 0)", () => {
    assert.equal(xpForBuilding(5), 0);
    assert.equal(xpForBuilding(99), 0);
    assert.equal(xpForResearch(2), 4);
    assert.equal(xpForResearch(4), 6);
    assert.equal(xpForCombatWin(0), 19);
    assert.equal(xpForCombatWin(500_000), 19 + 56); // bonus cap
    assert.equal(xpForCombatWin(2500), 19 + 5);
    assert.equal(xpForCombatLose(), 4);
    assert.equal(xpForExpedition(), 4);
    assert.equal(xpForMiniPlanetDiscovery(), 10);
    assert.equal(xpForPirateBaseDestroy(2), 6);
    assert.equal(xpForPirateBaseDestroy(3), 7);
    assert.equal(xpForPirateShipKills(2500), 2);
    assert.equal(xpForPirateShipKills(1_000_000), 10); // cap
    assert.deepEqual(XP_MIX_TARGET, {
      combat: 80,
      pirates: 8,
      expeditions: 8,
      research: 4,
      buildings: 0,
    });
  });

  it("reference earn pack hits 80/8/8/4/0 mix", () => {
    // 3× PvP win @19 + lose @4 + pirateRaid (combat 19 + destroy t2 @6 + kills 2)
    // + 2× expedition @4 + research L2 @4
    const combat = 3 * xpForCombatWin(0) + xpForCombatLose() + xpForCombatWin(0);
    const pirates = xpForPirateBaseDestroy(2) + xpForPirateShipKills(2000);
    const expeditions = 2 * xpForExpedition();
    const research = xpForResearch(2);
    const buildings = xpForBuilding(10);
    assert.equal(combat, XP_MIX_TARGET.combat);
    assert.equal(pirates, XP_MIX_TARGET.pirates);
    assert.equal(expeditions, XP_MIX_TARGET.expeditions);
    assert.equal(research, XP_MIX_TARGET.research);
    assert.equal(buildings, XP_MIX_TARGET.buildings);
    assert.equal(combat + pirates + expeditions + research + buildings, 100);
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
  it("grants research XP but not building XP on completion", () => {
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
    assert.ok(queued.length > 0);
    advanceUniverse(universe, queued[0]!.completesAt);
    assert.equal(universe.planets[a.planet.id].buildQueue.length, 0);
    assert.equal(universe.players[a.player.id].xpTotal, beforeXp);

    const beforeR = universe.players[a.player.id].xpTotal ?? 0;
    const rq = queueResearch(universe, a.player.id, "energyTech", 301_100_000);
    assert.equal(rq.ok, true);
    const rFront = universe.players[a.player.id].researchQueue[0]!;
    const rTarget = rFront.targetLevel;
    const rDone = rFront.completesAt;
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
    const expectedBuild = (rawBuild * lb.buildTime) / universe.speed;
    const actualBuild =
      (body().buildQueue[0]!.completesAt - 304_000_300) / 1000;
    assert.ok(Math.abs(actualBuild - expectedBuild) < 1e-6);

    body().buildQueue = [];
    const rawShip = shipBuildSeconds("scout", 10, 5);
    const sq = queueShipBuild(universe, a.player.id, "scout", 10, 304_000_400);
    assert.equal(sq.ok, true);
    const expectedShip = (rawShip * lb.shipBuild) / universe.speed;
    const actualShip = (body().shipQueue[0]!.completesAt - 304_000_400) / 1000;
    assert.ok(Math.abs(actualShip - expectedShip) < 1e-6);

    body().shipQueue = [];
    const rawResearch = researchUpgradeSeconds("energyTech", 0, 5);
    const rq = queueResearch(universe, a.player.id, "energyTech", 304_000_500);
    assert.equal(rq.ok, true);
    // Research still uses ceil / 1s floor (Nanite exempt; contract with J).
    const expectedResearch = Math.max(
      1,
      Math.ceil((rawResearch * lb.researchTime) / universe.speed),
    );
    const actualResearch = Math.round(
      (universe.players[a.player.id].researchQueue[0]!.completesAt -
        304_000_500) /
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
