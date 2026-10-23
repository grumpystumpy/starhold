import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILDINGS } from "./catalog.js";
import { buildingUpgradeCost } from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  playerView,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("P0/P1 parity — lab & research", () => {
  it("research lab L0→L1 needs metal+crystal only (no deut)", () => {
    assert.equal(BUILDINGS.researchLab.baseCost.deuterium, 0);
    const cost = buildingUpgradeCost("researchLab", 0);
    assert.equal(cost.deuterium, 0);
    assert.ok(cost.metal > 0 && cost.crystal > 0);
  });

  it("queues research after lab upgrade", () => {
    const universe = createUniverse("Lab Drift", 8);
    const { player, planet } = joinUniverse(universe, "Scientist", 40_000_000);
    planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 50_000 };

    let now = 40_000_100;
    for (let level = 0; level < 3; level += 1) {
      const lab = queueBuildingUpgrade(universe, player.id, "researchLab", now);
      assert.equal(lab.ok, true);
      if (!lab.ok) return;
      const completesAt = lab.planet.buildQueue[0]!.completesAt;
      advanceUniverse(universe, completesAt);
      now = completesAt + 1;
    }

    const research = queueResearch(
      universe,
      player.id,
      "espionageTech",
      now,
    );
    assert.equal(research.ok, true);
    if (!research.ok) return;
    assert.ok(universe.players[player.id].researchQueue[0]);
    advanceUniverse(
      universe,
      universe.players[player.id].researchQueue[0]!.completesAt,
    );
    assert.equal(universe.players[player.id].research.espionageTech, 1);
  });

  it("builds defenses that fight in raids", () => {
    const universe = createUniverse("Defense Drift", 8);
    const a = joinUniverse(universe, "Attacker", 50_000_000);
    const b = joinUniverse(universe, "Defender", 50_000_001);
    universe.planets[a.planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    universe.planets[b.planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    universe.planets[b.planet.id].buildings.shipyard = 1;

    const def = queueDefenseBuild(
      universe,
      b.player.id,
      "laserBattery",
      10,
      50_000_100,
    );
    assert.equal(def.ok, true);
    if (!def.ok) return;
    advanceUniverse(universe, def.planet.defenseQueue[0]!.completesAt);
    assert.equal(universe.planets[b.planet.id].defenses.laserBattery, 10);

    universe.planets[a.planet.id].ships.scout = 1;
    universe.planets[a.planet.id].resources.deuterium = 500;
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 1 },
      50_000_200,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const report = Object.values(universe.reports)[0];
    assert.ok(report);
    assert.ok(report.defensesBefore.laserBattery >= 1);
    // 10 lasers should crush 1 scout.
    assert.equal(report.outcome, "defender_win");
  });

  it("espionage produces a spy report", () => {
    const universe = createUniverse("Spy Drift", 8);
    const a = joinUniverse(universe, "Spy", 60_000_000);
    const b = joinUniverse(universe, "Target", 60_000_001);
    universe.planets[a.planet.id].buildings.shipyard = 1;
    universe.planets[a.planet.id].ships.probe = 2;
    universe.planets[a.planet.id].resources.deuterium = 200;
    universe.players[a.player.id].research.espionageTech = 3;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      targetPlanetId: b.planet.id,
      mission: "espionage",
      ships: { probe: 1 },
      now: 60_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    assert.ok(Object.keys(universe.spyReports).length >= 1);
    const view = playerView(universe, a.player.id, launch.fleet.arrivesAt + 1);
    assert.ok(view.spyReports.length >= 1);
    assert.ok((view.spyReports[0].detail ?? 0) >= 1);
  });

});
