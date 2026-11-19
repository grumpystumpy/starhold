import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPEDITION_SLOT } from "./catalog.js";
import {
  GOAL_DAILY_BUILDINGS,
  GOAL_DAILY_BUILDING_METAL,
  GOAL_DAILY_EXPEDITION_METAL,
  GOAL_DAILY_EXPEDITIONS,
  GOAL_DAILY_PIRATE_STARSHARDS,
  GOAL_DAILY_PIRATE_WINS,
  GOAL_DAILY_RESEARCH,
  GOAL_DAILY_RESEARCH_STARSHARDS,
  GOAL_DAILY_SHIPS,
  GOAL_DAILY_SHIP_METAL,
  GOAL_WEEKLY_BUILDING_METAL,
  GOAL_WEEKLY_BUILDINGS,
  GOAL_WEEKLY_RESEARCH,
  GOAL_WEEKLY_RESEARCH_STARSHARDS,
  GOAL_WEEKLY_SHIP_METAL,
  GOAL_WEEKLY_SHIPS,
  GOALS,
} from "./data/tuning.js";
import { emptyFleetShips, storageFor } from "./formulas.js";
import {
  advanceUniverse,
  claimGoal,
  createUniverse,
  ensureGoalBoard,
  joinUniverse,
  launchFleet,
  noteGoalMetric,
  playerView,
  queueBuildingUpgrade,
  queueResearch,
  queueShipBuild,
  utcWeekKey,
} from "./world.js";

const WED = Date.UTC(2026, 9, 14, 15, 0, 0);
const THU = Date.UTC(2026, 9, 15, 1, 0, 0);
const SUN = Date.UTC(2026, 9, 11, 23, 0, 0);
const MON = Date.UTC(2026, 9, 12, 0, 0, 0);

describe("goal periods", () => {
  it("uses a stable UTC ISO week and rolls on Monday", () => {
    assert.equal(utcWeekKey(MON), utcWeekKey(WED));
    assert.notEqual(utcWeekKey(SUN), utcWeekKey(MON));
    assert.match(utcWeekKey(WED), /^\d{4}-W\d{2}$/);
  });

  it("keeps weekly progress when the UTC day rolls", () => {
    const universe = createUniverse("Goal Day", 1);
    const { player } = joinUniverse(universe, "Dayroll", WED);
    noteGoalMetric(player, "pirateWin", GOAL_DAILY_PIRATE_WINS, WED);
    noteGoalMetric(player, "expedition", 2, WED);
    const before = ensureGoalBoard(player, WED);
    assert.equal(before.progress.dailyPirateWins, GOAL_DAILY_PIRATE_WINS);
    assert.equal(before.progress.weeklyPirateWins, GOAL_DAILY_PIRATE_WINS);
    assert.equal(before.progress.weeklyExpeditions, 2);

    const after = ensureGoalBoard(player, THU);
    assert.equal(after.dailyKey, "2026-10-15");
    assert.equal(after.progress.dailyPirateWins, undefined);
    assert.equal(after.progress.dailyExpeditions, undefined);
    assert.equal(after.progress.weeklyPirateWins, GOAL_DAILY_PIRATE_WINS);
    assert.equal(after.progress.weeklyExpeditions, 2);
    assert.equal(after.weeklyKey, before.weeklyKey);
  });

  it("clears weekly counters when the ISO week rolls and keeps the new day", () => {
    const universe = createUniverse("Goal Week", 1);
    const { player } = joinUniverse(universe, "Weekroll", SUN);
    noteGoalMetric(player, "pirateWin", 1, SUN);
    const rolled = ensureGoalBoard(player, MON);
    assert.equal(rolled.progress.weeklyPirateWins, undefined);
    assert.equal(rolled.progress.dailyPirateWins, undefined);
    assert.equal(rolled.weeklyKey, utcWeekKey(MON));
    assert.notEqual(rolled.weeklyKey, utcWeekKey(SUN));
  });
});

