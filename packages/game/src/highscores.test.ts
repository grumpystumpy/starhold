import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { researchUpgradeCost } from "./formulas-build.js";
import {
  emptyDefenses,
  emptyFleetShips,
  planetPoints,
  researchPoints,
  roughPoints,
} from "./formulas.js";
import {
  createUniverse,
  empirePoints,
  highscoresBoard,
  joinUniverse,
  launchFleet,
  playerView,
} from "./world.js";
import { emptyBuildings } from "./world-bootstrap.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("P2 highscores", () => {
  it("counts research once across two colonies", () => {
    const universe = createUniverse("Score Drift", 8);
    const a = joinUniverse(universe, "Scorer", 150_000_000);
    const player = universe.players[a.player.id];
    player.research.energyTech = 5;
    player.research.weaponsTech = 4;
    player.research.armourTech = 3;

    const home = universe.planets[a.planet.id];
    home.buildings.metalMine = 8;
    home.buildings.crystalMine = 6;
    home.buildings.solarPlant = 6;
    home.ships.scout = 10;
    const colonyId = "colony-score-1";
    universe.planets[colonyId] = {
      id: colonyId,
      ownerPlayerId: player.id,
      name: "Colony",
      coords: {
        galaxy: home.coords.galaxy,
        system: home.coords.system,
        slot: home.coords.slot === 1 ? 2 : 1,
      },
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      lastTickAt: home.lastTickAt,
      buildings: {
        ...emptyBuildings(),
        metalMine: 5,
        crystalMine: 4,
        solarPlant: 4,
      },
      ships: emptyFleetShips(),
      defenses: emptyDefenses(),
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    };
    player.planetIds.push(colonyId);

    const rp = researchPoints(player.research);
    const homePts = planetPoints(home);
    const colonyPts = planetPoints(universe.planets[colonyId]);
    const empire = empirePoints(universe, player);

    assert.ok(rp > 1);
    assert.ok(colonyPts > 1);
    assert.equal(empire, Math.floor(homePts + colonyPts + rp));
    // Naive per-planet roughPoints would count research twice.
    const naive =
      roughPoints(home, player.research) +
      roughPoints(universe.planets[colonyId], player.research);
    assert.ok(naive > empire);
  });

  it("includes in-flight ships in empire points", () => {
    const universe = createUniverse("Fleet Score", 8);
    const a = joinUniverse(universe, "Flyer", 151_000_000);
    const b = joinUniverse(universe, "Target", 151_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 3;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    const before = empirePoints(universe, universe.players[a.player.id]);

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      targetPlanetId: b.planet.id,
      targetCoords: b.planet.coords,
      ships: { scout: 2 },
      now: 151_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    const after = empirePoints(universe, universe.players[a.player.id]);
    // Two scouts left the hangar but remain in the fleet — points unchanged.
    assert.equal(after, before);
    assert.ok(Object.keys(universe.fleets).length >= 1);
  });

  it("ranks by points with playerId tie-break", () => {
    const universe = createUniverse("Rank Drift", 8);
    const early = joinUniverse(universe, "Alpha", 152_000_000);
    const late = joinUniverse(universe, "Bravo", 152_000_001);
    universe.planets[early.planet.id].ships.scout = 5;
    universe.players[late.player.id].research.energyTech = 3;

    const board = highscoresBoard(universe);
    assert.equal(board.length, 2);
    assert.equal(board[0].rank, 1);
    assert.equal(board[1].rank, 2);
    assert.ok(board[0].points >= board[1].points);
    if (board[0].points === board[1].points) {
      assert.ok(board[0].playerId < board[1].playerId);
    }

    const view = playerView(universe, early.player.id, 152_000_200);
    assert.ok(view.highscores.length >= 2);
    assert.equal(view.highscores[0].rank, 1);
    const self = view.highscores.find((h) => h.playerId === early.player.id);
    assert.ok(self);
    assert.equal(self!.points, empirePoints(universe, universe.players[early.player.id]));
    assert.equal(self!.planetCount, 1);

    // energyTech L1+L2+L3 costs should beat 5 scouts or not — just ensure board is sorted.
    for (let i = 1; i < view.highscores.length; i++) {
      assert.ok(view.highscores[i - 1].points >= view.highscores[i].points);
    }

    // Sanity: research helper matches catalog costs.
    let expectedResearch = 0;
    for (let L = 0; L < 3; L++) {
      const c = researchUpgradeCost("energyTech", L);
      expectedResearch += (c.metal + c.crystal + c.deuterium) / 1000;
    }
    assert.equal(
      researchPoints(universe.players[late.player.id].research),
      expectedResearch,
    );
  });
});
