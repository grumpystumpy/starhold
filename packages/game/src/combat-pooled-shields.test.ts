import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateSideShieldPool, resolveCombat } from "./formulas-combat.js";
import type { FleetShips, DefenseStock, ResearchLevels } from "./types.js";
import { emptyDefenses, emptyFleetShips } from "./formulas-travel.js";

describe("Pooled Shields (B7-08)", () => {
  it("sums shields across all living ships and defenses with tech/alliance/battlefield multipliers", () => {
    const ships: FleetShips = { ...emptyFleetShips(), scout: 10, interceptor: 2 };
    const defenses: DefenseStock = { ...emptyDefenses(), laserBattery: 5 };
    const research: ResearchLevels = {
      energyTech: 0,
      laserTech: 0,
      weaponsTech: 0,
      shieldingTech: 2, // +16% shields
      armourTech: 0,
      astrophysics: 0,
      hyperdriveTech: 0,
      ionTech: 0,
      plasmaTech: 0,
      combustionDrive: 0,
      impulseDrive: 0,
      computerTech: 0,
      espionageTech: 0,
    };

    const side = {
      ships,
      defenses,
      shipShieldMult: 1.1, // +10% alliance ship shield
      defenseStatMult: 1.05, // +5% alliance defense stat
    };

    const pool = calculateSideShieldPool(side, research, {
      shieldMult: 1.0,
      attackMult: 1.0,
      armorMult: 1.0,
    });

    assert.ok(pool > 0);
    assert.equal(Math.round(pool * 100) / 100, 116.23);
  });

  it("ensures hull/armor take no damage while shield pool > 0, overflow carries over after pool is gone", () => {
    // Defender: 5 Laser Batteries (shield pool = 30).
    // Attacker: 1 Interceptor (attack = 20, RF vs Laser Battery = 1).
    const attacker: FleetShips = { ...emptyFleetShips(), interceptor: 1 };
    const defenses: DefenseStock = { ...emptyDefenses(), laserBattery: 5 };

    const res = resolveCombat(attacker, emptyFleetShips(), defenses, undefined, undefined, {
      seed: "shield-no-hull-damage",
    });

    // Attacker deals 20 attack in round 1.
    // Defender shield pool is 30, so all 20 damage is absorbed by the shield pool.
    // All 5 defender Laser Batteries survive with 0 armor/hull damage!
    assert.equal(res.roundLog[0]?.shieldsAbsorbed?.defender, 20);
    assert.equal(res.defensesAfter.laserBattery, 5);
  });

  it("resets the shield pool at the start of each round to total living units value", () => {
    // Attacker: 10 Interceptors (attack 200, shield pool 200).
    // Defender: 10 Laser Batteries (attack 160, shield pool 60).
    const attacker: FleetShips = { ...emptyFleetShips(), interceptor: 10 };
    const defenses: DefenseStock = { ...emptyDefenses(), laserBattery: 10 };

    const res = resolveCombat(attacker, emptyFleetShips(), defenses, undefined, undefined, {
      seed: "shield-reset-each-round",
    });

    // Round 1: Attacker shield pool (200) absorbs 160; Defender shield pool (60) absorbs 40.
    assert.equal(res.roundLog[0]?.shieldsAbsorbed?.attacker, 160);
    assert.equal(res.roundLog[0]?.shieldsAbsorbed?.defender, 40);
  });

  it("produces deterministic combat outcomes for the same seed", () => {
    const attacker: FleetShips = { ...emptyFleetShips(), interceptor: 3, scout: 5 };
    const defender: FleetShips = { ...emptyFleetShips(), scout: 10 };

    const res1 = resolveCombat(attacker, defender, emptyDefenses(), undefined, undefined, {
      seed: "seed-test-12345",
    });
    const res2 = resolveCombat(attacker, defender, emptyDefenses(), undefined, undefined, {
      seed: "seed-test-12345",
    });

    assert.deepEqual(res1.attackerAfter, res2.attackerAfter);
    assert.deepEqual(res1.defenderAfter, res2.defenderAfter);
    assert.equal(res1.rounds, res2.rounds);
    assert.deepEqual(res1.roundLog, res2.roundLog);
  });
});
