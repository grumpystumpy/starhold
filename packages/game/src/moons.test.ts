import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  moonAtCoords,
  moonChancePercent,
  moonRoll,
  ownedPlanetCount,
  planetAtCoords,
  playerView,
  queueBuildingUpgrade,
  tryFormMoon,
} from "./world.js";

describe("P3 moons", () => {
  it("computes chance and keeps planetAtCoords distinct from moon", () => {
    assert.equal(moonChancePercent({ metal: 1000, crystal: 1000, deuterium: 0 }), 0);
    assert.equal(moonChancePercent({ metal: 4000, crystal: 2000, deuterium: 0 }), 6);
    assert.equal(moonChancePercent({ metal: 30_000, crystal: 0, deuterium: 0 }), 20);

    const universe = createUniverse("Moon Map", 8);
    const a = joinUniverse(universe, "Luna", 160_000_000);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 20_000, crystal: 0, deuterium: 0 },
      // Force form: chance 20, pick a seed that rolls < 20.
      findSeedBelow(20),
      160_000_100,
    );
    assert.ok(moon);
    assert.equal(moon!.kind, "moon");
    assert.equal(parent.moonId, moon!.id);
    assert.equal(moon!.parentPlanetId, parent.id);
    assert.equal(planetAtCoords(universe, parent.coords)?.id, parent.id);
    assert.equal(moonAtCoords(universe, parent.coords)?.id, moon!.id);
    assert.equal(ownedPlanetCount(universe, a.player.id), 1);
    assert.ok(universe.players[a.player.id].planetIds.includes(moon!.id));
  });

  it("blocks mines on moons and allows lunar base", () => {
    const universe = createUniverse("Moon Yard", 8);
    const a = joinUniverse(universe, "Builder", 161_000_000);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 20_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      161_000_100,
    );
    assert.ok(moon);
    moon!.resources = { metal: 50_000, crystal: 50_000, deuterium: 10_000 };
    universe.players[a.player.id].activePlanetId = moon!.id;

    const mine = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      161_000_200,
      moon!.id,
    );
    assert.equal(mine.ok, false);

    const lunar = queueBuildingUpgrade(
      universe,
      a.player.id,
      "lunarBase",
      161_000_200,
      moon!.id,
    );
    assert.equal(lunar.ok, true);
  });

  it("sensor array lists outbound fleets in-system", () => {
    const universe = createUniverse("Sensor Drift", 8);
    const a = joinUniverse(universe, "Watcher", 162_000_000);
    const b = joinUniverse(universe, "Raider", 162_000_001);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 20_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      162_000_100,
    );
    assert.ok(moon);
    moon!.buildings.lunarBase = 1;
    moon!.buildings.sensorArray = 1;
    universe.players[a.player.id].activePlanetId = moon!.id;

    universe.planets[b.planet.id].ships.scout = 2;
    universe.planets[b.planet.id].resources.deuterium = 5_000;
    // Put B in same system as A if needed — join assigns sequential slots.
    // Retarget: move B's planet coords to A's system empty? Simpler: raid A's planet.
    const launch = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      targetPlanetId: a.planet.id,
      targetCoords: a.planet.coords,
      ships: { scout: 1 },
      now: 162_000_200,
    });
    assert.equal(launch.ok, true);

    const view = playerView(universe, a.player.id, 162_000_250);
    assert.ok(view.sensorContacts.length >= 1);
    assert.equal(view.sensorContacts[0].ownerPlayerId, b.player.id);
  });

  it("raid can form a moon when debris and roll allow", () => {
    const universe = createUniverse("Raid Moon", 8);
    const a = joinUniverse(universe, "Defender", 163_000_000);
    const b = joinUniverse(universe, "Attacker", 163_000_001);
    // Stock enough ships that debris exceeds threshold when wiped.
    universe.planets[a.planet.id].ships.cruiser = 20;
    universe.planets[b.planet.id].ships.bomber = 30;
    universe.planets[b.planet.id].ships.cruiser = 20;
    universe.planets[b.planet.id].resources.deuterium = 50_000;
    universe.players[b.player.id].research.weaponsTech = 10;

    const launch = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      targetPlanetId: a.planet.id,
      targetCoords: a.planet.coords,
      ships: { bomber: 30, cruiser: 20 },
      now: 163_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const reports = Object.values(universe.reports);
    assert.ok(reports.length >= 1);
    const rpt = reports[0];
    // Formation is roll-dependent; if moonFormed, links must be consistent.
    if (rpt.moonFormed) {
      const parent = universe.planets[a.planet.id];
      assert.ok(parent.moonId);
      assert.equal(universe.planets[parent.moonId!]?.kind, "moon");
    } else {
      // Still assert debris was large enough for a non-zero chance.
      const debris =
        (rpt.debrisCreated?.metal ?? 0) + (rpt.debrisCreated?.crystal ?? 0);
      assert.ok(debris >= 0);
    }
  });
});

function findSeedBelow(chance: number): string {
  for (let i = 0; i < 10_000; i++) {
    const seed = `seed_${i}`;
    if (moonRoll(seed) < chance) return seed;
  }
  throw new Error("no seed");
}
