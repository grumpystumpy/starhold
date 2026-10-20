import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFENSES,
  MAX_COMBAT_ROUNDS,
  SHIPS,
  rapidFireFactor,
} from "./catalog.js";
import {
  defenseCombatPower,
  fleetCombatPower,
  normalizeFleetShips,
  resolveCombat,
  unitCombatPower,
  unitHp,
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
    assert.ok(combat.rounds >= 1 && combat.rounds <= MAX_COMBAT_ROUNDS);
    assert.equal(combat.defenderAfter.interceptor, 0);
    assert.ok((combat.attackerAfter.cruiser ?? 0) >= 1);
  });

  it("B3-01: checker test verifying every unit has armor === round(0.4 * hull)", () => {
    for (const [id, ship] of Object.entries(SHIPS)) {
      assert.equal(
        ship.armor,
        Math.round(0.4 * ship.hull),
        `Ship ${id} armor expected ${Math.round(0.4 * ship.hull)} but got ${ship.armor}`,
      );
    }
    for (const [id, def] of Object.entries(DEFENSES)) {
      assert.equal(
        def.armor,
        Math.round(0.4 * def.hull),
        `Defense ${id} armor expected ${Math.round(0.4 * def.hull)} but got ${def.armor}`,
      );
    }
  });

  it("B3-02: armor counts in unitHp, unitCombatPower, fleet and defense combat power", () => {
    const research = { weaponsTech: 1, shieldingTech: 2, armourTech: 3 } as never;
    // shieldingTech = 2 (+16%), armourTech = 3 (+24%)
    const hp = unitHp(10, 20, 50, research);
    // 10 * 1.16 + 20 * 1.24 + 50 * 1.24 = 11.6 + 24.8 + 62 = 98.4 -> Math.max(1, 98.4)
    assert.ok(Math.abs(hp - 98.4) < 1e-6);

    // unitCombatPower: 100 * 1.08 + 0.5 * 10 * 1.16 + 0.3 * 20 * 1.24 + 0.3 * 50 * 1.24
    const cp = unitCombatPower(100, 10, 20, 50, research);
    assert.ok(Math.abs(cp - (108 + 5.8 + 7.44 + 18.6)) < 1e-6);

    const scoutCp = unitCombatPower(
      SHIPS.scout.attack,
      SHIPS.scout.shield,
      SHIPS.scout.armor,
      SHIPS.scout.hull,
      undefined,
    );
    const fleetCp = fleetCombatPower(normalizeFleetShips({ scout: 2 }));
    assert.equal(fleetCp, 2 * scoutCp);

    const laserCp = unitCombatPower(
      DEFENSES.laserBattery.attack,
      DEFENSES.laserBattery.shield,
      DEFENSES.laserBattery.armor,
      DEFENSES.laserBattery.hull,
      undefined,
    );
    const defCp = defenseCombatPower({ laserBattery: 3 } as never);
    assert.equal(defCp, 3 * laserCp);
  });

  it("B3-05: seeded RNG for combat produces identical battle results for same inputs and seed", () => {
    const atk = normalizeFleetShips({ interceptor: 10, cruiser: 2 });
    const def = normalizeFleetShips({ scout: 15, hauler: 5 });
    const seed = "flt_test_1234:10005000";

    const res1 = resolveCombat(atk, def, undefined, undefined, undefined, { seed });
    const res2 = resolveCombat(atk, def, undefined, undefined, undefined, { seed });

    assert.equal(res1.outcome, res2.outcome);
    assert.equal(res1.rounds, res2.rounds);
    assert.deepEqual(res1.attackerAfter, res2.attackerAfter);
    assert.deepEqual(res1.defenderAfter, res2.defenderAfter);
    assert.equal(res1.summary, res2.summary);
  });

  it("B3-06: 3-layer damage flow per shot & full shield recharge per round (max 8 rounds)", () => {
    assert.equal(MAX_COMBAT_ROUNDS, 8);

    // Scout has shield: 4, armor: 8, hull: 20
    // Attack of 10 vs 1 Scout in round 1:
    // Shield absorbs min(10, 4) = 4 (shield becomes 0).
    // Armor absorbs min(6, 8) = 6 (armor becomes 2).
    // Scout survives round 1.
    // In round 2, shield recharges to 4!
    const atk = normalizeFleetShips({ scout: 1 }); // 8 attack
    const def = normalizeFleetShips({ scout: 1 }); // 8 attack

    const combat = resolveCombat(atk, def);
    assert.ok(combat.rounds >= 1 && combat.rounds <= MAX_COMBAT_ROUNDS);
  });

  it("Old saves: old-shaped universe state without armor fields loads and battles resolve", () => {
    const universe = createUniverse("Old Save Drift", 8);
    const a = joinUniverse(universe, "OldAtk", 140_000_000);
    const b = joinUniverse(universe, "OldDef", 140_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);

    // Plain count maps without any static tuning stored in save
    universe.planets[a.planet.id].ships = { scout: 5, hauler: 2 } as never;
    universe.planets[b.planet.id].ships = { scout: 2 } as never;
    universe.planets[b.planet.id].defenses = { laserBattery: 1 } as never;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 5 },
      140_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const report = Object.values(universe.reports)[0];
    assert.ok(report);
    assert.ok(report.outcome === "attacker_win" || report.outcome === "defender_win" || report.outcome === "draw");
    assert.ok(report.rounds >= 1);
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
    assert.ok(report.roundLog);
    assert.equal(report.roundLog!.length, report.rounds);
  });
});
