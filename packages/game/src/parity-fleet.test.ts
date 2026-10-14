import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAP_SLOTS } from "./catalog.js";
import {
  advanceUniverse,
  createUniverse,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  playerView,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
  queueShipBuild,
  setActivePlanet,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

describe("P0/P1 parity — fleets & galaxy", () => {
  it("galaxy view lists empty and occupied slots", () => {
    const universe = createUniverse("Galaxy Drift", 8);
    const a = joinUniverse(universe, "Mapper", 70_000_000);
    const view = galaxyViewFor(
      universe,
      a.player.id,
      a.planet.coords.galaxy,
      a.planet.coords.system,
    );
    assert.equal(view.slots.length, MAP_SLOTS);
    const occupied = view.slots.filter((s) => s.planetId);
    assert.ok(occupied.length >= 1);
    const empty = view.slots.filter((s) => !s.planetId);
    assert.ok(empty.length >= 1);
  });

  it("colonize founds a second planet; transport docks cargo", () => {
    const universe = createUniverse("Colony Drift", 8);
    const a = joinUniverse(universe, "Settler", 80_000_000);
    universe.players[a.player.id].research.astrophysics = 1;
    universe.planets[a.planet.id].ships.colonyShip = 1;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources = {
      metal: 5_000,
      crystal: 5_000,
      deuterium: 5_000,
    };

    const galaxy = galaxyViewFor(
      universe,
      a.player.id,
      a.planet.coords.galaxy,
      a.planet.coords.system,
    );
    const empty = galaxy.slots.find((s) => !s.planetId);
    assert.ok(empty);

    const colonize = launchFleet(universe, {
      playerId: a.player.id,
      mission: "colonize",
      targetCoords: empty!.coords,
      ships: { colonyShip: 1 },
      now: 80_000_100,
    });
    assert.equal(colonize.ok, true);
    if (!colonize.ok) return;
    advanceUniverse(universe, colonize.fleet.arrivesAt);
    assert.equal(universe.players[a.player.id].planetIds.length, 2);

    const colonyId = universe.players[a.player.id].planetIds.find(
      (id) => id !== a.planet.id,
    )!;
    setActivePlanet(universe, a.player.id, a.planet.id, 80_000_200);
    universe.planets[a.planet.id].ships.hauler = 1;

    const transport = launchFleet(universe, {
      playerId: a.player.id,
      mission: "transport",
      targetPlanetId: colonyId,
      ships: { hauler: 1 },
      cargo: { metal: 100, crystal: 50, deuterium: 0 },
      now: 80_000_300,
    });
    assert.equal(transport.ok, true);
    if (!transport.ok) return;
    const metalBefore = universe.planets[colonyId].resources.metal;
    advanceUniverse(universe, transport.fleet.arrivesAt);
    assert.ok(universe.planets[colonyId].resources.metal > metalBefore);
    assert.equal(universe.planets[colonyId].ships.hauler, 1);
  });

  it("raid creates debris; recycler harvests it", () => {
    const universe = createUniverse("Debris Drift", 8);
    const a = joinUniverse(universe, "Harvester", 90_000_000);
    const b = joinUniverse(universe, "Wreck", 90_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.interceptor = 5;
    universe.planets[a.planet.id].ships.recycler = 1;
    universe.planets[a.planet.id].resources.deuterium = 2_000;
    universe.planets[b.planet.id].ships.scout = 8;

    const raid = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { interceptor: 5 },
      90_000_100,
    );
    assert.equal(raid.ok, true);
    if (!raid.ok) return;
    advanceUniverse(universe, raid.fleet.arrivesAt);
    const mid = universe.fleets[raid.fleet.id];
    if (mid) advanceUniverse(universe, mid.arrivesAt);

    const debrisKeys = Object.keys(universe.debris);
    assert.ok(debrisKeys.length >= 1, "expected debris after combat");

    const field = Object.values(universe.debris)[0];
    const harvest = launchFleet(universe, {
      playerId: a.player.id,
      mission: "harvest",
      targetCoords: field.coords,
      ships: { recycler: 1 },
      now: 90_001_000,
    });
    assert.equal(harvest.ok, true);
    if (!harvest.ok) return;
    advanceUniverse(universe, harvest.fleet.arrivesAt);
    const ret = universe.fleets[harvest.fleet.id];
    assert.ok(ret);
    assert.ok(ret.cargo.metal + ret.cargo.crystal > 0);
  });

  it("builds probe via shipyard after yard unlock", () => {
    const universe = createUniverse("Probe Drift", 8);
    const { player, planet } = joinUniverse(universe, "Builder", 91_000_000);
    planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 50_000 };
    planet.buildings.shipyard = 1;
    const build = queueShipBuild(
      universe,
      player.id,
      "probe",
      3,
      91_000_100,
    );
    assert.equal(build.ok, true);
    if (!build.ok) return;
    advanceUniverse(universe, build.planet.shipQueue[0]!.completesAt);
    assert.equal(universe.planets[planet.id].ships.probe, 3);
  });
});
