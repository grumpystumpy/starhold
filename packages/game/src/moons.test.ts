import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceUniverse,
  createUniverse,
  galaxyViewFor,
  inSensorPhalanxRange,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  moonAtCoords,
  moonChancePercent,
  moonRoll,
  ownedPlanetCount,
  planetAtCoords,
  playerView,
  queueBuildingUpgrade,
  sensorPhalanxRange,
  setActivePlanet,
  tryFormMoon,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("Thread C moons", () => {
  it("computes chance and keeps planetAtCoords distinct from moon", () => {
    assert.equal(moonChancePercent({ metal: 249_999, crystal: 0, deuterium: 0 }), 0);
    assert.equal(moonChancePercent({ metal: 250_000, crystal: 0, deuterium: 0 }), 1);
    assert.equal(moonChancePercent({ metal: 1_000_000, crystal: 0, deuterium: 0 }), 4);
    assert.equal(moonChancePercent({ metal: 5_000_000, crystal: 0, deuterium: 0 }), 20);
    assert.equal(moonChancePercent({ metal: 9_000_000, crystal: 0, deuterium: 0 }), 20);
    assert.equal(sensorPhalanxRange(0), 0);
    assert.equal(sensorPhalanxRange(3), 3);
    assert.equal(
      inSensorPhalanxRange(
        { galaxy: 1, system: 10, slot: 8 },
        { galaxy: 1, system: 12, slot: 1 },
        2,
      ),
      true,
    );
    assert.equal(
      inSensorPhalanxRange(
        { galaxy: 1, system: 10, slot: 8 },
        { galaxy: 1, system: 13, slot: 1 },
        2,
      ),
      false,
    );

    const universe = createUniverse("Moon Map", 8);
    const a = joinUniverse(universe, "Luna", 160_000_000);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      160_000_100,
    );
    assert.ok(moon);
    assert.equal(moon!.kind, "moon");
    assert.equal(moon!.fieldsCap, 1);
    assert.equal(parent.moonId, moon!.id);
    assert.equal(moon!.parentPlanetId, parent.id);
    assert.equal(planetAtCoords(universe, parent.coords)?.id, parent.id);
    assert.equal(moonAtCoords(universe, parent.coords)?.id, moon!.id);
    assert.equal(ownedPlanetCount(universe, a.player.id), 1);
    assert.ok(universe.players[a.player.id].planetIds.includes(moon!.id));

    const galaxy = galaxyViewFor(
      universe,
      a.player.id,
      parent.coords.galaxy,
      parent.coords.system,
    );
    const slot = galaxy.slots.find((s) => s.coords.slot === parent.coords.slot);
    assert.ok(slot);
    assert.equal(slot!.hasMoon, true);
    assert.equal(slot!.moonId, moon!.id);
  });

  it("uses the battle seed and excludes NPC slots and slot 16", () => {
    const universe = createUniverse("Seeded Moon", 8);
    const a = joinUniverse(universe, "Seeded", 165_000_000);
    const parent = universe.planets[a.planet.id];
    const debris = { metal: 5_000_000, crystal: 0, deuterium: 0 };
    const seed = findSeedBelow(20);
    const secondUniverse = createUniverse("Seeded Moon", 8);
    const second = joinUniverse(secondUniverse, "Seeded", 165_000_000);
    const moonA = tryFormMoon(universe, parent, debris, seed, 165_000_100);
    const moonB = tryFormMoon(
      secondUniverse,
      secondUniverse.planets[second.planet.id],
      debris,
      seed,
      165_000_100,
    );
    assert.equal(Boolean(moonA), Boolean(moonB));

    const slot16 = {
      ...structuredClone(parent),
      id: "slot16",
      coords: { ...parent.coords, slot: 16 },
      moonId: null,
    };
    assert.equal(tryFormMoon(universe, slot16, debris, seed, 165_000_101), null);
    const npc = { ...structuredClone(parent), id: "npc", ownerPlayerId: "missing_npc", moonId: null };
    assert.equal(tryFormMoon(universe, npc, debris, seed, 165_000_102), null);
  });

  it("loads an old save with its moon and progress, then resolves a raid", () => {
    const universe = createUniverse("Old Moon Save", 8);
    const a = joinUniverse(universe, "Legacy Moonkeeper", 166_000_000);
    const b = joinUniverse(universe, "Legacy Raider", 166_000_001);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      166_000_100,
    );
    assert.ok(moon);
    parent.buildings.metalMine = 7;
    parent.resources = { metal: 12_345, crystal: 6_789, deuterium: 432 };
    universe.planets[b.planet.id]!.ships.scout = 5;
    universe.planets[b.planet.id]!.resources.deuterium = 100_000;

    // Schema 4 is the saved shape immediately before the current load path;
    // it has no v5 pirate/alien fields and already contains the moon.
    const legacy = structuredClone(universe);
    legacy.schemaVersion = 4;
    delete (legacy as Partial<typeof legacy>).alienBases;
    const oldSave = JSON.parse(JSON.stringify(legacy)) as typeof universe;
    const loaded = migrateOrResetUniverse(oldSave, { name: "fallback", speed: 8 });
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.planets[moon!.id]?.id, moon!.id);
    assert.equal(loaded.universe.planets[parent.id]?.moonId, moon!.id);
    assert.ok(loaded.universe.players[a.player.id]?.planetIds.includes(moon!.id));
    assert.equal(loaded.universe.planets[parent.id]!.buildings.metalMine, 7);
    assert.deepEqual(loaded.universe.planets[parent.id]!.resources, {
      metal: 12_345, crystal: 6_789, deuterium: 432,
    });
    assert.equal(loaded.universe.planets[b.planet.id]!.ships.scout, 5);
    graduateNewbieProtection(loaded.universe, loaded.universe.players[a.player.id]!);

    const launched = launchFleet(loaded.universe, {
      playerId: b.player.id,
      mission: "raid",
      targetPlanetId: parent.id,
      targetCoords: parent.coords,
      ships: { scout: 1 },
      now: 166_000_200,
    });
    assert.equal(launched.ok, true, launched.ok ? "" : launched.error);
    if (!launched.ok) return;
    advanceUniverse(loaded.universe, launched.fleet.arrivesAt);
    assert.ok(Object.values(loaded.universe.reports).some((report) => report.missionId === launched.fleet.id));
  });

  it("blocks mines on moons and allows lunar base + jump gate", () => {
    const universe = createUniverse("Moon Yard", 8);
    const a = joinUniverse(universe, "Builder", 161_000_000);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      161_000_100,
    );
    assert.ok(moon);
    const body = universe.planets[moon!.id];
    body.resources = { metal: 8_000, crystal: 8_000, deuterium: 0 };
    body.lastTickAt = 161_000_200;
    universe.players[a.player.id].activePlanetId = body.id;

    const mine = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      161_000_200,
      body.id,
    );
    assert.equal(mine.ok, false);

    const gateTooSoon = queueBuildingUpgrade(
      universe,
      a.player.id,
      "jumpGate",
      161_000_200,
      body.id,
    );
    assert.equal(gateTooSoon.ok, false);

    const lunar = queueBuildingUpgrade(
      universe,
      a.player.id,
      "lunarBase",
      161_000_200,
      body.id,
    );
    assert.equal(lunar.ok, true);
    assert.ok(lunar.ok && lunar.planet.buildQueue[0]);
    const lunarDoneAt = lunar.planet.buildQueue[0]!.completesAt;
    advanceUniverse(universe, lunarDoneAt);
    assert.equal(universe.planets[body.id].buildings.lunarBase, 1);

    const gated = universe.planets[body.id];
    gated.buildings.lunarBase = 5;
    gated.buildings.metalStorage = 3;
    gated.buildings.crystalStorage = 3;
    gated.buildings.deutTank = 3;
    gated.resources = { metal: 80_000, crystal: 80_000, deuterium: 40_000 };
    gated.lastTickAt = lunarDoneAt + 1;
    const gate = queueBuildingUpgrade(
      universe,
      a.player.id,
      "jumpGate",
      lunarDoneAt + 1,
      body.id,
    );
    assert.equal(gate.ok, true, gate.ok ? "" : gate.error);
  });

  it("sensor phalanx lists outbound fleets in range", () => {
    const universe = createUniverse("Sensor Drift", 8);
    const a = joinUniverse(universe, "Watcher", 162_000_000);
    const b = joinUniverse(universe, "Raider", 162_000_001);
    const parent = universe.planets[a.planet.id];
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      162_000_100,
    );
    assert.ok(moon);
    moon!.buildings.lunarBase = 1;
    moon!.buildings.sensorArray = 2;
    universe.players[a.player.id].activePlanetId = moon!.id;

    universe.planets[b.planet.id].ships.scout = 2;
    universe.planets[b.planet.id].resources.deuterium = 5_000;
    graduateNewbieProtection(universe, universe.players[a.player.id]!);
    const launch = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      targetPlanetId: a.planet.id,
      targetCoords: a.planet.coords,
      ships: { scout: 1 },
      now: 162_000_200,
    });
    assert.equal(launch.ok, true);

    const view = playerView(universe, a.player.id, 162_000_250);
    assert.ok(view.sensorContacts.length >= 1);
    assert.equal(view.sensorContacts[0].ownerPlayerId, b.player.id);
  });

  it("jump gate hops fleets between own moons", () => {
    const universe = createUniverse("Fold Bridge", 8);
    const a = joinUniverse(universe, "Jumper", 164_000_000);
    const home = universe.planets[a.planet.id];
    const colonyId = "plnt_jump_colony";
    universe.planets[colonyId] = {
      ...structuredClone(home),
      id: colonyId,
      name: "Second World",
      coords: {
        galaxy: home.coords.galaxy,
        system: home.coords.system,
        slot: ((home.coords.slot % 15) + 1) as number,
      },
      moonId: null,
      kind: "planet",
      parentPlanetId: null,
    };
    if (universe.planets[colonyId].coords.slot === home.coords.slot) {
      universe.planets[colonyId].coords.slot =
        home.coords.slot === 15 ? 14 : home.coords.slot + 1;
    }
    a.player.planetIds.push(colonyId);
    universe.players[a.player.id] = a.player;

    const moonA = tryFormMoon(
      universe,
      home,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      164_000_100,
    );
    assert.ok(moonA);
    const moonB = tryFormMoon(
      universe,
      universe.planets[colonyId],
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      164_000_101,
    );
    assert.ok(moonB);

    moonA!.buildings.lunarBase = 1;
    moonA!.buildings.jumpGate = 1;
    moonA!.ships.scout = 3;
    moonA!.resources.deuterium = 5_000;
    moonB!.buildings.lunarBase = 1;
    moonB!.buildings.jumpGate = 1;

    setActivePlanet(universe, a.player.id, moonA!.id);
    const badPlanetJump = launchFleet(universe, {
      playerId: a.player.id,
      mission: "jump",
      originPlanetId: home.id,
      targetPlanetId: moonB!.id,
      ships: { scout: 1 },
      now: 164_000_200,
    });
    assert.equal(badPlanetJump.ok, false);

    const jump = launchFleet(universe, {
      playerId: a.player.id,
      mission: "jump",
      originPlanetId: moonA!.id,
      targetPlanetId: moonB!.id,
      ships: { scout: 2 },
      now: 164_000_300,
    });
    assert.equal(jump.ok, true);
    if (!jump.ok) return;
    assert.equal(jump.fleet.mission, "jump");
    advanceUniverse(universe, jump.fleet.arrivesAt);
    assert.equal(universe.planets[moonB!.id].ships.scout, 2);
    assert.equal(universe.planets[moonA!.id].ships.scout, 1);
    assert.equal(universe.fleets[jump.fleet.id], undefined);
  });

  it("raid can form a moon when debris and roll allow", () => {
    const universe = createUniverse("Raid Moon", 8);
    const a = joinUniverse(universe, "Defender", 163_000_000);
    const b = joinUniverse(universe, "Attacker", 163_000_001);
    graduateNewbieProtection(universe, universe.players[a.player.id]!);
    universe.planets[a.planet.id].ships.cruiser = 20;
    universe.planets[b.planet.id].ships.bomber = 30;
    universe.planets[b.planet.id].ships.cruiser = 20;
    universe.planets[b.planet.id].resources.deuterium = 50_000;
    universe.players[b.player.id].research.weaponsTech = 10;

    const launch = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      targetPlanetId: a.planet.id,
      targetCoords: a.planet.coords,
      ships: { bomber: 30, cruiser: 20 },
      now: 163_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const reports = Object.values(universe.reports);
    assert.ok(reports.length >= 1);
    const rpt = reports[0];
    if (rpt.moonFormed) {
      const parent = universe.planets[a.planet.id];
      assert.ok(parent.moonId);
      assert.equal(universe.planets[parent.moonId!]?.kind, "moon");
    } else {
      const debris =
        (rpt.debrisCreated?.metal ?? 0) + (rpt.debrisCreated?.crystal ?? 0);
      assert.ok(debris >= 0);
    }
  });
});

function findSeedBelow(chance: number): string {
  for (let i = 0; i < 10_000; i++) {
    const seed = `seed_${i}`;
    if (moonRoll(seed) < chance) return seed;
  }
  throw new Error("no seed");
}
