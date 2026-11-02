import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCTION_MULT } from "./catalog.js";
import { productionPerHour } from "./formulas.js";
import {
  createUniverse,
  joinUniverse,
  advancePlanet,
  advanceUniverse,
  bindTickBudget,
  cancelQueueItem,
  launchFleet,
  queueBuildingUpgrade,
  workersTickBudget,
} from "./world.js";
import { addCargoToPlanet } from "./world-tick.js";
import { storageForPlanet } from "./world-boosts.js";
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

describe("B7-05 Storage cap and cargo delivery rules", () => {
  it("mine production stops at storage cap and does not cut over-cap stock", () => {
    const universe = createUniverse("Cap Rules Prod", 8);
    const joined = joinUniverse(universe, "Capper", 1_500_000);
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings = { metalMine: 1, metalStorage: 1 };
    const caps = storageForPlanet(universe, planet, 1_500_000);

    // 1. Under cap: fills up to cap but no further.
    planet.resources = { metal: caps.metal - 50, crystal: 0, deuterium: 0 };
    planet.lastTickAt = 1_500_000;
    const ticked = advancePlanet(planet, universe.speed, 1_500_000 + 3_600_000 * 10);
    assert.equal(ticked.resources.metal, caps.metal);

    // 2. Over cap: production adds nothing, and stock is preserved without cut.
    planet.resources = { metal: caps.metal + 5000, crystal: 0, deuterium: 0 };
    planet.lastTickAt = 1_500_000;
    const overTicked = advancePlanet(planet, universe.speed, 1_500_000 + 3_600_000 * 10);
    assert.equal(overTicked.resources.metal, caps.metal + 5000);
  });

  it("adds cargo deliveries in full, ignoring storage cap", () => {
    const universe = createUniverse("Cap Rules Delivery", 8);
    const joined = joinUniverse(universe, "Deliverer", 1_500_000);
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings = { metalStorage: 1 };
    const caps = storageForPlanet(universe, planet, 1_500_000);

    planet.resources = { metal: caps.metal, crystal: 0, deuterium: 0 };
    addCargoToPlanet(universe, planet, { metal: 20_000, crystal: 5_000, deuterium: 1_000 }, 1_500_000);
    assert.equal(planet.resources.metal, caps.metal + 20_000);
    assert.equal(planet.resources.crystal, 5_000);
    assert.equal(planet.resources.deuterium, 1_000);
  });

  it("queue refund does not cut stock that was already above cap before refund", () => {
    const universe = createUniverse("Cap Rules Refund", 1);
    const joined = joinUniverse(universe, "Refunder", 1_500_000);
    const player = universe.players[joined.player.id]!;
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings = { metalStorage: 1, metalMine: 10 };
    const caps = storageForPlanet(universe, planet, 1_500_000);

    planet.resources = { metal: caps.metal + 50_000, crystal: 50_000, deuterium: 50_000 };
    const queued = queueBuildingUpgrade(universe, player.id, "metalMine", 1_500_000);
    assert.equal(queued.ok, true);
    if (!queued.ok) return;

    const targetPlanet = universe.planets[joined.planet.id]!;
    assert.equal(targetPlanet.buildQueue.length, 1);
    const itemId = targetPlanet.buildQueue[0]!.id;

    // Set stock above cap right before refund
    targetPlanet.resources.metal = caps.metal + 10_000;

    const cancel = cancelQueueItem(
      universe,
      player.id,
      { kind: "building", itemId, planetId: targetPlanet.id },
      1_500_000,
    );
    assert.equal(cancel.ok, true);
    assert.equal(targetPlanet.resources.metal, caps.metal + 10_000);
  });
});

describe("B7-24 Bounded catch-up simulation", () => {
  it("bounds catch-up operations under workersTickBudget during long idle periods", () => {
    const universe = createUniverse("BoundCatchup", 8);
    const p1 = joinUniverse(universe, "Cmd1", 1_000_000);
    const p2 = joinUniverse(universe, "Cmd2", 1_000_000);

    universe.planets[p1.planet.id]!.resources.deuterium = 100_000;
    p1.player.research.computerTech = 10;
    // Launch multiple fleets arriving in the past
    for (let i = 1; i <= 4; i++) {
      universe.planets[p1.planet.id]!.ships.scout = 100;
      universe.planets[p1.planet.id]!.resources.deuterium = 100_000;
      p1.player.research.fleetSpeedTech = 10;
      const launch = launchFleet(
        universe,
        p1.player.id,
        p2.planet.id,
        "deploy",
        { scout: 1 },
        1_000_000 + i * 10,
      );
      assert.ok(launch.ok, launch.ok ? undefined : launch.error);
    }

    const budget = workersTickBudget();
    bindTickBudget(() => budget);
    try {
      // Long idle jump: 1 day later
      const longIdleTime = 1_000_000 + 24 * 3600 * 1000;
      advanceUniverse(universe, longIdleTime);

      // Fleets budget cap was WORKERS_TICK_FLEET_BUDGET (2).
      // So budget.fleets should reach 0, and exactly 2 arrivals resolved in this tick.
      assert.equal(budget.fleets, 0);
      assert.ok(Object.keys(universe.fleets).length >= 2);
    } finally {
      bindTickBudget(() => undefined);
    }
  });

  it("produces identical final game state when catch-up is chunked vs one-shot", () => {
    const start = 1_000_000;
    const idleDuration = 3 * 24 * 3600 * 1000; // 3 days
    const end = start + idleDuration;

    const uOneShot = createUniverse("OneShot", 4);
    const pOne = joinUniverse(uOneShot, "SoloCmd", start);
    uOneShot.planets[pOne.planet.id]!.buildings.metalMine = 5;
    uOneShot.planets[pOne.planet.id]!.buildings.crystalMine = 4;

    const uChunked = createUniverse("OneShot", 4);
    const pChunk = joinUniverse(uChunked, "SoloCmd", start);
    uChunked.planets[pChunk.planet.id]!.buildings.metalMine = 5;
    uChunked.planets[pChunk.planet.id]!.buildings.crystalMine = 4;

    // Run one-shot catch-up
    advanceUniverse(uOneShot, end);

    // Run chunked catch-up (e.g. 1 hour increments)
    const chunkMs = 3600 * 1000;
    let t = start;
    while (t < end) {
      t = Math.min(t + chunkMs, end);
      advanceUniverse(uChunked, t);
    }

    const pOnePlanet = uOneShot.planets[pOne.planet.id]!;
    const pChunkPlanet = uChunked.planets[pChunk.planet.id]!;

    assert.equal(pOnePlanet.resources.metal, pChunkPlanet.resources.metal);
    assert.equal(pOnePlanet.resources.crystal, pChunkPlanet.resources.crystal);
    assert.equal(pOnePlanet.resources.deuterium, pChunkPlanet.resources.deuterium);
    assert.equal(pOnePlanet.lastTickAt, pChunkPlanet.lastTickAt);
  });
});
