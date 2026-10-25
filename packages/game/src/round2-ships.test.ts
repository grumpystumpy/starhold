import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  CHRONO_LATHE_SHIPYARD_REQ,
  OCCUPATION_DURATION_MS,
  OCCUPATION_OCCUPIER_SHARE,
  OCCUPATION_OWNER_SHARE,
  RAPID_FIRE,
  SHIPS,
  SWARM_CAPACITY_BASE,
  SWARM_HOLD_BONUS_PER_LEVEL,
  rapidFireFactor,
} from "./catalog.js";
import {
  applyHarvesterKamikaze,
  batchUnitsProduced,
  canCollectDebris,
  canResolveMiniPlanet,
  chronoLatheTimeFactor,
  computeRaidLoot,
  emptyDefenses,
  emptyResearch,
  fleetCargoCapacity,
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
  launchFleet,
  resolveMiniPlanetChoice,
  startOccupation,
  swarmProduce,
} from "./world.js";
import { addDebris } from "./world-tick.js";

describe("Round 2 ship catalog fixtures (Micah amendments)", () => {
  it("Void Titan (3rd largest) moon-killer stats", () => {
    const s = SHIPS.voidforgeTitan;
    assert.equal(s.name, "Void Titan");
    assert.match(s.description, /Can destroy moons\./);
    assert.equal(s.cost.metal, 1_500_000);
    assert.equal(s.cost.crystal, 1_200_000);
    assert.equal(s.cost.deuterium, 400_000);
    assert.equal(s.buildSeconds, 90_000);
    assert.equal(s.shipyardLevel, 11);
    assert.equal(s.cargo, 1_000_000);
    assert.equal(s.attack, 200_000);
    assert.equal(s.shield, 50_000);
    assert.equal(s.hull, 1_000_000);
    assert.equal(s.speed, 100);
    assert.deepEqual(s.researchReq, {
      weaponsTech: 10,
      shieldingTech: 10,
      armourTech: 10,
      gravityWell: 1,
    });
  });

  it("World Eater is largest: highest cost/yard/reqs, no cargo", () => {
    const s = SHIPS.worldEater;
    assert.equal(s.name, "World Eater");
    assert.match(
      s.description,
      /Destroys mini planets\. No cargo; cannot collect debris\./,
    );
    assert.doesNotMatch(s.description, /moon/i);
    assert.equal(s.cargo, 0);
    assert.equal(s.attack, 300_000);
    assert.equal(s.speed, 300);
    assert.equal(s.shipyardLevel, 15);
    assert.ok(s.cost.metal > SHIPS.swarmMothership.cost.metal);
    assert.ok(s.shipyardLevel > SHIPS.swarmMothership.shipyardLevel);
    assert.ok(s.shipyardLevel > SHIPS.voidforgeTitan.shipyardLevel);
    assert.ok(s.attack > SHIPS.voidforgeTitan.attack);
    assert.ok(s.attack > SHIPS.swarmMothership.attack);
    assert.ok(s.shield > SHIPS.swarmMothership.shield);
    assert.ok(s.hull > SHIPS.swarmMothership.hull);
    assert.equal(canCollectDebris(normalizeFleetShips({ worldEater: 5 })), false);
  });

  it("Swarm drones/harvesters are 25% cost and build time", () => {
    assert.deepEqual(SHIPS.swarmDrone.cost, {
      metal: 50,
      crystal: 20,
      deuterium: 0,
    });
    assert.equal(SHIPS.swarmDrone.buildSeconds, 2);
    assert.equal(SHIPS.swarmDrone.cargo, 20);
    assert.equal(SHIPS.swarmDrone.attack, 25);
    assert.deepEqual(SHIPS.swarmHarvester.cost, {
      metal: 100,
      crystal: 75,
      deuterium: 25,
    });
    assert.equal(SHIPS.swarmHarvester.buildSeconds, 5);
    assert.equal(SHIPS.swarmHarvester.cargo, 500);
    assert.equal(SHIPS.swarmHarvester.attack, 1);
  });

  it("Mothership is 2nd largest with amended cargo/combat", () => {
    const s = SHIPS.swarmMothership;
    assert.equal(s.cargo, 150_050_000);
    assert.equal(s.attack, 3_000);
    assert.equal(s.shield, 450_000);
    assert.equal(s.hull, 100_000);
    assert.equal(s.shipyardLevel, 13);
    assert.ok(s.shipyardLevel > SHIPS.voidforgeTitan.shipyardLevel);
    assert.ok(s.shipyardLevel < SHIPS.worldEater.shipyardLevel);
    assert.equal(
      canCollectDebris(normalizeFleetShips({ swarmMothership: 1 })),
      true,
    );
  });

  it("Mothership can harvest debris fields", () => {
    const universe = createUniverse("MS Harvest Drift", 8);
    const a = joinUniverse(universe, "SwarmSalvage", 240_000_000);
    const coords = { ...a.planet.coords, slot: 3 };
    addDebris(universe, coords, { metal: 5_000, crystal: 2_000, deuterium: 0 });
    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 50_000;
    const harvest = launchFleet(universe, {
      playerId: a.player.id,
      mission: "harvest",
      targetCoords: coords,
      ships: { swarmMothership: 1 },
      now: 240_000_100,
    });
    assert.equal(harvest.ok, true, harvest.ok ? "" : harvest.error);
    if (!harvest.ok) return;
    advanceUniverse(universe, harvest.fleet.arrivesAt);
    const ret = universe.fleets[harvest.fleet.id];
    assert.ok(ret);
    assert.ok(ret.cargo.metal + ret.cargo.crystal > 0);
  });
});

