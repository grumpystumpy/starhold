import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, advancePlanet, advanceUniverse } from "./world.js";

describe("advancePlanet fractional accrual", () => {
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

    // Floored UI stocks should also move (starter mines @ 2× are ~66/44 per hour).
    assert.ok(
      Math.floor(planet.resources.metal) > Math.floor(startMetal),
      "floored metal stock should increase within 2 minutes",
    );
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