describe("goal claims", () => {
  it("rejects unfinished goals and pays Starshards once", () => {
    const universe = createUniverse("Goal Claim", 1);
    const { player } = joinUniverse(universe, "Claimer", WED);
    const early = claimGoal(universe, player.id, "dailyPirateWins", WED);
    assert.equal(early.ok, false);
    if (!early.ok) {
      assert.match(early.error, /0 \/ 3/);
      assert.equal(early.error.includes("_"), false);
    }

    noteGoalMetric(player, "pirateWin", GOAL_DAILY_PIRATE_WINS, WED);
    const paid = claimGoal(universe, player.id, "dailyPirateWins", WED);
    assert.equal(paid.ok, true);
    assert.equal(
      universe.players[player.id]!.starshards,
      GOAL_DAILY_PIRATE_STARSHARDS,
    );
    const again = claimGoal(universe, player.id, "dailyPirateWins", WED);
    assert.equal(again.ok, false);
    assert.equal(
      universe.players[player.id]!.starshards,
      GOAL_DAILY_PIRATE_STARSHARDS,
    );
  });

  it("pays resources when storage can hold them and refuses a full vault", () => {
    const universe = createUniverse("Goal Cargo", 1);
    const { player, planet } = joinUniverse(universe, "Hauler", WED);
    noteGoalMetric(
      universe.players[player.id]!,
      "expedition",
      GOAL_DAILY_EXPEDITIONS,
      WED,
    );
    const body = universe.planets[planet.id]!;
    const before = body.resources.metal;
    const paid = claimGoal(universe, player.id, "dailyExpeditions", WED);
    assert.equal(paid.ok, true);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      before + GOAL_DAILY_EXPEDITION_METAL,
    );

    const caps = storageFor(universe.planets[planet.id]!);
    universe.planets[planet.id]!.resources.metal = caps.metal;
    noteGoalMetric(universe.players[player.id]!, "expedition", 1, WED);
    // Daily expedition goal is already claimed; weekly still needs more runs.
    const weeklyTarget =
      GOALS.find((goal) => goal.id === "weeklyExpeditions")!.target;
    noteGoalMetric(
      universe.players[player.id]!,
      "expedition",
      weeklyTarget,
      WED,
    );
    const blocked = claimGoal(universe, player.id, "weeklyExpeditions", WED);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.match(blocked.error, /12,000 metal/);
      assert.equal(blocked.error.includes("_"), false);
    }
    assert.equal(universe.planets[planet.id]!.resources.metal, caps.metal);
  });

  it("drops an unclaimed daily reward when the day rolls", () => {
    const universe = createUniverse("Goal Miss", 1);
    const { player } = joinUniverse(universe, "Late", WED);
    noteGoalMetric(player, "pirateWin", GOAL_DAILY_PIRATE_WINS, WED);
    ensureGoalBoard(player, THU);
    const missed = claimGoal(universe, player.id, "dailyPirateWins", THU);
    assert.equal(missed.ok, false);
    assert.equal(universe.players[player.id]!.starshards ?? 0, 0);
  });
});

