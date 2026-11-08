import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { OCCUPATION_DURATION_MS } from "./catalog.js";
import { normalizeFleetShips, productionPerHour } from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  ensureUniverseShape,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueShipBuild,
} from "./world.js";
import { captureMiniPlanet, createMiniPlanet } from "./world-mini.js";
import type { UniverseState } from "./types.js";

describe("Occupation fleet mission (B7-12)", () => {
  it("rejects launch without a Mothership", () => {
    const universe = createUniverse("Occ Test 1", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.scout = 5;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { scout: 5 },
      now: 100_000_100,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /Mothership/);
    }
  });

  it("rejects non-mini targets", () => {
    const universe = createUniverse("Occ Test 2", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const b = joinUniverse(universe, "PlayerB", 100_000_001);

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: b.planet.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /mini planet/i);
    }
  });

  it("accepts launch with Mothership targeting a mini planet", () => {
    const universe = createUniverse("Occ Test 3", 8);
    const a = joinUniverse(universe, "PlayerA", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const res = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(res.ok, true);
  });

  it("winning arrival with surviving Mothership captures and occupies the mini planet", () => {
    const universe = createUniverse("Occ Test 4", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const b = joinUniverse(universe, "Defender", 100_000_001);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    mini.ownerPlayerId = b.player.id;
    b.player.planetIds.push(mini.id);
    mini.ships = normalizeFleetShips({ scout: 2 });
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].ships.interceptor = 50;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1, interceptor: 50 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Mini should be captured by attacker
    assert.equal(universe.planets[mini.id]?.ownerPlayerId, a.player.id);
    // Occupation state should be set
    const occ = universe.occupations?.[mini.id];
    assert.ok(occ, "Occupation state should exist");
    assert.equal(occ.occupierPlayerId, a.player.id);
    assert.equal(occ.mothershipFleetId, launch.fleet.id);
  });

  it("losing arrival does not capture or occupy the mini planet", () => {
    const universe = createUniverse("Occ Test 5", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const b = joinUniverse(universe, "Defender", 100_000_001);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    mini.ownerPlayerId = b.player.id;
    b.player.planetIds.push(mini.id);
    // Huge defense to crush attacker
    mini.ships = normalizeFleetShips({ cruiser: 100 });
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Owner should still be defender
    assert.equal(universe.planets[mini.id]?.ownerPlayerId, b.player.id);
    // Occupation should not exist
    assert.equal(universe.occupations?.[mini.id], undefined);
  });

  it("unoccupied mini planet arrival with surviving Mothership captures and occupies", () => {
    const universe = createUniverse("Occ Test 6", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 20, 100_000_000, "standard");
    // Unoccupied
    mini.ownerPlayerId = "";
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [mini.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    assert.equal(universe.planets[mini.id]?.ownerPlayerId, a.player.id);
    const occ = universe.occupations?.[mini.id];
    assert.ok(occ, "Occupation state should exist");
    assert.equal(occ.occupierPlayerId, a.player.id);
  });

  it("respects one-per-player limit on fortress/relic capture during occupy mission", () => {
    const universe = createUniverse("Occ Test 7", 8);
    const a = joinUniverse(universe, "Attacker", 100_000_000);
    // Already owns a fortress
    const heldFortress = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 21, 100_000_000, "fortress");
    heldFortress.ownerPlayerId = a.player.id;
    universe.planets[heldFortress.id] = heldFortress;
    a.player.planetIds.push(heldFortress.id);

    // Target another fortress
    const targetFortress = createMiniPlanet(universe.seed ?? universe.id, 1, 1, 22, 100_000_000, "fortress");
    targetFortress.ownerPlayerId = "";
    universe.planets[targetFortress.id] = targetFortress;
    universe.miniPlanetIds = [heldFortress.id, targetFortress.id];

    universe.planets[a.planet.id].ships.swarmMothership = 1;
    universe.planets[a.planet.id].resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: targetFortress.id,
      ships: { swarmMothership: 1 },
      now: 100_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);

    // Target fortress should not be captured or occupied
    assert.notEqual(universe.planets[targetFortress.id]?.ownerPlayerId, a.player.id);
    assert.equal(universe.occupations?.[targetFortress.id], undefined);
  });
});

