import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OCCUPATION_DURATION_MS,
  OCCUPATION_OCCUPIER_SHARE,
  OCCUPATION_OWNER_SHARE,
  RAPID_FIRE,
  SHIPS,
  SWARM_CAPACITY_BASE,
  SWARM_CAPACITY_HARD_CAP,
  SWARM_HOLD_BONUS_PER_LEVEL,
  rapidFireFactor,
} from "./catalog.js";
import {
  applyHarvesterKamikaze,
  canCollectDebris,
  canResolveMiniPlanet,
  emptyDefenses,
  emptyResearch,
  normalizeFleetShips,
  redistributeSwarmIntercept,
  resolveCombat,
  swarmCapacityForLevel,
  swarmDroneAttackMult,
  validateSwarmCarry,
  voidforgeMoonKillChancePct,
} from "./formulas.js";
import {
  abandonOccupation,
  advanceUniverse,
  clearOccupationIfRecaptured,
  createUniverse,
  joinUniverse,
  resolveMiniPlanetChoice,
  startOccupation,
  swarmProduce,
} from "./world.js";

describe("Round 2 ship catalog fixtures", () => {
  it("Voidforge Titan matches Deathstar-class reference stats", () => {
    const s = SHIPS.voidforgeTitan;
    assert.equal(s.name, "Voidforge Titan");
    assert.equal(s.cost.metal, 5_000_000);
    assert.equal(s.cost.crystal, 4_000_000);
    assert.equal(s.cost.deuterium, 1_000_000);
    assert.equal(s.buildSeconds, 120_000);
    assert.equal(s.shipyardLevel, 12);
    assert.equal(s.cargo, 1_000_000);
    assert.equal(s.attack, 200_000);
    assert.equal(s.shield, 50_000);
    assert.equal(s.hull, 1_000_000);
    assert.equal(s.speed, 100);
    assert.equal(s.fuelPerDistance, 5);
    assert.deepEqual(s.researchReq, {
      weaponsTech: 12,
      shieldingTech: 12,
      armourTech: 12,
    });
  });

  it("World Eater has zero cargo and cannot collect debris alone", () => {
    const s = SHIPS.worldEater;
    assert.equal(s.name, "World Eater");
    assert.equal(s.cargo, 0);
    assert.equal(s.shipyardLevel, 9);
    assert.equal(s.attack, 12_000);
    assert.equal(canCollectDebris(normalizeFleetShips({ worldEater: 5 })), false);
    assert.equal(
      canCollectDebris(normalizeFleetShips({ worldEater: 5, recycler: 1 })),
      true,
    );
  });

  it("Swarm drone / harvester / mothership fixtures", () => {
    assert.equal(SHIPS.swarmDrone.swarmCarried, true);
    assert.equal(SHIPS.swarmHarvester.swarmCarried, true);
    assert.equal(SHIPS.swarmMothership.cargo, 50_000);
    assert.equal(SHIPS.swarmMothership.shipyardLevel, 8);
    assert.equal(SHIPS.swarmDrone.attack, 6);
    assert.equal(SHIPS.swarmHarvester.attack, 0);
  });
});

describe("Round 2 rapid-fire matrix", () => {
  const pairs: Array<[keyof typeof RAPID_FIRE | string, string, number]> = [
    ["voidforgeTitan", "swarmDrone", 200],
    ["voidforgeTitan", "probe", 250],
    ["voidforgeTitan", "scout", 50],
    ["voidforgeTitan", "laserBattery", 50],
    ["worldEater", "laserBattery", 20],
    ["worldEater", "shieldDome", 10],
    ["cruiser", "swarmDrone", 8],
    ["interceptor", "swarmDrone", 5],
    ["swarmDrone", "probe", 3],
    ["bomber", "swarmDrone", 4],
    ["scout", "swarmDrone", 2],
  ];

  for (const [firer, target, factor] of pairs) {
    it(`${firer} → ${target} = ${factor}`, () => {
      assert.equal(
        rapidFireFactor(firer as never, target as never),
        factor,
      );
    });
  }
});

describe("Voidforge moon-kill chance", () => {
  it("is monotonic in titan count", () => {
    const fields = 10;
    let prev = 0;
    for (const n of [1, 2, 4, 9, 16, 25]) {
      const c = voidforgeMoonKillChancePct(n, fields);
      assert.ok(c >= prev, `${n} titans ${c} < prev ${prev}`);
      prev = c;
    }
  });

  it("fieldsCap reduces chance", () => {
    const low = voidforgeMoonKillChancePct(1, 1);
    const high = voidforgeMoonKillChancePct(1, 400);
    assert.ok(low > high, `fields 1 → ${low}, fields 400 → ${high}`);
    assert.equal(low, 99);
    assert.equal(high, 80);
  });

  it("zero titans → 0%", () => {
    assert.equal(voidforgeMoonKillChancePct(0, 10), 0);
  });
});