describe("goal hooks", () => {
  it("counts an expedition arrival toward daily and weekly runs", () => {
    const universe = createUniverse("Goal Expeditions", 8);
    const joined = joinUniverse(universe, "Voyager", 140_000_000);
    universe.planets[joined.planet.id]!.ships.scout = 2;
    universe.planets[joined.planet.id]!.resources.deuterium = 5_000;
    const launch = launchFleet(universe, {
      playerId: joined.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: joined.planet.coords.galaxy,
        system: joined.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 1 },
      now: 140_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    const outboundAt = launch.fleet.arrivesAt;
    advanceUniverse(universe, outboundAt);
    const view = playerView(universe, joined.player.id, outboundAt);
    const daily = view.goals.find((goal) => goal.id === "dailyExpeditions");
    const weekly = view.goals.find((goal) => goal.id === "weeklyExpeditions");
    assert.equal(daily?.progress, 1);
    assert.equal(weekly?.progress, 1);
    assert.equal(view.goals.some((goal) => goal.title.includes("_")), false);
  });

  it("counts a pirate base destroy as a pirate victory", () => {
    const universe = createUniverse("Goal Raid", 8);
    const bases = Object.values(universe.pirateBases ?? {});
    const base = bases.find((row) => row.destroyedAt == null);
    assert.ok(base);
    base!.tier = 0;
    base!.ships = emptyFleetShips();
    base!.resources = { metal: 100, crystal: 50, deuterium: 10 };
    const { player, planet } = joinUniverse(universe, "Hunter", 410_000_000);
    universe.planets[planet.id]!.ships.cruiser = 4;
    universe.planets[planet.id]!.buildings.deutTank = 4;
    universe.planets[planet.id]!.resources.deuterium = 100_000;
    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { cruiser: 3 },
      pirateBaseId: base!.id,
      now: 410_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    const outboundAt = launch.fleet.arrivesAt;
    advanceUniverse(universe, outboundAt);
    const view = playerView(universe, player.id, outboundAt);
    assert.equal(
      view.goals.find((goal) => goal.id === "dailyPirateWins")?.progress,
      1,
    );
    assert.equal(
      view.goals.find((goal) => goal.id === "weeklyPirateWins")?.progress,
      1,
    );
  });

  it("increments new daily mission metrics on event completion and allows claims", () => {
    const universe = createUniverse("New Goals", 8);
    const { player, planet } = joinUniverse(universe, "Builder", WED);
    const p = universe.planets[planet.id]!;
    p.buildings.metalStorage = 10;
    p.buildings.crystalStorage = 10;
    p.buildings.deutTank = 10;
    p.resources = { metal: 500_000, crystal: 500_000, deuterium: 500_000 };
    p.buildings.shipyard = 5;
    p.buildings.researchLab = 5;

    // 1. Building upgrades
    const b1 = queueBuildingUpgrade(universe, player.id, "metalMine", WED);
    assert.equal(b1.ok, true);
    const doneAt = universe.planets[planet.id]!.buildQueue[0]!.completesAt;
    advanceUniverse(universe, doneAt);

    let view = playerView(universe, player.id, doneAt);
    let buildGoal = view.goals.find((g) => g.id === "dailyBuildingUpgrades");
    assert.equal(buildGoal?.progress, 1);

    // Complete 2 more building upgrades to reach target
    const b2 = queueBuildingUpgrade(universe, player.id, "metalMine", doneAt + 1);
    assert.equal(b2.ok, true);
    const doneAt2 = universe.planets[planet.id]!.buildQueue[0]!.completesAt;
    advanceUniverse(universe, doneAt2);

    const b3 = queueBuildingUpgrade(universe, player.id, "metalMine", doneAt2 + 1);
    assert.equal(b3.ok, true);
    const doneAt3 = universe.planets[planet.id]!.buildQueue[0]!.completesAt;
    advanceUniverse(universe, doneAt3);

    view = playerView(universe, player.id, doneAt3);
    buildGoal = view.goals.find((g) => g.id === "dailyBuildingUpgrades");
    assert.equal(buildGoal?.progress, GOAL_DAILY_BUILDINGS);

    const metalBefore = universe.planets[planet.id]!.resources.metal;
    const claimBuild = claimGoal(universe, player.id, "dailyBuildingUpgrades", doneAt3);
    assert.equal(claimBuild.ok, true);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      metalBefore + GOAL_DAILY_BUILDING_METAL,
    );

    // 2. Research project
    const r1 = queueResearch(universe, player.id, "energyTech");
    assert.equal(r1.ok, true);
    const rDoneAt = universe.players[player.id]!.researchQueue[0]!.completesAt;
    advanceUniverse(universe, rDoneAt);

    view = playerView(universe, player.id, rDoneAt);
    const resGoal = view.goals.find((g) => g.id === "dailyResearch");
    assert.equal(resGoal?.progress, GOAL_DAILY_RESEARCH);

    const shardsBefore = universe.players[player.id]!.starshards ?? 0;
    const claimRes = claimGoal(universe, player.id, "dailyResearch", rDoneAt);
    assert.equal(claimRes.ok, true);
    assert.equal(
      universe.players[player.id]!.starshards,
      shardsBefore + GOAL_DAILY_RESEARCH_STARSHARDS,
    );

    // 3. Ship builds
    const s1 = queueShipBuild(universe, player.id, "scout", 10, rDoneAt + 10);
    assert.equal(s1.ok, true);
    const sDoneAt = universe.planets[planet.id]!.shipQueue[0]!.completesAt;
    advanceUniverse(universe, sDoneAt);

    view = playerView(universe, player.id, sDoneAt);
    const shipGoal = view.goals.find((g) => g.id === "dailyShips");
    assert.equal(shipGoal?.progress, GOAL_DAILY_SHIPS);

    const shipMetalBefore = universe.planets[planet.id]!.resources.metal;
    const claimShip = claimGoal(universe, player.id, "dailyShips", sDoneAt);
    assert.equal(claimShip.ok, true);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      shipMetalBefore + GOAL_DAILY_SHIP_METAL,
    );
  });

  it("loads an old save without the new goals and starts at zero progress", () => {
    const universe = createUniverse("Old Save Board", 1);
    const { player } = joinUniverse(universe, "Veteran", WED);
    // Simulate an old save where player.goals only has the old daily goals
    player.goals = {
      dailyKey: "2026-10-14",
      weeklyKey: "2026-W42",
      progress: {
        dailyPirateWins: 2,
        dailyExpeditions: 3,
      },
      claimed: [],
    };

    const board = ensureGoalBoard(player, WED);
    assert.equal(board.progress.dailyPirateWins, 2);
    assert.equal(board.progress.dailyExpeditions, 3);
    assert.equal(board.progress.dailyBuildingUpgrades, undefined);
    assert.equal(board.progress.dailyResearch, undefined);
    assert.equal(board.progress.dailyShips, undefined);

    const view = playerView(universe, player.id, WED);
    const buildingGoal = view.goals.find((g) => g.id === "dailyBuildingUpgrades");
    const researchGoal = view.goals.find((g) => g.id === "dailyResearch");
    const shipsGoal = view.goals.find((g) => g.id === "dailyShips");
    assert.equal(buildingGoal?.progress, 0);
    assert.equal(researchGoal?.progress, 0);
    assert.equal(shipsGoal?.progress, 0);
    assert.equal(buildingGoal?.claimed, false);
    assert.equal(researchGoal?.claimed, false);
    assert.equal(shipsGoal?.claimed, false);
  });
});

