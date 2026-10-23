import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIPS } from "./catalog.js";
import {
  computeTargetWeights,
  emptyDefenses,
  emptyFleetShips,
  normalizeFleetShips,
  resolveCombat,
  unitHp,
} from "./formulas.js";

describe("B3-07 / B3-08 Combat: weighted targeting + rapid fire", () => {
  it("targeting weights: hand-computed weight sqrt(toughness) * count * RF factor", () => {
    const defenderSide = {
      ships: normalizeFleetShips({ interceptor: 1, scout: 2 }),
      defenses: emptyDefenses(),
    };

    // Shooter = Cruiser (RF 1 vs interceptor, RF 1 vs scout)
    const weights = computeTargetWeights("cruiser", defenderSide);

    // Interceptor stats: shield 10, armor 16, hull 60 -> toughness 86
    const interceptorToughness = unitHp(
      SHIPS.interceptor.shield,
      SHIPS.interceptor.armor,
      SHIPS.interceptor.hull,
      undefined,
    );
    assert.equal(interceptorToughness, 86);
    const expectedInterceptorWeight = Math.sqrt(86) * 1 * 1;

    // Scout stats: shield 4, armor 8, hull 20 -> toughness 32
    const scoutToughness = unitHp(
      SHIPS.scout.shield,
      SHIPS.scout.armor,
      SHIPS.scout.hull,
      undefined,
    );
    assert.equal(scoutToughness, 32);
    const expectedScoutWeight = Math.sqrt(32) * 2 * 1;

    assert.ok(
      Math.abs((weights.interceptor ?? 0) - expectedInterceptorWeight) < 1e-6,
      `Expected interceptor weight ${expectedInterceptorWeight}, got ${weights.interceptor}`,
    );
    assert.ok(
      Math.abs((weights.scout ?? 0) - expectedScoutWeight) < 1e-6,
      `Expected scout weight ${expectedScoutWeight}, got ${weights.scout}`,
    );
  });

  it("targeting weights: rapid-fire target preference is weighted and non-exclusive", () => {
    const defenderSide = {
      ships: normalizeFleetShips({ probe: 1, interceptor: 1 }),
      defenses: emptyDefenses(),
    };

    // Cruiser has RF 4 vs probe, RF 1 vs interceptor
    const weights = computeTargetWeights("cruiser", defenderSide);

    const probeToughness = unitHp(
      SHIPS.probe.shield,
      SHIPS.probe.armor,
      SHIPS.probe.hull,
      undefined,
    );
    const interceptorToughness = unitHp(
      SHIPS.interceptor.shield,
      SHIPS.interceptor.armor,
      SHIPS.interceptor.hull,
      undefined,
    );

    const expectedProbeWeight = Math.sqrt(probeToughness) * 1 * 4;
    const expectedInterceptorWeight = Math.sqrt(interceptorToughness) * 1 * 1;

    // Both target types keep positive weights (non-exclusive)
    assert.ok(
      Math.abs((weights.probe ?? 0) - expectedProbeWeight) < 1e-6,
      `Expected probe weight ${expectedProbeWeight}, got ${weights.probe}`,
    );
    assert.ok(
      Math.abs((weights.interceptor ?? 0) - expectedInterceptorWeight) < 1e-6,
      `Expected interceptor weight ${expectedInterceptorWeight}, got ${weights.interceptor}`,
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
    const weightsWithout = computeTargetWeights("hauler", withoutMothership);
    const weightsWith = computeTargetWeights("hauler", withMothership);

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

  it("rapid fire extra shots: fixed seed produces deterministic extra shots and wipes target", () => {
    const atk = normalizeFleetShips({ scout: 1 });
    const def = normalizeFleetShips({ probe: 10 });
    const seed = "fixed-rf-test-seed-101";

    const res1 = resolveCombat(
      atk,
      def,
      undefined,
      undefined,
      undefined,
      { seed },
    );
    const res2 = resolveCombat(
      atk,
      def,
      undefined,
      undefined,
      undefined,
      { seed },
    );

    assert.deepEqual(res1, res2);
    // Scout attack is 8. Probe HP is 8. Without RF, 1 Scout does 1 kill per round -> 8 rounds max = 8 kills max (leaves 2 probes).
    // With RF 2 vs Probe (50% repeat chance per shot), Scout gets extra shots in round 1, clearing probes faster.
    assert.equal(res1.outcome, "attacker_win");
    assert.ok(res1.rounds < 8, `Expected < 8 rounds with RF, got ${res1.rounds}`);
    assert.equal(res1.defenderAfter.probe, 0);
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
});
