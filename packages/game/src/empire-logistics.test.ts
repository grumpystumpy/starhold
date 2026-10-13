import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SPY_REPORT_TTL_MS } from "./catalog.js";
import {
  economySnapshot,
  fieldsCap,
  fieldsRemaining,
  fieldsUsed,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  playerView,
  pruneSpyReports,
  queueBuildingUpgrade,
  setActivePlanet,
} from "./world.js";

describe("empire logistics — deploy park", () => {
  it("deploy to own colony docks ships (no return leg)", () => {
    const universe = createUniverse("Park Drift", 8);
    const a = joinUniverse(universe, "Porter", 110_000_000);
    universe.players[a.player.id].research.astrophysics = 1;
    universe.planets[a.planet.id].ships.colonyShip = 1;
    universe.planets[a.planet.id].ships.scout = 4;
    universe.planets[a.planet.id].resources.deuterium = 5_000;

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
      now: 110_000_100,
    });
    assert.equal(colonize.ok, true);
    if (!colonize.ok) return;
    advanceUniverse(universe, colonize.fleet.arrivesAt);

    const colonyId = universe.players[a.player.id].planetIds.find(
      (id) => id !== a.planet.id,
    )!;
    setActivePlanet(universe, a.player.id, a.planet.id, 110_000_200);
    universe.planets[a.planet.id].ships.scout = 4;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    const colonyScoutsBefore = universe.planets[colonyId].ships.scout ?? 0;

    const deploy = launchFleet(universe, {
      playerId: a.player.id,
      mission: "deploy",
      targetPlanetId: colonyId,
      ships: { scout: 3 },
      now: 110_000_300,
    });
    assert.equal(deploy.ok, true);
    if (!deploy.ok) return;
    assert.equal(universe.planets[a.planet.id].ships.scout, 1);

    advanceUniverse(universe, deploy.fleet.arrivesAt);
    assert.equal(universe.fleets[deploy.fleet.id], undefined);
    assert.equal(
      universe.planets[colonyId].ships.scout,
      colonyScoutsBefore + 3,
    );
    assert.equal(universe.planets[a.planet.id].ships.scout, 1);
  });

  it("deploy to rival still returns home", () => {
    const universe = createUniverse("Visit Drift", 8);
    const a = joinUniverse(universe, "Visitor", 111_000_000);
    const b = joinUniverse(universe, "Host", 111_000_001);
    universe.planets[a.planet.id].ships.scout = 2;
    universe.planets[a.planet.id].resources.deuterium = 200;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "deploy",
      { scout: 2 },
      111_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");

    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.equal(universe.planets[a.planet.id].ships.scout, 2);
  });
});

describe("empire logistics — spy intel decay", () => {
  it("prunes spy reports older than SPY_REPORT_TTL_MS", () => {
    const universe = createUniverse("Intel Drift", 8);
    const a = joinUniverse(universe, "Spy", 112_000_000);
    const b = joinUniverse(universe, "Mark", 112_000_001);
    universe.planets[a.planet.id].ships.probe = 1;
    universe.planets[a.planet.id].resources.deuterium = 200;
    universe.players[a.player.id].research.espionageTech = 3;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      targetPlanetId: b.planet.id,
      mission: "espionage",
      ships: { probe: 1 },
      now: 112_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    assert.ok(Object.keys(universe.spyReports).length >= 1);

    const report = Object.values(universe.spyReports)[0]!;
    const stillFresh = report.at + SPY_REPORT_TTL_MS - 1;
    assert.equal(pruneSpyReports(universe, stillFresh), 0);
    assert.ok(Object.keys(universe.spyReports).length >= 1);

    const expiredAt = report.at + SPY_REPORT_TTL_MS + 1;
    advanceUniverse(universe, expiredAt);
    assert.equal(Object.keys(universe.spyReports).length, 0);
    const view = playerView(universe, a.player.id, expiredAt);
    assert.equal(view.spyReports.length, 0);
  });
});

describe("empire logistics — planet fields", () => {
  it("exposes fields on economySnapshot / playerView", () => {
    const universe = createUniverse("Fields Drift", 8);
    const a = joinUniverse(universe, "Builder", 113_000_000);
    const planet = universe.planets[a.planet.id];
    const cap = fieldsCap(planet);
    const snap = economySnapshot(planet, universe.speed);
    assert.equal(snap.fields.cap, cap);
    assert.ok(cap >= 250);
    assert.equal(snap.fields.used, fieldsUsed(planet));
    assert.equal(snap.fields.remaining, fieldsRemaining(planet));
    assert.ok(snap.fields.remaining > 0);
    assert.ok(snap.positionMult);

    const view = playerView(universe, a.player.id, 113_000_100);
    assert.equal(view.economy.fields.cap, cap);
    assert.equal(view.economy.fields.used, snap.fields.used);
  });

  it("blocks building upgrade when no fields remain", () => {
    const universe = createUniverse("Cap Drift", 8);
    const a = joinUniverse(universe, "Crowded", 114_000_000);
    const planet = universe.planets[a.planet.id];
    const cap = fieldsCap(planet);
    // Fill soft-cap: each building level costs 1 field.
    planet.buildings.metalMine = cap;
    planet.buildings.crystalMine = 0;
    planet.buildings.deutSynth = 0;
    planet.buildings.solarPlant = 0;
    planet.buildings.metalStorage = 0;
    planet.buildings.crystalStorage = 0;
    planet.buildings.deutTank = 0;
    planet.buildings.shipyard = 0;
    planet.buildings.researchLab = 0;
    planet.resources = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };
    assert.equal(fieldsRemaining(planet), 0);

    const blocked = queueBuildingUpgrade(
      universe,
      a.player.id,
      "crystalMine",
      114_000_100,
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /fields/i);
  });
});