describe("Round 2 rapid-fire matrix", () => {
  const pairs: Array<[string, string, number]> = [
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
      assert.equal(rapidFireFactor(firer as never, target as never), factor);
    });
  }

  it("RAPID_FIRE table still includes Void Titan keys", () => {
    assert.ok(RAPID_FIRE.voidforgeTitan);
  });
});

describe("Void Titan moon-kill chance", () => {
  it("is monotonic in titan count", () => {
    const fields = 10;
    let prev = 0;
    for (const n of [1, 2, 4, 9, 16, 25]) {
      const c = voidforgeMoonKillChancePct(n, fields);
      assert.ok(c >= prev);
      prev = c;
    }
  });

  it("fieldsCap reduces chance", () => {
    const low = voidforgeMoonKillChancePct(1, 1);
    const high = voidforgeMoonKillChancePct(1, 400);
    assert.ok(low > high);
  });
});

describe("Swarm Hold capacity base 2000", () => {
  it("matches +15% of base 2000 per level", () => {
    assert.equal(SWARM_CAPACITY_BASE, 2000);
    assert.equal(swarmCapacityForLevel(0), 2000);
    assert.equal(
      swarmCapacityForLevel(1),
      Math.floor(2000 * (1 + SWARM_HOLD_BONUS_PER_LEVEL)),
    );
    assert.equal(swarmCapacityForLevel(1), 2300);
  });

  it("allows 2000 drones on one mothership at hold 0", () => {
    const ok = validateSwarmCarry(
      normalizeFleetShips({ swarmMothership: 1, swarmDrone: 2000 }),
      0,
    );
    assert.equal(ok.ok, true);
    const over = validateSwarmCarry(
      normalizeFleetShips({ swarmMothership: 1, swarmDrone: 2001 }),
      0,
    );
    assert.equal(over.ok, false);
  });
});

describe("Swarm cargo capacity", () => {
  it("counts drone and harvester cargo for raid loot and transport", () => {
    const ships = normalizeFleetShips({
      swarmDrone: 1,
      swarmHarvester: 1,
    });
    assert.equal(fleetCargoCapacity(ships), 520);
    assert.deepEqual(
      computeRaidLoot(
        { metal: 2_000, crystal: 0, deuterium: 0 },
        ships,
      ),
      { metal: 520, crystal: 0, deuterium: 0 },
    );

    const universe = createUniverse("Swarm Cargo Transport", 8);
    const a = joinUniverse(universe, "SwarmCargo", 240_000_000);
    const target = universe.planets[universe.miniPlanetIds![0]!];
    target.ownerPlayerId = a.player.id;
    a.player.planetIds.push(target.id);
    const origin = universe.planets[a.planet.id];
    origin.ships.swarmDrone = 1;
    origin.ships.swarmHarvester = 1;
    origin.resources = { metal: 520, crystal: 0, deuterium: 10_000 };

    const transport = launchFleet(universe, {
      playerId: a.player.id,
      mission: "transport",
      targetPlanetId: target.id,
      ships: { swarmDrone: 1, swarmHarvester: 1 },
      cargo: { metal: 520 },
      now: 240_000_100,
    });
    assert.equal(transport.ok, true, transport.ok ? "" : transport.error);
    if (transport.ok) assert.equal(transport.fleet.cargo.metal, 520);
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
    assert.equal(
      parts.find((p) => p.target === "swarmMothership")?.damage,
      300,
    );
    assert.equal(parts.find((p) => p.target === "swarmDrone")?.damage, 700);
  });

  it("harvester kamikaze when mothership hull < 30%", () => {
    const own = {
      ships: normalizeFleetShips({
        swarmMothership: 1,
        swarmHarvester: 3,
      }),
      defenses: emptyDefenses(),
      unitDamage: {
        swarmMothership: { frontShieldDmg: 450_000, frontArmorDmg: 40_000, frontHullDmg: 75_000 },
      },
    };
    const enemy = {
      ships: normalizeFleetShips({ scout: 5 }),
      defenses: emptyDefenses(),
      residual: {},
    };
    const spent = applyHarvesterKamikaze(
      own,
      enemy,
      emptyResearch(),
      emptyResearch(),
    );
    assert.equal(spent, 3);
    assert.equal(own.ships.swarmHarvester, 0);
  });

  it("swarm numbers bonus scales above 50 drones", () => {
    assert.equal(swarmDroneAttackMult(49), 1);
    assert.ok(swarmDroneAttackMult(50) > 1);
  });
});

