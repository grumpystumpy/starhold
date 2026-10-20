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
    const now = player.createdAt + 48 * 60 * 60 * 1000 + 100;
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

describe("pirate raid newcomer protection", () => {
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

  it("skips a player younger than 48 hours, then targets them", () => {
    const universe = createUniverse("Pirate newcomer", 8);
    const { player } = joinUniverse(universe, "Target", 420_000_000);
    const p = universe.players[player.id]!;
    const now = p.createdAt + FORTY_EIGHT_HOURS + 1;
    universe.planets[p.homePlanetId]!.ships.hauler = 5000;
    assert.equal(pirateRaidPickWeight(universe, p, now - 2), 0);
    assert.equal(pirateRaidPickWeight(universe, p, now), 1);
  });

  it("allows an early target who has attacked pirates", () => {
    const universe = createUniverse("Pirate attacker", 8);
    const { player } = joinUniverse(universe, "Target", 430_000_000);
    const p = universe.players[player.id]!;
    universe.planets[p.homePlanetId]!.ships.hauler = 5000;
    p.attackedPiratesAt = p.createdAt + 1;
    assert.equal(pirateRaidPickWeight(universe, p, p.createdAt + 2), 1);
  });

  it("records a pirate-base attack launch and makes the young player targetable", () => {
    const universe = createUniverse("Pirate attack launch", 8);
    const { player, planet } = joinUniverse(universe, "Hunter", 440_000_000);
    const base = Object.values(universe.pirateBases ?? {})[0]!;
    const p = universe.players[player.id]!;
    const launchAt = p.createdAt + 100;
    universe.planets[planet.id]!.ships.interceptor = 1;
    universe.planets[planet.id]!.resources.deuterium = 10_000_000;

    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { interceptor: 1 },
      pirateBaseId: base.id,
      now: launchAt,
    });
    assert.equal(launch.ok, true, !launch.ok ? launch.error : "");
    assert.equal(p.attackedPiratesAt, launchAt);

    universe.planets[p.homePlanetId]!.ships.hauler = 5000;
    assert.equal(pirateRaidPickWeight(universe, p, launchAt + 1), 1);
  });

  it("loads an old player save without attackedPiratesAt", () => {
    const universe = createUniverse("Legacy pirate protection", 8);
    const { player } = joinUniverse(universe, "Legacy", 450_000_000);
    const oldSave = JSON.parse(JSON.stringify(universe)) as typeof universe;
    assert.equal(oldSave.players[player.id]!.attackedPiratesAt, undefined);
    assert.equal(
      pirateRaidPickWeight(
        oldSave,
        oldSave.players[player.id]!,
        player.createdAt + 1,
      ),
      0,
    );
  });
});
