import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRaidLoot,
  coordDistance,
  flightSecondsOneWay,
  fleetCombatPower,
  resolveCombat,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  playerView,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("fleet formulas", () => {
  it("measures coordinate distance", () => {
    assert.equal(
      coordDistance(
        { galaxy: 1, system: 1, slot: 1 },
        { galaxy: 1, system: 1, slot: 3 },
      ),
      2,
    );
    assert.equal(
      coordDistance(
        { galaxy: 1, system: 1, slot: 1 },
        { galaxy: 1, system: 2, slot: 1 },
      ),
      10,
    );
  });

  it("keeps a readable minimum flight time", () => {
    const ships = { scout: 1, hauler: 0, interceptor: 0 };
    const secs = flightSecondsOneWay(
      { galaxy: 1, system: 1, slot: 1 },
      { galaxy: 1, system: 1, slot: 2 },
      ships,
      8,
    );
    assert.ok(secs >= 8, `flight ${secs}`);
  });

  it("resolves unopposed raid as attacker win with loot cap", () => {
    const atk = { scout: 2, hauler: 1, interceptor: 0 };
    const def = { scout: 0, hauler: 0, interceptor: 0 };
    const combat = resolveCombat(atk, def);
    assert.equal(combat.outcome, "attacker_win");
    const loot = computeRaidLoot(
      { metal: 1000, crystal: 400, deuterium: 200 },
      combat.attackerAfter,
    );
    // Hauler cargo 5000 dominates — loot is 50% of stocks.
    assert.equal(loot.metal, 500);
    assert.equal(loot.crystal, 200);
    assert.equal(loot.deuterium, 100);
  });

  it("favors stronger defender", () => {
    const atk = { scout: 1, hauler: 0, interceptor: 0 };
    const def = { scout: 0, hauler: 0, interceptor: 5 };
    assert.ok(fleetCombatPower(def) > fleetCombatPower(atk) * 1.1);
    const combat = resolveCombat(atk, def);
    assert.equal(combat.outcome, "defender_win");
  });
});

describe("launchFleet + travel resolve", () => {
  it("Drift Beacons add fleet slots and fleet launch enforcement uses the added cap", () => {
    const universe = createUniverse("Beacon Fleet Cap", 8);
    const a = joinUniverse(universe, "Beacon Admiral", 9_000_000);
    const b = joinUniverse(universe, "Destination", 9_000_001);
    const mini = universe.planets[universe.miniPlanetIds![0]!]!;
    mini.ownerPlayerId = a.player.id;
    a.player.planetIds.push(mini.id);
    mini.buildings.driftBeacon = 1;
    universe.planets[a.planet.id]!.ships.scout = 3;
    universe.planets[a.planet.id]!.resources.deuterium = 10_000;

    const first = launchFleet(universe, a.player.id, b.planet.id, "deploy", { scout: 1 }, 9_000_100);
    const second = launchFleet(universe, a.player.id, b.planet.id, "deploy", { scout: 1 }, 9_000_200);
    const overCap = launchFleet(universe, a.player.id, b.planet.id, "deploy", { scout: 1 }, 9_000_300);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(overCap.ok, false);
    if (!overCap.ok) assert.match(overCap.error, /fleet slot limit/i);
  });

  it("deploy round-trips ships home without combat", () => {
    const universe = createUniverse("Fleet Drift", 8);
    const a = joinUniverse(universe, "Alpha", 10_000_000);
    const b = joinUniverse(universe, "Bravo", 10_000_001);
    universe.planets[a.planet.id].ships.scout = 3;
    universe.planets[a.planet.id].resources.deuterium = 200;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "deploy",
      { scout: 2 },
      10_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    assert.equal(universe.planets[a.planet.id].ships.scout, 1);
    assert.equal(launch.fleet.phase, "outbound");
    assert.equal(Object.keys(universe.reports).length, 0);

    // Jump to arrival.
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid, "fleet should still exist on return leg");
    assert.equal(mid.phase, "returning");
    assert.equal(mid.reportId, null);

    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.equal(universe.planets[a.planet.id].ships.scout, 3);
  });

  it("raid loots defender and returns cargo", () => {
    const universe = createUniverse("Raid Drift", 8);
    const a = joinUniverse(universe, "Raider", 20_000_000);
    const b = joinUniverse(universe, "Victim", 20_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 5;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources.deuterium = 500;
    universe.planets[b.planet.id].resources.metal = 2000;
    universe.planets[b.planet.id].resources.crystal = 800;
    universe.planets[b.planet.id].ships.scout = 0;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 5, hauler: 1 },
      20_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");
    assert.ok(mid.reportId);
    const report = universe.reports[mid.reportId!];
    assert.equal(report.outcome, "attacker_win");
    assert.ok(report.loot.metal > 0);
    assert.ok(
      universe.planets[b.planet.id].resources.metal < 2000,
      "defender should lose metal",
    );

    const metalBeforeReturn = universe.planets[a.planet.id].resources.metal;
    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.ok(
      universe.planets[a.planet.id].resources.metal > metalBeforeReturn,
      "loot should dock",
    );
    assert.ok(universe.planets[a.planet.id].ships.scout >= 1);

    const view = playerView(universe, a.player.id, mid.arrivesAt + 1);
    assert.ok(view.reports.length >= 1);
    assert.equal(view.fleets.length, 0);
  });

  it("rejects raid without ships or fuel", () => {
    const universe = createUniverse("Reject Drift", 8);
    const a = joinUniverse(universe, "Poor", 30_000_000);
    const b = joinUniverse(universe, "Rich", 30_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    const empty = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 1 },
      30_000_100,
    );
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.match(empty.error, /hangar|ship/i);

    universe.planets[a.planet.id].ships.scout = 1;
    universe.planets[a.planet.id].resources.deuterium = 0;
    const noFuel = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 1 },
      30_000_200,
    );
    assert.equal(noFuel.ok, false);
    if (noFuel.ok) return;
    assert.match(noFuel.error, /deuterium|fuel/i);
  });
});
