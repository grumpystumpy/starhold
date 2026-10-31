import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
} from "./world.js";
import { normalizeFleetShips } from "./formulas.js";
import { createMiniPlanet } from "./world-mini.js";

describe("Occupation fleet mission (B7-12)", () => {
  it("rejects launch without a Mothership", () => {
    const universe = createUniverse("Occ Test 1", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.scout = 5;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { scout: 5 },
      now: 100_000_100,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /Mothership/);
    }
  });

  it("rejects non-mini targets", () => {
    const universe = createUniverse("Occ Test 2", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const b = joinUniverse(universe, "PlayerB", 100_000_001);

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: b.planet.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /mini planet/i);
    }
  });

  it("accepts launch with Mothership targeting a mini planet", () => {
    const universe = createUniverse("Occ Test 3", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(res.ok, true);
  });

  it("winning arrival with surviving Mothership captures and occupies the mini planet", () => {
    const universe = createUniverse("Occ Test 4", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const b = joinUniverse(universe, "Defender", 100_000_001);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    mini.ownerPlayerId = b.player.id;
    b.player.planetIds.push(mini.id);
    mini.ships = normalizeFleetShips({ scout: 2 });
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].ships.interceptor = 50;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1, interceptor: 50 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Mini should be captured by attacker
    assert.equal(universe.planets[mini.id]?.ownerPlayerId, a.player.id);
    // Occupation state should be set
    const occ = universe.occupations?.[mini.id];
    assert.ok(occ, "Occupation state should exist");
    assert.equal(occ.occupierPlayerId, a.player.id);
    assert.equal(occ.mothershipFleetId, launch.fleet.id);
  });

  it("losing arrival does not capture or occupy the mini planet", () => {
    const universe = createUniverse("Occ Test 5", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const b = joinUniverse(universe, "Defender", 100_000_001);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    mini.ownerPlayerId = b.player.id;
    b.player.planetIds.push(mini.id);
    // Huge defense to crush attacker
    mini.ships = normalizeFleetShips({ cruiser: 100 });
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Owner should still be defender
    assert.equal(universe.planets[mini.id]?.ownerPlayerId, b.player.id);
    // Occupation should not exist
    assert.equal(universe.occupations?.[mini.id], undefined);
  });

  it("unoccupied mini planet arrival with surviving Mothership captures and occupies", () => {
    const universe = createUniverse("Occ Test 6", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    // Unoccupied
    mini.ownerPlayerId = "";
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    assert.equal(universe.planets[mini.id]?.ownerPlayerId, a.player.id);
    const occ = universe.occupations?.[mini.id];
    assert.ok(occ, "Occupation state should exist");
    assert.equal(occ.occupierPlayerId, a.player.id);
  });

  it("respects one-per-player limit on fortress/relic capture during occupy mission", () => {
    const universe = createUniverse("Occ Test 7", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    // Already owns a fortress
    const heldFortress = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 21, 100_000_000, "fortress");
    heldFortress.ownerPlayerId = a.player.id;
    universe.planets[heldFortress.id] = heldFortress;
    a.player.planetIds.push(heldFortress.id);

    // Target another fortress
    const targetFortress = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 22, 100_000_000, "fortress");
    targetFortress.ownerPlayerId = "";
    universe.planets[targetFortress.id] = targetFortress;
    universe.miniPlanetIds = [heldFortress.id, targetFortress.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: targetFortress.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Target fortress should not be captured or occupied
    assert.notEqual(universe.planets[targetFortress.id]?.ownerPlayerId, a.player.id);
    assert.equal(universe.occupations?.[targetFortress.id], undefined);
  });
});
