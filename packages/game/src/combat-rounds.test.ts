import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rapidFireFactor } from "./catalog.js";
import {
  fleetCombatPower,
  normalizeFleetShips,
  resolveCombat,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("P2 multi-round combat + rapid fire", () => {
  it("unopposed landing is attacker_win with full survivors", () => {
    const combat = resolveCombat(
      normalizeFleetShips({ scout: 2, hauler: 1 }),
      normalizeFleetShips({}),
    );
    assert.equal(combat.outcome, "attacker_win");
    assert.equal(combat.rounds, 0);
    assert.equal(combat.attackerAfter.scout, 2);
    assert.equal(combat.attackerAfter.hauler, 1);
  });

  it("stronger hangar holds — 5 interceptors beat 1 scout", () => {
    const atk = normalizeFleetShips({ scout: 1 });
    const def = normalizeFleetShips({ interceptor: 5 });
    assert.ok(fleetCombatPower(def) > fleetCombatPower(atk) * 1.1);
    const combat = resolveCombat(atk, def);
    assert.equal(combat.outcome, "defender_win");
    assert.ok(combat.rounds >= 1);
    assert.equal(combat.attackerAfter.scout, 0);
  });

  it("one cruiser beats two interceptors across rounds", () => {
    const combat = resolveCombat(
      normalizeFleetShips({ cruiser: 1 }),
      normalizeFleetShips({ interceptor: 2 }),
    );
    assert.equal(combat.outcome, "attacker_win");
    assert.ok(combat.rounds >= 1 && combat.rounds <= 6);
    assert.equal(combat.defenderAfter.interceptor, 0);
    assert.ok((combat.attackerAfter.cruiser ?? 0) >= 1);
  });

  it("rapid fire multiplies interceptor damage vs probes", () => {
    assert.equal(rapidFireFactor("interceptor", "probe"), 5);
    const combat = resolveCombat(
      normalizeFleetShips({ interceptor: 2 }),
      normalizeFleetShips({ probe: 40 }),
    );
    assert.equal(combat.outcome, "attacker_win");
    assert.ok(
      combat.rounds <= 2,
      `expected probes cleared quickly with RF, got ${combat.rounds} rounds`,
    );
    assert.equal(combat.defenderAfter.probe, 0);
  });

  it("raid report includes rounds from multi-round engine", () => {
    const universe = createUniverse("Round Drift", 8);
    const a = joinUniverse(universe, "Atk", 130_000_000);
    const b = joinUniverse(universe, "Def", 130_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 3;
    universe.planets[a.planet.id].resources.deuterium = 500;
    universe.planets[b.planet.id].ships.scout = 1;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 3 },
      130_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const report = Object.values(universe.reports)[0];
    assert.ok(report);
    assert.ok(typeof report.rounds === "number");
    assert.ok(report.rounds >= 1);
    assert.match(report.summary, /round/i);
  });
});
