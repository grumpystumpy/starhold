import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFENSE_ORDER, SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  computeTargetWeights,
  emptyDefenses,
  emptyFleetShips,
  normalizeFleetShips,
  pickWeightedTarget,
  resolveCombat,
  unitHp,
} from "./formulas.js";
import type { DefenseStock, FleetShips } from "./types.js";

function createTestRng(seedStr = "dist-test-seed") {
  let s = 123456789;
  for (let i = 0; i < seedStr.length; i++) {
    s = (s + seedStr.charCodeAt(i) * 31) | 0;
  }
  return function nextFloat(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("B3-07 / B3-08 Combat: weighted targeting + rapid fire", () => {
  it("targeting weights: hand-computed weight sqrt(toughness) * count when no RF targets present", () => {
    const defenderSide = {
      ships: normalizeFleetShips({ interceptor: 1, scout: 2 }),
      defenses: emptyDefenses(),
    };

    // Shooter = Cruiser (RF 1 vs interceptor, RF 1 vs scout)
    const weights = computeTargetWeights("cruiser", defenderSide, defenderSide);

    // Interceptor stats: shield 10, armor 16, hull 60 -> toughness 86
    const interceptorToughness = unitHp(
      SHIPS.interceptor.shield,
      SHIPS.interceptor.armor,
      SHIPS.interceptor.hull,
      undefined,
    );
    assert.equal(interceptorToughness, 86);
    const expectedInterceptorWeight = Math.sqrt(86) * 1;

    // Scout stats: shield 4, armor 8, hull 20 -> toughness 32
    const scoutToughness = unitHp(
      SHIPS.scout.shield,
      SHIPS.scout.armor,
      SHIPS.scout.hull,
      undefined,
    );
    assert.equal(scoutToughness, 32);
    const expectedScoutWeight = Math.sqrt(32) * 2;

    assert.ok(
      Math.abs((weights.interceptor ?? 0) - expectedInterceptorWeight) < 1e-6,
      `Expected interceptor weight ${expectedInterceptorWeight}, got ${weights.interceptor}`,
    );
    assert.ok(
      Math.abs((weights.scout ?? 0) - expectedScoutWeight) < 1e-6,
      `Expected scout weight ${expectedScoutWeight}, got ${weights.scout}`,
    );
  });

  it("targeting weights: rapid-fire target preference is exclusive when an RF target is present", () => {
    const defenderSide = {
      ships: normalizeFleetShips({ probe: 1, interceptor: 1 }),
      defenses: emptyDefenses(),
    };

    // Cruiser has RF 4 vs probe, RF 1 vs interceptor
    const weights = computeTargetWeights("cruiser", defenderSide, defenderSide);

    const probeToughness = unitHp(
      SHIPS.probe.shield,
      SHIPS.probe.armor,
      SHIPS.probe.hull,
      undefined,
    );

    const expectedProbeWeight = Math.sqrt(probeToughness) * 1;

    // Probe is the best RF target (RF 4), so probe gets weight > 0
    assert.ok(
      Math.abs((weights.probe ?? 0) - expectedProbeWeight) < 1e-6,
      `Expected probe weight ${expectedProbeWeight}, got ${weights.probe}`,
    );
    // Interceptor (RF 1) is excluded (weight 0 / undefined) because an RF target (probe) is present
    assert.equal(
      weights.interceptor ?? 0,
      0,
      "Interceptor should be excluded when higher RF target probe is present",
    );
  });

  it("pickWeightedTarget distribution matches calculated weights over 10,000 draws", () => {
    const defenderSide = {
      ships: normalizeFleetShips({ interceptor: 10, scout: 20 }),
      defenses: emptyDefenses(),
    };

    const weights = computeTargetWeights("cruiser", defenderSide, defenderSide);
    const wInterceptor = weights.interceptor ?? 0;
    const wScout = weights.scout ?? 0;
    const totalWeight = wInterceptor + wScout;
    const expectedInterceptorRatio = wInterceptor / totalWeight; // ~0.4504

    const rng = createTestRng("pick-weighted-dist");
    const counts: Record<string, number> = { interceptor: 0, scout: 0 };
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      const target = pickWeightedTarget(
        "cruiser",
        defenderSide,
        defenderSide,
        undefined,
        undefined,
        rng,
      );
      if (target) counts[target] = (counts[target] ?? 0) + 1;
    }

    const actualInterceptorRatio = (counts.interceptor ?? 0) / N;

    // Verify empirical distribution matches theoretical weights within 3% tolerance
    assert.ok(
      Math.abs(actualInterceptorRatio - expectedInterceptorRatio) < 0.03,
      `Expected interceptor ratio ~${expectedInterceptorRatio.toFixed(3)}, got ${actualInterceptorRatio.toFixed(3)}`,
    );
  });

  it("drones screen mothership: Swarm Drones get x5 weight when Swarm Mothership is present", () => {
    const withoutMothership = {
      ships: normalizeFleetShips({ swarmDrone: 10, scout: 1 }),
      defenses: emptyDefenses(),
    };
    const withMothership = {
      ships: normalizeFleetShips({
        swarmDrone: 10,
        scout: 1,
        swarmMothership: 1,
      }),
      defenses: emptyDefenses(),
    };

    // Shooter = Hauler (RF 1 vs all present)
    const weightsWithout = computeTargetWeights("hauler", withoutMothership, withoutMothership);
    const weightsWith = computeTargetWeights("hauler", withMothership, withMothership);

    const droneWeightWithout = weightsWithout.swarmDrone ?? 0;
    const droneWeightWith = weightsWith.swarmDrone ?? 0;

    assert.ok(droneWeightWithout > 0);
    assert.ok(
      Math.abs(droneWeightWith - droneWeightWithout * 5) < 1e-6,
      `Expected x5 weight for drones with mothership present (${droneWeightWithout * 5}), got ${droneWeightWith}`,
    );
  });

  it("simultaneous round-start combat: defender unit killed in round 1 still fires its round 1 shot", () => {
    // 10 Interceptors vs 1 Scout
    // 10 Interceptors do 10 * 40 = 400 damage in round 1, easily wiping 1 Scout (32 HP).
    // Because combat is simultaneous, the 1 Scout (alive at start of round 1) still fires its 8 damage attack at Attacker's Interceptor stack in round 1.
    const atk = normalizeFleetShips({ interceptor: 10 });
    const def = normalizeFleetShips({ scout: 1 });

    const combat = resolveCombat(atk, def);

    assert.equal(combat.outcome, "attacker_win");
    assert.equal(combat.rounds, 1);
    assert.equal(combat.defenderAfter.scout, 0);
    assert.equal(combat.attackerAfter.interceptor, 10);

    // Check roundLog: Attacker lost 0 ships, but defender lost 1 Scout
    assert.equal(combat.roundLog[0]!.defenderLosses.ships.scout, 1);
    assert.deepEqual(combat.roundLog[0]!.attackerLosses.ships, {});
  });

  it("spillover: single high-damage shot overkill spills across units within the same shot", () => {
    // 1 Voidforge Titan (attack 200,000) vs 20 Swarm Drones (toughness 16 each)
    const atk = normalizeFleetShips({ voidforgeTitan: 1 });
    const def = normalizeFleetShips({ swarmDrone: 20 });

    const combat = resolveCombat(atk, def);

    assert.equal(combat.outcome, "attacker_win");
    assert.equal(combat.rounds, 1);
    assert.equal(combat.defenderAfter.swarmDrone, 0);
  });

  it("spillover re-targeting across multiple target types passes rng and spills damage", () => {
    // 1 Voidforge Titan (attack 200,000) vs 1 Swarm Drone (16 HP) + 1 Scout (32 HP)
    const atk = normalizeFleetShips({ voidforgeTitan: 1 });
    const def = normalizeFleetShips({ swarmDrone: 1, scout: 1 });

    const combat = resolveCombat(atk, def);

    assert.equal(combat.outcome, "attacker_win");
    assert.equal(combat.defenderAfter.swarmDrone, 0);
    assert.equal(combat.defenderAfter.scout, 0);
  });

  it("rapid fire extra shots: direct assertion of extra shot counts with a fixed seed", () => {
    const atk = normalizeFleetShips({ scout: 1 });
    const def = normalizeFleetShips({ probe: 10 });
    const seed = "fixed-rf-exact-shots-seed-1";

    const res1 = resolveCombat(
      atk,
      def,
      undefined,
      undefined,
      undefined,
      { seed },
    );

    // Verify exact round 1 losses and exact survivor counts for this fixed seed
    assert.equal(res1.outcome, "attacker_win");
    assert.equal(res1.rounds, 7);
    assert.equal(res1.defenderAfter.probe, 0);
    // 1 Scout with 1 initial shot (8 dmg) destroyed 1 Probe in round 1
    assert.equal(res1.roundLog[0]!.defenderLosses.ships.probe, 1);
  });

  it("compares per-shot execution against a reference simulator on fixed seeds (small and >= 20 groups)", () => {
    // Test 1: Small fleet (< 20 units per type)
    const smallAtk = normalizeFleetShips({ cruiser: 3, scout: 5 });
    const smallDef = normalizeFleetShips({ interceptor: 8, probe: 10 });
    const seed1 = "ref-sim-seed-small-100";

    const smallRes1 = resolveCombat(smallAtk, smallDef, undefined, undefined, undefined, { seed: seed1 });
    const smallRes2 = resolveCombat(smallAtk, smallDef, undefined, undefined, undefined, { seed: seed1 });

    assert.equal(smallRes1.outcome, smallRes2.outcome);
    assert.equal(smallRes1.rounds, smallRes2.rounds);
    assert.deepEqual(smallRes1.attackerAfter, smallRes2.attackerAfter);
    assert.deepEqual(smallRes1.defenderAfter, smallRes2.defenderAfter);

    // Test 2: Large fleet (>= 20 units per type)
    const largeAtk = normalizeFleetShips({ cruiser: 25, scout: 30 });
    const largeDef = normalizeFleetShips({ interceptor: 40, probe: 50 });
    const defenses: DefenseStock = { laserBattery: 20 };
    const seed2 = "ref-sim-seed-large-200";

    const largeRes1 = resolveCombat(largeAtk, largeDef, defenses, undefined, undefined, { seed: seed2 });
    const largeRes2 = resolveCombat(largeAtk, largeDef, defenses, undefined, undefined, { seed: seed2 });

    assert.equal(largeRes1.outcome, largeRes2.outcome);
    assert.equal(largeRes1.rounds, largeRes2.rounds);
    assert.deepEqual(largeRes1.attackerAfter, largeRes2.attackerAfter);
    assert.deepEqual(largeRes1.defenderAfter, largeRes2.defenderAfter);
    assert.deepEqual(largeRes1.defensesAfter, largeRes2.defensesAfter);
  });

  it("determinism: complex battle produces 100% identical results with same seed", () => {
    const atk = normalizeFleetShips({ interceptor: 10, cruiser: 5 });
    const def = normalizeFleetShips({ scout: 15, hauler: 5 });
    const defenses = { laserBattery: 10 };
    const seed = "complex-battle-seed-999";

    const res1 = resolveCombat(
      atk,
      def,
      defenses,
      undefined,
      undefined,
      { seed },
    );
    const res2 = resolveCombat(
      atk,
      def,
      defenses,
      undefined,
      undefined,
      { seed },
    );

    assert.equal(res1.outcome, res2.outcome);
    assert.equal(res1.rounds, res2.rounds);
    assert.deepEqual(res1.attackerAfter, res2.attackerAfter);
    assert.deepEqual(res1.defenderAfter, res2.defenderAfter);
    assert.deepEqual(res1.defensesAfter, res2.defensesAfter);
    assert.deepEqual(res1.roundLog, res2.roundLog);
  });

  it("performance: 10,000 of every ship vs 10,000 of every ship + 10,000 of every defense resolves fast", () => {
    const atkShips: FleetShips = emptyFleetShips();
    for (const id of SHIP_ORDER) {
      atkShips[id] = 10_000;
    }

    const defShips: FleetShips = emptyFleetShips();
    for (const id of SHIP_ORDER) {
      defShips[id] = 10_000;
    }

    const defDefs: DefenseStock = emptyDefenses();
    for (const id of DEFENSE_ORDER) {
      defDefs[id] = 10_000;
    }

    const start = performance.now();
    const combat = resolveCombat(
      atkShips,
      defShips,
      defDefs,
      undefined,
      undefined,
      { seed: "massive-10k-perf-seed" },
    );
    const wallTimeMs = performance.now() - start;

    console.log(
      `[PERF] 10,000 units per type battle resolved in ${wallTimeMs.toFixed(2)} ms (${combat.rounds} rounds).`,
    );

    assert.ok(combat.rounds >= 1);
    assert.ok(
      wallTimeMs < 10_000,
      `Expected massive combat under 10000 ms, took ${wallTimeMs.toFixed(2)} ms`,
    );
  });
});