describe("Occupied mini planet is owned by the occupier (B7-54)", () => {
  it("lets the occupier queue a building, ship, and defense; the previous owner cannot", () => {
    const universe = createUniverse("Occ Build", 8);
    const a = joinUniverse(universe, "Occupier", 500_000_000);
    const b = joinUniverse(universe, "Previous", 500_000_001);
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 2, 20, 500_000_000, "standard");
    mini.ownerPlayerId = b.player.id;
    b.player.planetIds.push(mini.id);
    mini.buildings.shipyard = 2;
    mini.resources = { metal: 100_000, crystal: 100_000, deuterium: 20_000 };
    universe.planets[mini.id] = mini;
    if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
    if (!universe.miniPlanetIds.includes(mini.id)) universe.miniPlanetIds.push(mini.id);

    universe.planets[a.planet.id]!.ships.swarmMothership = 1;
    universe.planets[a.planet.id]!.ships.interceptor = 50;
    universe.planets[a.planet.id]!.resources.deuterium = 10_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "occupy",
      targetPlanetId: mini.id,
      ships: { swarmMothership: 1, interceptor: 50 },
      now: 500_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const held = universe.planets[mini.id]!;
    assert.equal(held.ownerPlayerId, a.player.id);
    assert.equal(universe.occupations?.[mini.id]?.occupierPlayerId, a.player.id);
    assert.ok(a.player.planetIds.includes(mini.id));
    assert.equal(a.player.planetIds.filter((id) => id === mini.id).length, 1);
    assert.equal(b.player.planetIds.includes(mini.id), false);

    held.buildings.shipyard = 2;
    held.resources = { metal: 100_000, crystal: 100_000, deuterium: 20_000 };
    const now = launch.fleet.arrivesAt;
    const building = queueBuildingUpgrade(universe, a.player.id, "metalMine", now, mini.id);
    assert.equal(building.ok, true, !building.ok ? building.error : "");
    const ship = queueShipBuild(universe, a.player.id, "scout", 1, now + 1, mini.id);
    assert.equal(ship.ok, true, !ship.ok ? ship.error : "");
    const defense = queueDefenseBuild(universe, a.player.id, "laserBattery", 1, now + 2, mini.id);
    assert.equal(defense.ok, true, !defense.ok ? defense.error : "");

    const previous = queueBuildingUpgrade(universe, b.player.id, "metalMine", now + 3, mini.id);
    assert.equal(previous.ok, false);
    if (!previous.ok) assert.match(previous.error, /Planet missing|do not own/);

    const galaxy = galaxyViewFor(universe, a.player.id, mini.coords.galaxy, mini.coords.system, now + 4);
    const row = galaxy.minis.find((body) => body.planetId === mini.id);
    assert.ok(row);
    assert.equal(row.isOwn, true);
    assert.equal(row.playerName, "Occupier");
  });

  it("still blocks building, shipyard, and defense on an occupied non-mini planet", () => {
    const universe = createUniverse("Occ Block", 1);
    const a = joinUniverse(universe, "Occupier", 510_000_000);
    const b = joinUniverse(universe, "Owner", 510_000_001);
    const now = 510_000_100;
    const planet = universe.planets[b.planet.id]!;
    planet.buildings.shipyard = 2;
    planet.resources = { metal: 100_000, crystal: 100_000, deuterium: 20_000 };
    universe.occupations![planet.id] = {
      planetId: planet.id,
      occupierPlayerId: a.player.id,
      mothershipFleetId: "flt_block",
      startedAt: now,
      endsAt: now + OCCUPATION_DURATION_MS,
    };

    const building = queueBuildingUpgrade(universe, b.player.id, "metalMine", now, planet.id);
    const ship = queueShipBuild(universe, b.player.id, "scout", 1, now, planet.id);
    const defense = queueDefenseBuild(universe, b.player.id, "laserBattery", 1, now, planet.id);
    assert.equal(building.ok, false);
    assert.equal(ship.ok, false);
    assert.equal(defense.ok, false);
    if (!building.ok) assert.equal(building.error, "Construction blocked while planet is occupied.");
    if (!ship.ok) assert.equal(ship.error, "Shipyard blocked while planet is occupied.");
    if (!defense.ok) assert.equal(defense.error, "Defense yard blocked while planet is occupied.");
  });

  it("keeps mine income on an occupied mini instead of the 30/70 split", () => {
    const universe = createUniverse("Occ Income", 1);
    const a = joinUniverse(universe, "Occupier", 520_000_000);
    const now = 520_000_000 + 100 * 24 * 60 * 60 * 1000;
    a.player.createdAt = 520_000_000;
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 3, 21, now, "standard");
    mini.ownerPlayerId = a.player.id;
    a.player.planetIds.push(mini.id);
    mini.buildings.metalMine = 8;
    mini.buildings.solarPlant = 20;
    mini.buildings.metalStorage = 12;
    mini.resources = { metal: 0, crystal: 0, deuterium: 0 };
    mini.lastTickAt = now;
    universe.planets[mini.id] = mini;
    if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
    if (!universe.miniPlanetIds.includes(mini.id)) universe.miniPlanetIds.push(mini.id);
    universe.occupations![mini.id] = {
      planetId: mini.id,
      occupierPlayerId: a.player.id,
      mothershipFleetId: "flt_income",
      startedAt: now,
      endsAt: now + OCCUPATION_DURATION_MS,
    };
    const home = universe.planets[a.planet.id]!;
    home.buildings.metalMine = 0;
    home.buildings.crystalMine = 0;
    home.buildings.deutSynth = 0;
    home.resources = { metal: 0, crystal: 0, deuterium: 0 };
    home.lastTickAt = now;

    const expectedMini = productionPerHour(mini, universe.speed, 0, {
      mineOutput: 1,
      energyOutput: 1,
    }, a.player.research);
    const expectedHome = productionPerHour(home, universe.speed, 0, {
      mineOutput: 1,
      energyOutput: 1,
    }, a.player.research);
    advanceUniverse(universe, now + 3_600_000);

    const miniGain = universe.planets[mini.id]!.resources.metal;
    const homeGain = universe.planets[a.planet.id]!.resources.metal;
    assert.ok(expectedMini.metal > expectedHome.metal);
    assert.ok(Math.abs(miniGain - expectedMini.metal) < 1e-6);
    assert.ok(Math.abs(homeGain - expectedHome.metal) < 1e-6);
    assert.equal(universe.planets[mini.id]!.ownerPlayerId, a.player.id);
  });

  it("keeps the capturer as owner when the occupation ends, and recapture does not duplicate the planet", () => {
    const universe = createUniverse("Occ End", 1);
    const a = joinUniverse(universe, "Occupier", 530_000_000);
    const c = joinUniverse(universe, "Recaptor", 530_000_001);
    const now = 530_000_100;
    const mini = createMiniPlanet(universe.seed ?? universe.id, 1, 4, 22, now, "standard");
    mini.ownerPlayerId = a.player.id;
    a.player.planetIds.push(mini.id);
    mini.buildings.shipyard = 1;
    mini.resources = { metal: 50_000, crystal: 50_000, deuterium: 0 };
    mini.buildQueue = [{
      id: "q1",
      kind: "building",
      buildingId: "metalMine",
      targetLevel: 1,
      enqueuedAt: now,
      workSeconds: 10_000,
      startedAt: now,
      completesAt: now + 10_000_000,
      paidCost: { metal: 60, crystal: 15, deuterium: 0 },
    }];
    universe.planets[mini.id] = mini;
    if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
    if (!universe.miniPlanetIds.includes(mini.id)) universe.miniPlanetIds.push(mini.id);
    universe.occupations![mini.id] = {
      planetId: mini.id,
      occupierPlayerId: a.player.id,
      mothershipFleetId: "flt_end",
      startedAt: now,
      endsAt: now + 1_000,
    };

    advanceUniverse(universe, now + 2_000);
    assert.equal(universe.occupations?.[mini.id], undefined);
    assert.equal(universe.planets[mini.id]!.ownerPlayerId, a.player.id);
    assert.ok(a.player.planetIds.includes(mini.id));
    const still = queueBuildingUpgrade(universe, a.player.id, "crystalMine", now + 2_000, mini.id);
    assert.equal(still.ok, true, !still.ok ? still.error : "");

    const cap = captureMiniPlanet(universe, c.player.id, universe.planets[mini.id]!);
    assert.equal(cap.ok, true);
    assert.equal(universe.planets[mini.id]!.ownerPlayerId, c.player.id);
    assert.equal(universe.planets[mini.id]!.buildQueue.length, 0);
    assert.equal(c.player.planetIds.filter((id) => id === mini.id).length, 1);
    assert.equal(a.player.planetIds.includes(mini.id), false);
    assert.equal(Object.values(universe.planets).filter((p) => p.id === mini.id).length, 1);
  });

  it("loads an old save that omits occupation fields without dropping progress", () => {
    const raw = readFileSync(
      new URL("../../../apps/server/src/fixtures/catalog-complete-save.json", import.meta.url),
      "utf8",
    );
    const save = JSON.parse(raw) as { universe?: UniverseState } & UniverseState;
    const universe = (save.universe ?? save) as UniverseState;
    const planetId = Object.keys(universe.planets)[0]!;
    const planet = universe.planets[planetId]!;
    const buildings = JSON.stringify(planet.buildings);
    const queue = JSON.stringify(planet.buildQueue ?? []);
    delete (universe as { occupations?: unknown }).occupations;
    ensureUniverseShape(universe);
    assert.ok(universe.occupations);
    assert.equal(JSON.stringify(universe.planets[planetId]!.buildings), buildings);
    assert.equal(JSON.stringify(universe.planets[planetId]!.buildQueue ?? []), queue);
  });
});
