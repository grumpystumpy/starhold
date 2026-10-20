import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCTION_MULT } from "./catalog.js";
import { productionPerHour } from "./formulas.js";
import { createUniverse, joinUniverse, advancePlanet, advanceUniverse } from "./world.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

describe("advancePlanet fractional accrual", () => {
  it("names a new player's homeworld and preserves names in old-shaped saves", () => {
    const universe = createUniverse("Homeworld", 1);
    const joined = joinUniverse(universe, "Nova", 1_499_999);
    assert.equal(joined.planet.name, "Nova homeworld");

    const oldSave = structuredClone(universe);
    oldSave.planets[joined.planet.id]!.name = "Nova's Colony";
    delete oldSave.planets[joined.planet.id]!.flags;
    ensureUniverseShape(oldSave);
    const loadedPlanet = oldSave.planets[joined.planet.id]!;
    assert.equal(loadedPlanet.name, "Nova's Colony");
    assert.equal(loadedPlanet.resources.metal, joined.planet.resources.metal);
  });

  it("adds flat base income after multipliers, including to mini planets but not moons", () => {
    const universe = createUniverse("Flat Income", 8);
    const { planet } = joinUniverse(universe, "Income", 1_500_000);
    planet.buildings = {};
    planet.coords.slot = 8;

    assert.deepEqual(productionPerHour(planet, universe.speed), {
      metal: 500,
      crystal: 250,
      deuterium: 100,
    });

    const mini = structuredClone(planet);
    mini.flags = { mini: true, miniKind: "standard" };
    assert.deepEqual(productionPerHour(mini, universe.speed), {
      metal: 500,
      crystal: 250,
      deuterium: 100,
    });

    const moon = structuredClone(planet);
    moon.kind = "moon";
    assert.deepEqual(productionPerHour(moon, universe.speed), {
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
  });

  it("applies flat base income only to owned bodies at every universe speed", () => {
    const expected = { metal: 500, crystal: 250, deuterium: 100 };
    const speedOne = createUniverse("Flat Income Speed 1", 1);
    const ownedAtSpeedOne = joinUniverse(speedOne, "Income", 1_500_001).planet;
    ownedAtSpeedOne.buildings = {};
    assert.deepEqual(productionPerHour(ownedAtSpeedOne, speedOne.speed), expected);

    const speedEight = createUniverse("Flat Income Speed 8", 8);
    const ownedAtSpeedEight = joinUniverse(speedEight, "Income", 1_500_002).planet;
    ownedAtSpeedEight.buildings = {};
    assert.deepEqual(productionPerHour(ownedAtSpeedEight, speedEight.speed), expected);

    const unownedMini = structuredClone(ownedAtSpeedEight);
    unownedMini.ownerPlayerId = "";
    unownedMini.flags = { mini: true, miniKind: "standard" };
    unownedMini.buildings = {};
    assert.deepEqual(productionPerHour(unownedMini, speedEight.speed), {
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
  });

  it("accrues flat income during offline catch-up and ticks an old save shape", () => {
    const universe = createUniverse("Old Save", 8);
    const { planet } = joinUniverse(universe, "Legacy", 1_600_000);
    planet.buildings = {};
    planet.coords.slot = 8;
    // The old saved shape has no base-income field; production is derived.
    const oldSave = structuredClone(planet) as typeof planet & {
      baseIncome?: unknown;
    };
    delete oldSave.baseIncome;
    oldSave.resources = { metal: 0, crystal: 0, deuterium: 0 };
    const start = oldSave.lastTickAt;
    const hours = 3;

    const caughtUp = advancePlanet(oldSave, universe.speed, start + hours * 3_600_000);
    assert.deepEqual(caughtUp.resources, {
      metal: hours * 500,
      crystal: hours * 250,
      deuterium: hours * 100,
    });
  });

  it("accumulates non-zero growth across many short ticks (1s polls)", () => {
    const universe = createUniverse("Test Drift", 2);
    const { planet: joined } = joinUniverse(universe, "Ticker", 1_000_000);
    let planet = universe.planets[joined.id];
    const startMetal = planet.resources.metal;
    const startCrystal = planet.resources.crystal;

    // Simulate ~2 minutes of multi-client 1s polls (tick-on-read each second).
    const tickMs = 1000;
    const ticks = 120;
    let now = planet.lastTickAt;
    for (let i = 0; i < ticks; i++) {
      now += tickMs;
      planet = advancePlanet(planet, universe.speed, now);
    }

    const metalGain = planet.resources.metal - startMetal;
    const crystalGain = planet.resources.crystal - startCrystal;

    assert.ok(
      metalGain > 1,
      `expected metal growth > 1 over ${ticks}s, got ${metalGain}`,
    );
    assert.ok(
      crystalGain > 0.5,
      `expected crystal growth > 0.5 over ${ticks}s, got ${crystalGain}`,
    );

    // Floored UI stocks should also move (starter mines @ speed×PRODUCTION_MULT).
    assert.ok(
      Math.floor(planet.resources.metal) > Math.floor(startMetal),
      "floored metal stock should increase within 2 minutes",
    );
  });

  it("applies PRODUCTION_MULT to income only", () => {
    assert.equal(PRODUCTION_MULT, 4);
    const universe = createUniverse("Mult Drift", 8);
    const { planet } = joinUniverse(universe, "Mult", 3_000_000);
    const rates = productionPerHour(planet, universe.speed);
    // L1 metal base ≈ 33/h × speed 8 × mult 4 = 1056
    assert.ok(rates.metal >= 1000, `expected ~1056 metal/h, got ${rates.metal}`);
    assert.ok(rates.crystal >= 700, `expected ~704 crystal/h, got ${rates.crystal}`);
  });

  it("advanceUniverse on every poll does not wipe sibling planet income", () => {
    const universe = createUniverse("Crowd Drift", 2);
    const a = joinUniverse(universe, "Alpha", 2_000_000);
    const b = joinUniverse(universe, "Bravo", 2_000_001);
    const startA = universe.planets[a.planet.id].resources.metal;
    const startB = universe.planets[b.planet.id].resources.metal;

    let now = 2_000_001;
    for (let i = 0; i < 90; i++) {
      now += 1000;
      advanceUniverse(universe, now);
    }

    const gainA =
      universe.planets[a.planet.id].resources.metal - startA;
    const gainB =
      universe.planets[b.planet.id].resources.metal - startB;

    assert.ok(gainA > 1, `Alpha metal gain ${gainA}`);
    assert.ok(gainB > 1, `Bravo metal gain ${gainB}`);
  });
});
