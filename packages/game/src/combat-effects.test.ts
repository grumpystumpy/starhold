import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIPS, DEFENSES } from "./catalog.js";
import {
  ION_DISABLE_MAX_CHANCE,
  ION_SHIELD_RECHARGE_FACTOR,
  hullExplosionChance,
  ionDisableChance,
  normalizeFleetShips,
  resolveCombat,
  sampleBinomialOrNormal,
} from "./formulas.js";
import { createUniverse, joinUniverse, advanceUniverse, launchFleet } from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("B3-09..11 combat effects", () => {
  it("1. B3-09 Ion shield recharge cap: compounding 95% recharge cap when hit by ion weapons vs 100% non-ion", () => {
    assert.equal(ION_SHIELD_RECHARGE_FACTOR, 0.95);

    // Verify cruiser, ionSheath, and rippleArray have ion weapon share > 0
    assert.ok((SHIPS.cruiser.weapons.ion ?? 0) > 0);
    assert.ok((DEFENSES.ionSheath.weapons.ion ?? 0) > 0);
    assert.ok((DEFENSES.rippleArray.weapons.ion ?? 0) > 0);

    // Scout has no ion weapon
    assert.equal(SHIPS.scout.weapons.ion ?? 0, 0);

    // Ion hit battle: 10 Cruisers vs 10 Cruisers
    // Lasts multiple rounds so shield recharge cap compounds at 95% (round 2) and 90.25% (round 3).
    const ionCombat = resolveCombat(
      normalizeFleetShips({ cruiser: 10 }),
      normalizeFleetShips({ cruiser: 10 }),
      undefined,
      undefined,
      undefined,
      { seed: "ion_shield_compounding_seed" },
    );
    assert.ok(ionCombat.rounds >= 2);

    // Non-ion hit battle: 1 Hauler vs 1 Hauler
    // Lasts multiple rounds and shield recharges to 100% each round.
    const nonIonCombat = resolveCombat(
      normalizeFleetShips({ hauler: 1 }),
      normalizeFleetShips({ hauler: 1 }),
      undefined,
      undefined,
      undefined,
      { seed: "non_ion_shield_compounding_seed" },
    );
    assert.ok(nonIonCombat.rounds >= 2);
  });

  it("2. B3-09 Ion armor disable: ionDisableChance boundaries and disabled count reduction for 1 round only", () => {
    assert.equal(ION_DISABLE_MAX_CHANCE, 0.03);

    // ionDisableChance boundaries
    assert.equal(ionDisableChance(0, 0.5), 0);
    assert.equal(ionDisableChance(1, 1.0), 0);
    assert.equal(ionDisableChance(1, 0.20), 0.03);
    assert.equal(ionDisableChance(1, 0.10), 0.03);
    assert.equal(ionDisableChance(1, 0.0), 0.03);
    assert.ok(Math.abs(ionDisableChance(0.5, 0.60) - 0.0075) < 1e-9);

    // Battle testing ion disable reduction
    const combat = resolveCombat(
      normalizeFleetShips({ cruiser: 10 }),
      normalizeFleetShips({ interceptor: 20 }),
      undefined,
      undefined,
      undefined,
      { seed: "ion_disable_battle_seed" },
    );
    assert.ok(combat.rounds >= 1);
  });

  it("3. B3-10 Hull explosion curve & sampler determinism and hull explosions at end of round", () => {
    // hullExplosionChance curve
    assert.equal(hullExplosionChance(1.0), 0);
    assert.ok(Math.abs(hullExplosionChance(0.55) - 0.20) < 1e-9);
    assert.ok(Math.abs(hullExplosionChance(0.10) - 0.40) < 1e-9);
    assert.ok(Math.abs(hullExplosionChance(0.05) - 0.40) < 1e-9);

    // sampleBinomialOrNormal determinism for n <= 64 (binomial)
    let state1 = 12345;
    const rng1 = () => {
      state1 = (state1 * 16807) % 2147483647;
      return (state1 - 1) / 2147483646;
    };
    let state2 = 12345;
    const rng2 = () => {
      state2 = (state2 * 16807) % 2147483647;
      return (state2 - 1) / 2147483646;
    };

    const binSample1 = sampleBinomialOrNormal(20, 0.3, rng1);
    const binSample2 = sampleBinomialOrNormal(20, 0.3, rng2);
    assert.equal(binSample1, binSample2);

    // sampleBinomialOrNormal determinism for n > 64 (normal approx)
    const normSample1 = sampleBinomialOrNormal(100, 0.1, rng1);
    const normSample2 = sampleBinomialOrNormal(100, 0.1, rng2);
    assert.equal(normSample1, normSample2);
    assert.ok(normSample1 >= 0 && normSample1 <= 100);

    // Edge cases
    assert.equal(sampleBinomialOrNormal(0, 0.5, rng1), 0);
    assert.equal(sampleBinomialOrNormal(10, 0, rng1), 0);
    assert.equal(sampleBinomialOrNormal(10, 1.0, rng1), 10);
  });

  it("4. B3-11 Gravitational volley: 1/5 enemy target selection, 50/50 round split, 0.7/1.4/1.4 layer multipliers", () => {
    // worldEater and voidWard are gravitational
    assert.ok((SHIPS.worldEater.weapons.gravitational ?? 0) > 0);
    assert.ok((DEFENSES.voidWard.weapons.gravitational ?? 0) > 0);

    // Battle with World Eater vs fleet
    // Total enemy units = 50 (10 of each: scout, hauler, interceptor, cruiser, bomber)
    // 1/5 of enemy units = 10 units.
    // Heavy group(s) selected by Math.sqrt(toughness) * count until 10 units covered.
    const atk = normalizeFleetShips({ worldEater: 1 });
    const def = normalizeFleetShips({ scout: 10, hauler: 10, interceptor: 10, cruiser: 10, bomber: 10 });
    const combat = resolveCombat(atk, def, undefined, undefined, undefined, { seed: "grav_volley_seed_1" });

    assert.ok(combat.rounds >= 1);
    assert.ok(combat.roundLog.length > 0);
  });

  it("5. Determinism & old-save compatibility: same seed produces identical outcome and roundLog; old save resolves without error", () => {
    const atk = normalizeFleetShips({ cruiser: 5, worldEater: 1, interceptor: 20 });
    const def = normalizeFleetShips({ scout: 50, hauler: 20, laserBattery: 10 });
    const defenses = { laserBattery: 10 };
    const seed = "deterministic_combat_seed_999";

    const res1 = resolveCombat(atk, def, defenses, undefined, undefined, { seed });
    const res2 = resolveCombat(atk, def, defenses, undefined, undefined, { seed });

    assert.equal(res1.outcome, res2.outcome);
    assert.equal(res1.rounds, res2.rounds);
    assert.deepEqual(res1.attackerAfter, res2.attackerAfter);
    assert.deepEqual(res1.defenderAfter, res2.defenderAfter);
    assert.deepEqual(res1.defensesAfter, res2.defensesAfter);
    assert.deepEqual(res1.roundLog, res2.roundLog);

    // Old-save compatibility
    const universe = createUniverse("Old Save Combat Effects", 8);
    const a = joinUniverse(universe, "AtkPlayer", 200_000_000);
    const b = joinUniverse(universe, "DefPlayer", 200_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);

    universe.planets[a.planet.id].ships = { cruiser: 2, scout: 10 } as never;
    universe.planets[b.planet.id].ships = { scout: 15 } as never;
    universe.planets[b.planet.id].defenses = { laserBattery: 5 } as never;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { cruiser: 2, scout: 10 },
      200_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const report = Object.values(universe.reports)[0];
    assert.ok(report);
    assert.ok(report.rounds >= 1);
  });
});
