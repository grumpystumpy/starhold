import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEWBIE_PROTECTION_POINTS,
  PIRATE_FAIRNESS_PENALTY_PER_RAID,
  PIRATE_FAIRNESS_POINTS_MAX,
  SHIPS,
} from "./catalog.js";
import {
  createUniverse,
  empirePoints,
  isNewbieProtected,
  joinUniverse,
  launchFleet,
  pirateRaidPickWeight,
  recordSuccessfulPirateRaid,
  utcDayKey,
} from "./world.js";

describe("CHANGE #19 World Eater speed", () => {
  it("cruise speed is half of prior 600", () => {
    assert.equal(SHIPS.worldEater.speed, 300);
  });
});

describe("CHANGE #15 newbie protection", () => {
  it("exports 2500-point threshold", () => {
    assert.equal(NEWBIE_PROTECTION_POINTS, 2500);
  });

  it("fresh join is protected; blocks player raids", () => {
    const universe = createUniverse("Newbie Prot", 8);
    const a = joinUniverse(universe, "Attacker", 400_000_000);
    const b = joinUniverse(universe, "Newbie", 400_000_001);
    assert.ok(empirePoints(universe, universe.players[b.player.id]) < 2500);
    assert.equal(isNewbieProtected(universe, universe.players[b.player.id]), true);

    universe.planets[a.planet.id].ships.interceptor = 5;
    const result = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      ships: { interceptor: 1 },
      targetPlanetId: b.planet.id,
      now: 400_000_100,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /newbie protection/i);
    }
  });
});

describe("CHANGE #18 pirate raid fairness", () => {
  it("knobs match vision", () => {
    assert.equal(PIRATE_FAIRNESS_POINTS_MAX, 100_000);
    assert.equal(PIRATE_FAIRNESS_PENALTY_PER_RAID, 0.01);
  });

  it("newbies weigh 0; each successful raid that day −1% of original", () => {
    const universe = createUniverse("Fairness", 8);
    const { player } = joinUniverse(universe, "Target", 410_000_000);
    const now = 410_000_100;
    assert.equal(pirateRaidPickWeight(universe, player, now), 0);

    // Inflate points into fairness band (under 100k, over 2500).
    universe.planets[player.homePlanetId].ships.hauler = 5000;
    const pts = empirePoints(universe, universe.players[player.id]);
    assert.ok(pts >= NEWBIE_PROTECTION_POINTS);
    assert.ok(pts < PIRATE_FAIRNESS_POINTS_MAX);
    const p = universe.players[player.id]!;
    assert.equal(pirateRaidPickWeight(universe, p, now), 1);

    recordSuccessfulPirateRaid(p, now);
    assert.equal(p.pirateRaidFairness?.dayKey, utcDayKey(now));
    assert.equal(p.pirateRaidFairness?.successfulRaids, 1);
    assert.ok(
      Math.abs(pirateRaidPickWeight(universe, p, now) - 0.99) < 1e-9,
    );

    recordSuccessfulPirateRaid(p, now);
    assert.equal(p.pirateRaidFairness?.successfulRaids, 2);
    assert.ok(
      Math.abs(pirateRaidPickWeight(universe, p, now) - 0.98) < 1e-9,
    );

    // Next UTC day resets.
    const nextDay = now + 24 * 60 * 60 * 1000;
    assert.equal(pirateRaidPickWeight(universe, p, nextDay), 1);
    recordSuccessfulPirateRaid(p, nextDay);
    assert.equal(p.pirateRaidFairness?.successfulRaids, 1);
    assert.equal(p.pirateRaidFairness?.dayKey, utcDayKey(nextDay));
  });
});