describe("Swarm Hold capacity", () => {
  it("matches +15% of base 300 per level with hard cap 2000", () => {
    assert.equal(swarmCapacityForLevel(0), SWARM_CAPACITY_BASE);
    assert.equal(
      swarmCapacityForLevel(1),
      Math.floor(SWARM_CAPACITY_BASE * (1 + SWARM_HOLD_BONUS_PER_LEVEL)),
    );
    assert.equal(swarmCapacityForLevel(1), 345);
    // Cap
    assert.equal(swarmCapacityForLevel(100), SWARM_CAPACITY_HARD_CAP);
  });

  it("rejects free-flying drones without mothership", () => {
    const bad = validateSwarmCarry(
      normalizeFleetShips({ swarmDrone: 10 }),
      0,
    );
    assert.equal(bad.ok, false);
  });

  it("allows drones within mothership capacity", () => {
    const ok = validateSwarmCarry(
      normalizeFleetShips({ swarmMothership: 1, swarmDrone: 300 }),
      0,
    );
    assert.equal(ok.ok, true);
    const over = validateSwarmCarry(
      normalizeFleetShips({ swarmMothership: 1, swarmDrone: 301 }),
      0,
    );
    assert.equal(over.ok, false);
  });
});

describe("Swarm combat intercept + kamikaze", () => {
  it("redirects 70% of mothership damage to drones", () => {
    const side = {
      ships: normalizeFleetShips({
        swarmMothership: 1,
        swarmDrone: 100,
      }),
      defenses: emptyDefenses(),
      residual: {},
    };
    const parts = redistributeSwarmIntercept("swarmMothership", 1000, side);
    const mother = parts.find((p) => p.target === "swarmMothership")?.damage ?? 0;
    const drones = parts.find((p) => p.target === "swarmDrone")?.damage ?? 0;
    assert.equal(mother, 300);
    assert.equal(drones, 700);
  });

  it("splits intercept 50/50 when drones and harvesters present", () => {
    const side = {
      ships: normalizeFleetShips({
        swarmMothership: 1,
        swarmDrone: 10,
        swarmHarvester: 10,
      }),
      defenses: emptyDefenses(),
      residual: {},
    };
    const parts = redistributeSwarmIntercept("swarmMothership", 1000, side);
    const drones = parts.find((p) => p.target === "swarmDrone")?.damage ?? 0;
    const harv = parts.find((p) => p.target === "swarmHarvester")?.damage ?? 0;
    assert.equal(drones, 350);
    assert.equal(harv, 350);
  });

  it("harvester kamikaze when mothership hull < 30%", () => {
    const own = {
      ships: normalizeFleetShips({
        swarmMothership: 1,
        swarmHarvester: 3,
      }),
      defenses: emptyDefenses(),
      residual: {
        // hull+shield HP for mothership at research 0 = 2000+20000 = 22000
        // residual > 70% → hull fraction < 30%
        swarmMothership: 22_000 * 0.75,
      },
    };
    const enemy = {
      ships: normalizeFleetShips({ scout: 5 }),
      defenses: emptyDefenses(),
      residual: {},
    };
    const spent = applyHarvesterKamikaze(own, enemy, emptyResearch(), emptyResearch());
    assert.equal(spent, 3);
    assert.equal(own.ships.swarmHarvester, 0);
    assert.ok((enemy.ships.scout ?? 5) < 5 || (enemy.residual.scout ?? 0) > 0);
  });

  it("swarm numbers bonus scales attack above 50 drones", () => {
    assert.equal(swarmDroneAttackMult(49), 1);
    assert.ok(swarmDroneAttackMult(50) > 1);
    assert.equal(swarmDroneAttackMult(2000), 1 + 0.002 * 2000);
  });

  it("mothership with drones survives focused fire better than naked", () => {
    const naked = resolveCombat(
      normalizeFleetShips({ interceptor: 20 }),
      normalizeFleetShips({ swarmMothership: 1 }),
    );
    const escorted = resolveCombat(
      normalizeFleetShips({ interceptor: 20 }),
      normalizeFleetShips({ swarmMothership: 1, swarmDrone: 200 }),
    );
    assert.ok(
      (escorted.defenderAfter.swarmMothership ?? 0) >=
        (naked.defenderAfter.swarmMothership ?? 0),
    );
  });
});

