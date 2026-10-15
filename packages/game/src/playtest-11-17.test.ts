import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OFFICERS, SKILLS } from "./catalog.js";
import {
  emptyDefenses,
  emptyFleetShips,
  levelUpCost,
  scaleEffect,
  storageCap,
} from "./formulas.js";
import {
  activateOfficer,
  createUniverse,
  deletePlayerMessages,
  ensureUniverseShape,
  highscoresBoard,
  joinUniverse,
  playerBoosts,
  playerView,
  raiseOfficer,
  skillLevelOf,
  unlockSkill,
} from "./world.js";
import { emptyBuildings } from "./world-bootstrap.js";
import type { CombatReport } from "./types.js";

describe("playtest 11–17", () => {
  it("triples storage capacity at every vault level", () => {
    assert.equal(storageCap(0), 30_000);
    assert.equal(storageCap(1), 60_000);
    assert.equal(storageCap(4), 10_000 * 16 * 3);
  });

  it("lists each commander once, on their home planet", () => {
    const universe = createUniverse("Home Board", 8);
    const a = joinUniverse(universe, "Alpha", 170_000_000);
    joinUniverse(universe, "Bravo", 170_000_001);
    const player = universe.players[a.player.id]!;
    const home = universe.planets[player.homePlanetId]!;
    const colonyId = "colony-home-board";
    universe.planets[colonyId] = {
      id: colonyId,
      ownerPlayerId: player.id,
      name: "Far Holding",
      coords: {
        galaxy: home.coords.galaxy,
        system: home.coords.system,
        slot: home.coords.slot === 1 ? 2 : 1,
      },
      kind: "planet",
      parentPlanetId: null,
      moonId: null,
      fieldsCap: 160,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      lastTickAt: home.lastTickAt,
      buildings: emptyBuildings(),
      ships: emptyFleetShips(),
      defenses: emptyDefenses(),
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    };
    const moonId = "moon-home-board";
    universe.planets[moonId] = {
      ...universe.planets[colonyId]!,
      id: moonId,
      name: "Night Moon",
      kind: "moon",
      parentPlanetId: home.id,
      coords: { ...home.coords },
    };
    home.moonId = moonId;
    player.planetIds.push(colonyId, moonId);

    const board = highscoresBoard(universe);
    assert.equal(board.length, 2);
    const row = board.find((entry) => entry.playerId === player.id);
    assert.ok(row);
    assert.equal(row!.homePlanetId, home.id);
    assert.equal(row!.planetName, home.name);
    assert.deepEqual(row!.coords, home.coords);
    assert.equal(
      board.filter((entry) => entry.planetName === "Far Holding").length,
      0,
    );
    assert.equal(
      board.filter((entry) => entry.planetName === "Night Moon").length,
      0,
    );

    const view = playerView(universe, player.id, 170_000_200);
    assert.equal(view.highscores.length, 2);
    assert.equal(
      view.roster.filter((entry) => entry.planetId === colonyId).length,
      0,
    );
  });

  it("deletes a category on the server and keeps the other player's combat report", () => {
    const universe = createUniverse("Inbox", 8);
    const a = joinUniverse(universe, "Alpha", 171_000_000);
    const b = joinUniverse(universe, "Bravo", 171_000_001);
    const player = universe.players[a.player.id]!;
    const other = universe.players[b.player.id]!;
    player.eventLog = [
      {
        id: "evt1",
        kind: "fleetReturn",
        createdAt: 1,
        readAt: null,
        title: "Fleet returned to Home",
        body: "Home",
      },
    ];
    const report: CombatReport = {
      id: "combat-shared",
      at: 2,
      missionId: "m",
      attackerPlayerId: player.id,
      defenderPlayerId: other.id,
      attackerName: player.name,
      defenderName: other.name,
      targetCoords: { galaxy: 1, system: 1, slot: 4 },
      attackerBefore: emptyFleetShips(),
      attackerAfter: emptyFleetShips(),
      defenderBefore: emptyFleetShips(),
      defenderAfter: emptyFleetShips(),
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "draw",
      rounds: 1,
      summary: "Drill",
    };
    universe.reports[report.id] = report;
    universe.spyReports.spy1 = {
      id: "spy1",
      at: 3,
      missionId: "m",
      spyPlayerId: player.id,
      targetPlayerId: other.id,
      targetName: other.name,
      targetCoords: { galaxy: 1, system: 1, slot: 5 },
      detail: 1,
      resources: null,
      buildings: null,
      ships: null,
      defenses: null,
      research: null,
      summary: "Scan",
    };
    universe.expeditionReports.exp1 = {
      id: "exp1",
      at: 4,
      missionId: "m",
      playerId: player.id,
      targetCoords: { galaxy: 1, system: 9, slot: 16 },
      kind: "nothing",
      cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
      shipsDelta: {},
      summary: "Empty",
    };

    const alerts = deletePlayerMessages(universe, player.id, "alerts");
    assert.equal(alerts.ok, true);
    assert.equal(player.eventLog?.length, 0);
    assert.ok(universe.reports[report.id]);
    assert.ok(universe.spyReports.spy1);

    const combat = deletePlayerMessages(universe, player.id, "combat");
    assert.equal(combat.ok, true);
    assert.equal(universe.expeditionReports.exp1, undefined);
    assert.ok(universe.reports[report.id]);
    assert.ok(player.hiddenReportIds?.includes(report.id));
    const hidden = playerView(universe, player.id, 171_000_100);
    assert.equal(
      hidden.reports.some((row) => row.id === report.id),
      false,
    );
    const stillThere = playerView(universe, other.id, 171_000_100);
    assert.equal(
      stillThere.reports.some((row) => row.id === report.id),
      true,
    );

    deletePlayerMessages(universe, other.id, "combat");
    assert.equal(universe.reports[report.id], undefined);

    const spy = deletePlayerMessages(universe, player.id, "spy");
    assert.equal(spy.ok, true);
    assert.equal(universe.spyReports.spy1, undefined);
  });

  it("migrates owned skills and officers to level 1 without wiping the save", () => {
    const universe = createUniverse("Migrate Levels", 8);
    const a = joinUniverse(universe, "Keeper", 172_000_000);
    const player = universe.players[a.player.id]!;
    const homeId = player.homePlanetId;
    const metal = universe.planets[homeId]!.resources.metal;
    player.skillsUnlocked = ["eco_mines_1", "mil_slots_1"];
    delete player.skillLevels;
    player.officers = [
      {
        officerId: "engineer",
        activatedAt: 172_000_000,
        expiresAt: 172_000_000 + 86_400_000,
      },
    ];
    delete player.officerLevels;

    ensureUniverseShape(universe);

    assert.equal(player.skillLevels?.eco_mines_1, 1);
    assert.equal(player.skillLevels?.mil_slots_1, 1);
    assert.equal(player.officerLevels?.engineer, 1);
    assert.equal(player.name, "Keeper");
    assert.equal(player.homePlanetId, homeId);
    assert.equal(universe.planets[homeId]!.resources.metal, metal);
    const boosts = playerBoosts(player, 172_000_100);
    assert.equal(boosts.mineOutput, 1.05);
    assert.equal(boosts.energyOutput, 1.15);
    assert.equal(boosts.fleetSlots, 1);
  });

  it("scales skill and officer effects and costs through level 10", () => {
    assert.equal(levelUpCost(SKILLS.eco_mines_1.cost, 0), 25);
    assert.equal(levelUpCost(SKILLS.eco_mines_1.cost, 1), 50);
    assert.equal(levelUpCost(OFFICERS.quartermaster.cost, 9), 500);
    const mine = scaleEffect({ kind: "mineOutput", value: 1.05 }, 1);
    assert.equal(mine.value, 1.05);
    const maxMine = scaleEffect({ kind: "mineOutput", value: 1.05 }, 10);
    assert.ok(Math.abs(maxMine.value - 1.5) < 1e-9);
    const slots = scaleEffect({ kind: "fleetSlots", value: 1 }, 1);
    assert.equal(slots.value, 1);
    const maxSlots = scaleEffect({ kind: "fleetSlots", value: 1 }, 10);
    assert.equal(maxSlots.value, 4);

    const universe = createUniverse("Train", 8);
    const a = joinUniverse(universe, "Adept", 173_000_000);
    const player = universe.players[a.player.id]!;
    player.starshards = 500;
    const now = 173_000_100;
    assert.equal(unlockSkill(universe, player.id, "eco_mines_1", now).ok, true);
    assert.equal(skillLevelOf(player, "eco_mines_1"), 1);
    assert.equal(unlockSkill(universe, player.id, "eco_mines_1", now).ok, true);
    assert.equal(player.skillLevels?.eco_mines_1, 2);
    assert.equal(playerBoosts(player, now).mineOutput, 1.1);

    assert.equal(raiseOfficer(universe, player.id, "quartermaster", now).ok, false);
    assert.equal(activateOfficer(universe, player.id, "quartermaster", now).ok, true);
    assert.equal(player.officerLevels?.quartermaster, 1);
    assert.equal(raiseOfficer(universe, player.id, "quartermaster", now).ok, true);
    assert.equal(player.officerLevels?.quartermaster, 2);
    assert.ok(Math.abs(playerBoosts(player, now).mineOutput - 1.1 * 1.2) < 1e-9);

    player.officerLevels!.quartermaster = 10;
    const capped = raiseOfficer(universe, player.id, "quartermaster", now);
    assert.equal(capped.ok, false);
    if (!capped.ok) assert.match(capped.error, /max level/);
    assert.equal(player.starshards! > 0, true);
  });
});