describe("Chrono Lathe + batch production", () => {
  it("Chrono Lathe exists with late-game gate constant", () => {
    assert.equal(BUILDINGS.chronoLathe.name, "Chrono Lathe");
    assert.equal(CHRONO_LATHE_SHIPYARD_REQ, 10);
    assert.equal(chronoLatheTimeFactor(0), 1);
    assert.equal(chronoLatheTimeFactor(1), 0.1);
    assert.ok(Math.abs(chronoLatheTimeFactor(2) - 0.01) < 1e-12);
  });

  it("batchUnitsProduced only when unitSeconds < 1", () => {
    assert.equal(batchUnitsProduced(0.5, 1, 10), 0);
    assert.equal(batchUnitsProduced(0.5, 0.1, 10), 5);
    assert.equal(batchUnitsProduced(2.0, 0.25, 3), 3);
  });
});

describe("Occupation", () => {
  it("starts, expires, and abandons", () => {
    const universe = createUniverse("Occ Drift", 8);
    const a = joinUniverse(universe, "OccA", 200_000_000);
    const b = joinUniverse(universe, "OccB", 200_000_001);
    const now = 200_000_100;
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

    assert.equal(startOccupation(universe, a.player.id, fleetId, now).ok, true);
    assert.equal(
      universe.occupations?.[b.planet.id]?.endsAt,
      now + OCCUPATION_DURATION_MS,
    );
    assert.equal(OCCUPATION_OCCUPIER_SHARE, 0.3);
    assert.equal(OCCUPATION_OWNER_SHARE, 0.7);
    assert.equal(
      abandonOccupation(universe, a.player.id, b.planet.id, now + 1).ok,
      true,
    );
  });

  it("recapture clears occupation", () => {
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
    clearOccupationIfRecaptured(universe, b.planet.id, b.player.id);
    assert.equal(universe.occupations?.[b.planet.id], undefined);
  });
});

describe("World Eater mini gates + swarm produce", () => {
  it("destroy gate needs ≥1 World Eater", () => {
    assert.equal(canResolveMiniPlanet(normalizeFleetShips({ worldEater: 0 })), false);
    assert.equal(canResolveMiniPlanet(normalizeFleetShips({ worldEater: 1 })), true);
  });

  it("swarm produce queues a timed job (batching)", () => {
    const universe = createUniverse("Produce Drift", 8);
    const a = joinUniverse(universe, "SwarmLord", 230_000_000);
    const fleetId = "flt_prod";
    const now = 230_000_100;
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
      departedAt: now,
      arrivesAt: now + 60_000,
      phase: "outbound",
      reportId: null,
    };
    const result = swarmProduce(universe, a.player.id, fleetId, 10, now);
    assert.equal(result.ok, true);
    assert.ok(universe.fleets[fleetId].swarmProduce);
    assert.equal(universe.fleets[fleetId].swarmProduce?.remaining, 10);
    // Advance past drone build time but before fleet arrival (deploy would dock/delete).
    advanceUniverse(universe, now + 30_000);
    assert.ok(universe.fleets[fleetId], "fleet still in flight");
    assert.equal(universe.fleets[fleetId].ships.swarmDrone, 10);
    assert.equal(universe.fleets[fleetId].swarmProduce, null);
  });

  it("mini-resolve rejects non-mini / missing report", () => {
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
      phase: "returning",
      reportId: null,
    };
    const rejected = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      fleetId,
      "destroy",
    );
    assert.equal(rejected.ok, false);
  });
});