describe("weekly goals board", () => {
  it("counts weekly progress, pays once, and clears it on Monday", () => {
    const universe = createUniverse("Weekly Board", 1);
    const { player, planet } = joinUniverse(universe, "Weekly", WED);
    const body = universe.planets[planet.id]!;
    body.buildings.metalStorage = 12;
    body.buildings.crystalStorage = 12;
    body.buildings.deutTank = 12;

    const early = claimGoal(universe, player.id, "weeklyResearch", WED);
    assert.equal(early.ok, false);
    if (!early.ok) {
      assert.match(early.error, /0 \/ 4/);
      assert.equal(early.error.includes("_"), false);
    }

    noteGoalMetric(player, "buildingUpgrade", GOAL_WEEKLY_BUILDINGS, WED);
    noteGoalMetric(player, "researchComplete", GOAL_WEEKLY_RESEARCH, WED);
    noteGoalMetric(player, "shipBuild", GOAL_WEEKLY_SHIPS, WED);
    const open = ensureGoalBoard(player, WED);
    assert.equal(open.progress.weeklyBuildingUpgrades, GOAL_WEEKLY_BUILDINGS);
    assert.equal(open.progress.weeklyResearch, GOAL_WEEKLY_RESEARCH);
    assert.equal(open.progress.weeklyShips, GOAL_WEEKLY_SHIPS);
    assert.equal(open.progress.dailyBuildingUpgrades, GOAL_DAILY_BUILDINGS);

    const metalBefore = universe.planets[planet.id]!.resources.metal;
    const shardsBefore = universe.players[player.id]!.starshards ?? 0;
    const paidBuild = claimGoal(universe, player.id, "weeklyBuildingUpgrades", WED);
    assert.equal(paidBuild.ok, true);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      metalBefore + GOAL_WEEKLY_BUILDING_METAL,
    );
    const paidBuildAgain = claimGoal(
      universe,
      player.id,
      "weeklyBuildingUpgrades",
      WED,
    );
    assert.equal(paidBuildAgain.ok, false);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      metalBefore + GOAL_WEEKLY_BUILDING_METAL,
    );

    const paidResearch = claimGoal(universe, player.id, "weeklyResearch", WED);
    assert.equal(paidResearch.ok, true);
    assert.equal(
      universe.players[player.id]!.starshards,
      shardsBefore + GOAL_WEEKLY_RESEARCH_STARSHARDS,
    );
    const paidResearchAgain = claimGoal(universe, player.id, "weeklyResearch", WED);
    assert.equal(paidResearchAgain.ok, false);
    assert.equal(
      universe.players[player.id]!.starshards,
      shardsBefore + GOAL_WEEKLY_RESEARCH_STARSHARDS,
    );

    const shipMetalBefore = universe.planets[planet.id]!.resources.metal;
    const paidShips = claimGoal(universe, player.id, "weeklyShips", WED);
    assert.equal(paidShips.ok, true);
    assert.equal(
      universe.planets[planet.id]!.resources.metal,
      shipMetalBefore + GOAL_WEEKLY_SHIP_METAL,
    );
    const paidShipsAgain = claimGoal(universe, player.id, "weeklyShips", WED);
    assert.equal(paidShipsAgain.ok, false);

    const nextMonday = Date.UTC(2026, 9, 19, 0, 0, 0);
    const rolled = ensureGoalBoard(player, nextMonday);
    assert.equal(rolled.weeklyKey, utcWeekKey(nextMonday));
    assert.notEqual(rolled.weeklyKey, utcWeekKey(WED));
    assert.equal(rolled.progress.weeklyBuildingUpgrades, undefined);
    assert.equal(rolled.progress.weeklyResearch, undefined);
    assert.equal(rolled.progress.weeklyShips, undefined);
    assert.equal(rolled.claimed.includes("weeklyResearch"), false);
    const missed = claimGoal(universe, player.id, "weeklyResearch", nextMonday);
    assert.equal(missed.ok, false);
    assert.equal(
      universe.players[player.id]!.starshards,
      shardsBefore + GOAL_WEEKLY_RESEARCH_STARSHARDS,
    );
  });

  it("keeps weekly mission progress when only the UTC day rolls", () => {
    const universe = createUniverse("Weekly Day", 1);
    const { player } = joinUniverse(universe, "Daykeep", WED);
    noteGoalMetric(player, "buildingUpgrade", 4, WED);
    noteGoalMetric(player, "researchComplete", 2, WED);
    noteGoalMetric(player, "shipBuild", 11, WED);
    const after = ensureGoalBoard(player, THU);
    assert.equal(after.dailyKey, "2026-10-15");
    assert.equal(after.progress.dailyBuildingUpgrades, undefined);
    assert.equal(after.progress.dailyResearch, undefined);
    assert.equal(after.progress.dailyShips, undefined);
    assert.equal(after.progress.weeklyBuildingUpgrades, 4);
    assert.equal(after.progress.weeklyResearch, 2);
    assert.equal(after.progress.weeklyShips, 11);
    assert.equal(after.weeklyKey, utcWeekKey(WED));
  });

  it("counts a finished building upgrade on the weekly board", () => {
    const universe = createUniverse("Weekly Build", 8);
    const { player, planet } = joinUniverse(universe, "Mason", WED);
    const body = universe.planets[planet.id]!;
    body.resources = { metal: 500_000, crystal: 500_000, deuterium: 500_000 };
    const queued = queueBuildingUpgrade(universe, player.id, "metalMine", WED);
    assert.equal(queued.ok, true);
    const doneAt = universe.planets[planet.id]!.buildQueue[0]!.completesAt;
    advanceUniverse(universe, doneAt);
    const view = playerView(universe, player.id, doneAt);
    assert.equal(
      view.goals.find((goal) => goal.id === "weeklyBuildingUpgrades")?.progress,
      1,
    );
    assert.equal(
      view.goals.find((goal) => goal.id === "dailyBuildingUpgrades")?.progress,
      1,
    );
  });

  it("starts an old save with no weekly fields at empty weekly progress", () => {
    const universe = createUniverse("No Weekly Fields", 1);
    const { player } = joinUniverse(universe, "Legacy", WED);
    player.goals = {
      dailyKey: "2026-10-14",
      progress: { dailyPirateWins: 2 },
      claimed: [],
    };
    assert.equal(player.goals.weeklyKey, undefined);

    const board = ensureGoalBoard(player, WED);
    assert.equal(board.dailyKey, "2026-10-14");
    assert.equal(board.weeklyKey, utcWeekKey(WED));
    assert.equal(board.progress.dailyPirateWins, 2);
    assert.equal(board.progress.weeklyPirateWins, undefined);
    assert.equal(board.progress.weeklyExpeditions, undefined);
    assert.equal(board.progress.weeklyBuildingUpgrades, undefined);
    assert.equal(board.progress.weeklyResearch, undefined);
    assert.equal(board.progress.weeklyShips, undefined);

    const view = playerView(universe, player.id, WED);
    for (const goal of view.goals) {
      if (goal.cadence !== "weekly") continue;
      assert.equal(goal.progress, 0, goal.id);
      assert.equal(goal.claimed, false, goal.id);
    }
    assert.equal(
      view.goals.find((goal) => goal.id === "dailyPirateWins")?.progress,
      2,
    );
  });
});
