import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEWBIE_BONUS_DURATION_MS,
  NEWBIE_DEFENSE_MULT,
  NEWBIE_PRODUCTION_MULT,
  NEWBIE_PROTECTION_POINTS,
  PIRATE_FAIRNESS_PENALTY_PER_RAID,
  PIRATE_FAIRNESS_POINTS_MAX,
  SHIPS,
} from "./catalog.js";
import {
  createAlliance,
  createUniverse,
  advanceUniverse,
  empirePoints,
  isNewbieProtected,
  isNewbieBonusActive,
  joinUniverse,
  newbieBonusRemainingMs,
  launchFleet,
  pirateRaidPickWeight,
  playerView,
  recordSuccessfulPirateRaid,
  utcDayKey,
} from "./world.js";
import { resolveCombat } from "./formulas-combat.js";

describe("Newbie bonus", () => {
  it("keeps the bonus active and advances with an unknown ship id", () => {
    const now = 300_000_000;
    const universe = createUniverse("Unknown ship bonus", 1);
    const { player, planet } = joinUniverse(universe, "Fresh", now);
    const owner = universe.players[player.id]!;
    const body = universe.planets[planet.id]!;
    (body.ships as Record<string, number>).smallCargo = 3;

    assert.equal(isNewbieBonusActive(universe, owner, now), true);
    assert.doesNotThrow(() => advanceUniverse(universe, now + 1));
  });

  it("boosts fresh player production and defender stats until 96 hours", () => {
    const now = 300_000_000;
    const universe = createUniverse("Bonus", 1);
    const { player, planet } = joinUniverse(universe, "Fresh", now);
    const owner = universe.players[player.id]!;
    const body = universe.planets[planet.id]!;
    body.buildings.metalMine = 1;
    assert.equal(isNewbieBonusActive(universe, owner, now), true);
    assert.equal(newbieBonusRemainingMs(universe, owner, now), NEWBIE_BONUS_DURATION_MS);
    const normal = resolveCombat({ cruiser: 1 }, { cruiser: 1 });
    const boosted = resolveCombat({ cruiser: 1 }, { cruiser: 1 }, undefined, undefined, undefined, { defenderUnitStatMult: NEWBIE_DEFENSE_MULT });
    assert.ok(boosted.defenderAfter.cruiser >= normal.defenderAfter.cruiser);
    const activeRate = playerView(universe, player.id, now).economy.productionPerHour.metal;
    owner.createdAt = now - NEWBIE_BONUS_DURATION_MS;
    assert.equal(isNewbieBonusActive(universe, owner, now), false);
    const inactiveRate = playerView(universe, player.id, now).economy.productionPerHour.metal;
    assert.ok(Math.abs((activeRate - 500) / (inactiveRate - 500) - NEWBIE_PRODUCTION_MULT) < 1e-6);
    owner.createdAt = now;
    owner.newbieForfeitedAt = now + 10;
    assert.equal(isNewbieBonusActive(universe, owner, now + 20), false);
    owner.newbieForfeitedAt = null;
    universe.planets[body.id]!.buildings.metalMine = 100;
    assert.equal(isNewbieBonusActive(universe, owner, now), false);
  });

  it("keeps the newbie bonus end timestamp stable between view calls", () => {
    const now = 350_000_000;
    const universe = createUniverse("Stable bonus end", 1);
    const { player } = joinUniverse(universe, "Fresh", now);

    assert.equal(
      playerView(universe, player.id, now).newbieBonusEndsAt,
      playerView(universe, player.id, now + 1_000).newbieBonusEndsAt,
    );
  });

  it("returns zero for an old player with many planets", () => {
    const now = 400_000_000;
    const universe = createUniverse("Old Bonus", 1);
    const { player, planet } = joinUniverse(universe, "Old", now - NEWBIE_BONUS_DURATION_MS - 1);
    const owner = universe.players[player.id]!;
    for (let index = 0; index < 1_000; index += 1) {
      const extra = structuredClone(universe.planets[planet.id]!);
      extra.id = `extra_${index}`;
      universe.planets[extra.id] = extra;
      owner.planetIds.push(extra.id);
    }
    assert.equal(newbieBonusRemainingMs(universe, owner, now), 0);
  });
});

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

  it("forfeits protection on player attacks, ACS attacks, and occupation fleets", () => {
    for (const kind of ["attack", "ACS", "occupation"] as const) {
      const universe = createUniverse(`Forfeit ${kind}`, 8);
      const now = 500_000_000;
      const attacker = joinUniverse(universe, "Attacker", now);
      const defender = joinUniverse(universe, "Defender", now + 1);
      const player = universe.players[attacker.player.id]!;
      const origin = universe.planets[attacker.planet.id]!;
      const target = universe.planets[defender.planet.id]!;
      origin.ships.interceptor = 1;
      origin.ships.swarmMothership = kind === "occupation" ? 1 : 0;
      origin.resources.deuterium = 10_000_000;
      target.ships.hauler = 10_000;
      if (kind !== "occupation") {
        assert.equal(isNewbieProtected(universe, player), true, kind);
      }

      const alliance = kind === "ACS"
        ? createAlliance(universe, player.id, "Strike", "stk")
        : null;
      const result = launchFleet(universe, {
        playerId: player.id,
        mission: "raid",
        ships: {
          interceptor: 1,
          ...(kind === "occupation" ? { swarmMothership: 1 as const } : {}),
        },
        targetPlanetId: target.id,
        openAcs: alliance != null,
        now: now + 100,
      });

      assert.equal(result.ok, true, !result.ok ? result.error : "");
      assert.equal(player.newbieForfeitedAt, now + 100);
      if (kind !== "occupation") {
        assert.ok(empirePoints(universe, player) < NEWBIE_PROTECTION_POINTS);
      }
      assert.equal(isNewbieProtected(universe, player), false);
    }
  });

  it("does not forfeit on spying or attacks against pirates and aliens", () => {
    const now = 510_000_000;
    const universe = createUniverse("No forfeits", 8);
    const { player, planet } = joinUniverse(universe, "Player", now);
    const targetPlayer = joinUniverse(universe, "Target", now + 1);
    const origin = universe.planets[planet.id]!;
    const target = universe.planets[targetPlayer.planet.id]!;
    origin.ships.probe = 1;
    origin.ships.interceptor = 2;
    player.research.computerTech = 3;
    origin.resources.deuterium = 10_000_000;
    target.ships.hauler = 10_000;

    const spy = launchFleet(universe, {
      playerId: player.id,
      mission: "espionage",
      ships: { probe: 1 },
      targetPlanetId: target.id,
      now: now + 10,
    });
    assert.equal(spy.ok, true, !spy.ok ? spy.error : "");
    assert.equal(player.newbieForfeitedAt, undefined);

    const pirateBase = Object.values(universe.pirateBases ?? {})[0]!;
    const pirate = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { interceptor: 1 },
      pirateBaseId: pirateBase.id,
      now: now + 20,
    });
    assert.equal(pirate.ok, true, !pirate.ok ? pirate.error : "");
    assert.equal(player.newbieForfeitedAt, undefined);

    const alienBaseId = "alien_test";
    universe.alienBases![alienBaseId] = {
      id: alienBaseId,
      coords: { galaxy: 1, system: 1, slot: 1 },
      name: "Alien",
      tier: 1,
      level: 1,
      ships: {},
      defenses: {},
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      techs: { weapons: 0, armour: 0, shielding: 0 },
      lastGrewAt: now,
      lastRaidAt: now,
      nextRaidAt: now,
      lastFreeSpawnAt: now,
      destroyedAt: null,
      coalitionId: alienBaseId,
      splitDone: false,
      buildupEndsAt: now,
      foundAt: now,
      foundByPlayerId: player.id,
    };
    const alien = launchFleet(universe, {
      playerId: player.id,
      mission: "alienRaid",
      ships: { interceptor: 1 },
      alienBaseId,
      now: now + 30,
    });
    assert.equal(alien.ok, true, !alien.ok ? alien.error : "");
    assert.equal(player.newbieForfeitedAt, undefined);
  });

  it("keeps the original forfeit time and loads legacy saves without the field", () => {
    const now = 520_000_000;
    const universe = createUniverse("Legacy newbie protection", 8);
    const { player, planet } = joinUniverse(universe, "Legacy", now);
    const targetPlayer = joinUniverse(universe, "Target", now + 1);
    const origin = universe.planets[planet.id]!;
    const target = universe.planets[targetPlayer.planet.id]!;
    origin.ships.interceptor = 1;
    origin.resources.deuterium = 10_000_000;
    target.ships.hauler = 10_000;
    player.newbieForfeitedAt = now + 5;

    const result = launchFleet(universe, {
      playerId: player.id,
      mission: "raid",
      ships: { interceptor: 1 },
      targetPlanetId: target.id,
      now: now + 100,
    });
    assert.equal(result.ok, true, !result.ok ? result.error : "");
    assert.equal(player.newbieForfeitedAt, now + 5);
    assert.equal(isNewbieProtected(universe, player), false);

    const oldSave = JSON.parse(JSON.stringify(universe)) as typeof universe;
    delete oldSave.players[player.id]!.newbieForfeitedAt;
    const oldPlayer = oldSave.players[player.id]!;
    assert.equal(oldPlayer.newbieForfeitedAt, undefined);
    assert.equal(isNewbieProtected(oldSave, oldPlayer), true);
    assert.deepEqual(oldSave.players[player.id]!.planetIds, player.planetIds);
    assert.deepEqual(
      oldSave.planets[player.homePlanetId]!.resources,
      universe.planets[player.homePlanetId]!.resources,
    );
    assert.equal(oldSave.fleets[Object.keys(oldSave.fleets)[0]!]!.ownerPlayerId, player.id);
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
