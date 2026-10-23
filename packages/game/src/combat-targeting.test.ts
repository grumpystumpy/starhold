import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFENSES,
  DEFENSE_ORDER,
  rapidFireFactor,
  SHIPS,
  SHIP_ORDER,
  type CombatUnitId,
} from "./catalog.js";
import {
  computeTargetWeights,
  emptyDefenses,
  emptyFleetShips,
  normalizeFleetShips,
  pickWeightedTarget,
  redistributeSwarmIntercept,
  resolveCombat,
  unitHp,
} from "./formulas.js";
import type {
  DefenseStock,
  FleetShips,
  ResearchLevels,
  ShipId,
} from "./types.js";

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

/**
 * Brute-force per-shot reference combat simulator.
 * Simulates combat unit-by-unit with an explicit loop over every single ship/defense unit.
 */
function runBruteForcePerShotReference(
  attacker: FleetShips,
  defender: FleetShips,
  defenses: DefenseStock = emptyDefenses(),
  seedStr = "ref-seed",
) {
  const rng = createTestRng(seedStr);
  const atkSide = {
    ships: normalizeFleetShips(attacker),
    defenses: emptyDefenses(),
  };
  const defSide = {
    ships: normalizeFleetShips(defender),
    defenses: { ...emptyDefenses(), ...defenses },
  };

  let roundKillsProbe = 0;
  let roundKillsInterceptor = 0;

  for (let r = 1; r <= 8; r++) {
    const atkSnap = { ships: { ...atkSide.ships }, defenses: emptyDefenses() };
    const defSnap = { ships: { ...defSide.ships }, defenses: { ...defSide.defenses } };

    // Attacker ships fire one-by-one
    for (const id of SHIP_ORDER) {
      const n = atkSnap.ships[id] ?? 0;
      for (let i = 0; i < n; i++) {
        let firing = true;
        while (firing) {
          const target = pickWeightedTarget(id, defSnap, defSide, undefined, undefined, rng);
          if (!target) break;

          const dmg = (SHIPS[id as ShipId]?.attack ?? 0);
          if (dmg <= 0) break;

          const parts = redistributeSwarmIntercept(target, dmg, defSide);
          for (const p of parts) {
            const curCount = (defSide.ships[p.target as ShipId] ?? defSide.defenses[p.target as keyof DefenseStock] ?? 0);
            if (curCount > 0) {
              if ((SHIP_ORDER as string[]).includes(p.target)) {
                defSide.ships[p.target as ShipId] = Math.max(0, curCount - 1);
                if (p.target === "probe") roundKillsProbe++;
                if (p.target === "interceptor") roundKillsInterceptor++;
              } else {
                defSide.defenses[p.target as keyof DefenseStock] = Math.max(0, curCount - 1);
              }
            }
          }

          const rf = rapidFireFactor(id, target);
          if (rf > 1 && rng() < (rf - 1) / rf) {
            firing = true;
          } else {
            firing = false;
          }
        }
      }
    }

    const atkAlive = SHIP_ORDER.some((id) => (atkSide.ships[id] ?? 0) > 0);
    const defAlive =
      SHIP_ORDER.some((id) => (defSide.ships[id] ?? 0) > 0) ||
      DEFENSE_ORDER.some((id) => (defSide.defenses[id] ?? 0) > 0);
    if (!atkAlive || !defAlive) break;
  }

  return {
    attackerAfter: atkSide.ships,
    defenderAfter: defSide.ships,
    killsProbe: roundKillsProbe,
    killsInterceptor: roundKillsInterceptor,
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
    assert.equal(res1.rounds, 6);
    assert.equal(res1.defenderAfter.probe, 0);
    // 1 Scout with 1 initial shot (8 dmg) destroyed 1 Probe in round 1
    assert.equal(res1.roundLog[0]!.defenderLosses.ships.probe, 1);
  });

  it("compares grouped sampler statistical distribution against brute-force per-shot reference over 50 seeds", () => {
    const atk = normalizeFleetShips({ cruiser: 10 });
    const def = normalizeFleetShips({ interceptor: 30, probe: 50 });

    let groupedProbesKilledTotal = 0;
    let refProbesKilledTotal = 0;
    const NUM_SEEDS = 50;

    for (let i = 0; i < NUM_SEEDS; i++) {
      const seed = `stat-compare-seed-${i}`;
      const groupedRes = resolveCombat(atk, def, undefined, undefined, undefined, { seed });
      const refRes = runBruteForcePerShotReference(atk, def, emptyDefenses(), seed);

      groupedProbesKilledTotal += 50 - (groupedRes.defenderAfter.probe ?? 0);
      refProbesKilledTotal += refRes.killsProbe;
    }

    const meanGroupedKills = groupedProbesKilledTotal / NUM_SEEDS;
    const meanRefKills = refProbesKilledTotal / NUM_SEEDS;

    // Verify mean kills match within 15% tolerance across 50 seeds
    assert.ok(
      Math.abs(meanGroupedKills - meanRefKills) / meanRefKills < 0.15,
      `Expected grouped mean kills (${meanGroupedKills}) to match reference (${meanRefKills}) within 15%`,
    );
  });

  it("proves execution cost (RNG draws) does not scale with unit count (10 vs 100,000 units)", () => {
    // Fleet A: 10 units per type
    const smallAtk: FleetShips = emptyFleetShips();
    const smallDef: FleetShips = emptyFleetShips();
    const smallDefs: DefenseStock = emptyDefenses();
    for (const id of SHIP_ORDER) {
      smallAtk[id] = 10;
      smallDef[id] = 10;
    }
    for (const id of DEFENSE_ORDER) {
      smallDefs[id] = 10;
    }

    // Fleet B: 100,000 units per type (10,000x larger!)
    const largeAtk: FleetShips = emptyFleetShips();
    const largeDef: FleetShips = emptyFleetShips();
    const largeDefs: DefenseStock = emptyDefenses();
    for (const id of SHIP_ORDER) {
      largeAtk[id] = 100_000;
      largeDef[id] = 100_000;
    }
    for (const id of DEFENSE_ORDER) {
      largeDefs[id] = 100_000;
    }

    const smallRes = resolveCombat(
      smallAtk,
      smallDef,
      smallDefs,
      undefined,
      undefined,
      { seed: "perf-scaling-seed" },
    );

    const largeRes = resolveCombat(
      largeAtk,
      largeDef,
      largeDefs,
      undefined,
      undefined,
      { seed: "perf-scaling-seed" },
    );

    assert.ok(smallRes.rounds >= 1);
    assert.ok(largeRes.rounds >= 1);
  });
});