describe("Occupation", () => {
  it("starts, expires, and abandons per contract", () => {
    const universe = createUniverse("Occ Drift", 8);
    const a = joinUniverse(universe, "OccA", 200_000_000);
    const b = joinUniverse(universe, "OccB", 200_000_001);
    const now = 200_000_100;
    // Park a mothership fleet at B via synthetic fleet record.
    const fleetId = "flt_occ_test";
    universe.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: b.planet.id,
      targetPlayerId: b.player.id,
      targetCoords: { ...b.planet.coords },
      mission: "raid",
      ships: normalizeFleetShips({ swarmMothership: 1 }),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now,
      arrivesAt: now + 1000,
      phase: "outbound",
      reportId: null,
    };
    universe.planets[b.planet.id].defenses = emptyDefenses();

    const started = startOccupation(universe, a.player.id, fleetId, now);
    assert.equal(started.ok, true);
    const occ = universe.occupations?.[b.planet.id];
    assert.ok(occ);
    assert.equal(occ!.occupierPlayerId, a.player.id);
    assert.equal(occ!.endsAt, now + OCCUPATION_DURATION_MS);
    assert.equal(OCCUPATION_OCCUPIER_SHARE, 0.3);
    assert.equal(OCCUPATION_OWNER_SHARE, 0.7);

    // Abandon
    const left = abandonOccupation(universe, a.player.id, b.planet.id, now + 1);
    assert.equal(left.ok, true);
    assert.equal(universe.occupations?.[b.planet.id], undefined);

    // Restart then expire via prune
    startOccupation(universe, a.player.id, fleetId, now + 2);
    assert.ok(universe.occupations?.[b.planet.id]);
    advanceUniverse(universe, now + 2 + OCCUPATION_DURATION_MS + 1);
    assert.equal(universe.occupations?.[b.planet.id], undefined);
  });

  it("recapture clears occupation when owner wins", () => {
    const universe = createUniverse("Recap Drift", 8);
    const a = joinUniverse(universe, "OccX", 210_000_000);
    const b = joinUniverse(universe, "OwnY", 210_000_001);
    const now = 210_000_100;
    const fleetId = "flt_recap";
    universe.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: b.planet.id,
      targetPlayerId: b.player.id,
      targetCoords: { ...b.planet.coords },
      mission: "raid",
      ships: normalizeFleetShips({ swarmMothership: 1 }),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now,
      arrivesAt: now,
      phase: "outbound",
      reportId: null,
    };
    universe.planets[b.planet.id].defenses = emptyDefenses();
    startOccupation(universe, a.player.id, fleetId, now);
    assert.ok(universe.occupations?.[b.planet.id]);

    clearOccupationIfRecaptured(universe, b.planet.id, b.player.id);
    assert.equal(universe.occupations?.[b.planet.id], undefined);
  });
});

describe("World Eater mini gates", () => {
  it("requires ≥5 World Eaters", () => {
    assert.equal(canResolveMiniPlanet(normalizeFleetShips({ worldEater: 4 })), false);
    assert.equal(canResolveMiniPlanet(normalizeFleetShips({ worldEater: 5 })), true);
  });

  it("mini-resolve hook rejects non-mini targets", () => {
    const universe = createUniverse("Mini Drift", 8);
    const a = joinUniverse(universe, "Eater", 220_000_000);
    const b = joinUniverse(universe, "Victim", 220_000_001);
    const fleetId = "flt_mini";
    universe.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: b.planet.id,
      targetPlayerId: b.player.id,
      targetCoords: { ...b.planet.coords },
      mission: "raid",
      ships: normalizeFleetShips({ worldEater: 5 }),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 220_000_100,
      arrivesAt: 220_000_100,
      phase: "outbound",
      reportId: null,
    };
    const rejected = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      fleetId,
      "destroy",
    );
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /mini planet/i);

    universe.planets[b.planet.id].flags = { mini: true };
    const ok = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      fleetId,
      "capture",
    );
    assert.equal(ok.ok, true);
  });
});

describe("Swarm produce", () => {
  it("builds drones from mothership cargo into carried swarm", () => {
    const universe = createUniverse("Produce Drift", 8);
    const a = joinUniverse(universe, "SwarmLord", 230_000_000);
    const fleetId = "flt_prod";
    universe.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: a.planet.id,
      targetPlayerId: a.player.id,
      targetCoords: { ...a.planet.coords },
      mission: "deploy",
      ships: normalizeFleetShips({ swarmMothership: 1 }),
      cargo: { metal: 10_000, crystal: 10_000, deuterium: 0 },
      departedAt: 230_000_100,
      arrivesAt: 230_000_200,
      phase: "outbound",
      reportId: null,
    };
    const result = swarmProduce(universe, a.player.id, fleetId, 10);
    assert.equal(result.ok, true);
    assert.equal(universe.fleets[fleetId].ships.swarmDrone, 10);
    assert.ok(universe.fleets[fleetId].cargo.metal < 10_000);
  });
});
