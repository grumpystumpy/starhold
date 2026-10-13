import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEP_SPACE_SLOT,
  EXPEDITION_SLOT,
  FIELD_MIN,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  UNIVERSE_SCHEMA_VERSION,
} from "./catalog.js";
import {
  economySnapshot,
  fieldsCap,
  productionMultForSlot,
  productionPerHour,
  rollPlanetFields,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  playerView,
} from "./world.js";

describe("universe map constants (contract A)", () => {
  it("exposes 10×399×15 + deep space 16", () => {
    assert.equal(MAP_GALAXIES, 10);
    assert.equal(MAP_SYSTEMS, 399);
    assert.equal(MAP_SLOTS, 15);
    assert.equal(DEEP_SPACE_SLOT, 16);
    assert.equal(EXPEDITION_SLOT, 16);
    assert.equal(UNIVERSE_SCHEMA_VERSION, 2);
  });

  it("createUniverse stamps schemaVersion + seed + asteroid map", () => {
    const universe = createUniverse("Map Drift", 8);
    assert.equal(universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
    assert.ok(universe.seed);
    assert.ok(universe.asteroids);
    assert.ok(universe.pirateBases);
    assert.ok(Object.keys(universe.asteroids!).length > 0);
  });

  it("join prefers mid home slots (4–12)", () => {
    const universe = createUniverse("Home Drift", 8);
    const { planet } = joinUniverse(universe, "Homebody", 200_000_000);
    assert.ok(planet.coords.slot >= 4 && planet.coords.slot <= 12);
    assert.equal(planet.coords.galaxy, 1);
    assert.equal(planet.coords.system, 1);
  });
});

describe("planet fields curve", () => {
  it("slots 1 and 15 floor at 250; slot 8 peaks", () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      rollPlanetFields(1, `slot1-${i}`),
    );
    assert.ok(samples.every((n) => n >= FIELD_MIN));
    assert.ok(samples.every((n) => n <= 280));

    const peak = Array.from({ length: 40 }, (_, i) =>
      rollPlanetFields(8, `slot8-${i}`),
    );
    assert.ok(peak.every((n) => n >= 370 && n <= 400));
    assert.ok(Math.max(...peak) > Math.max(...samples));
  });

  it("is deterministic for the same seed", () => {
    assert.equal(
      rollPlanetFields(8, "uni:fields:1:1:8"),
      rollPlanetFields(8, "uni:fields:1:1:8"),
    );
  });

  it("stores fieldsCap on join and echoes in economy", () => {
    const universe = createUniverse("Cap Roll", 8);
    const { planet, player } = joinUniverse(universe, "Capper", 201_000_000);
    assert.ok(typeof planet.fieldsCap === "number");
    assert.equal(fieldsCap(planet), planet.fieldsCap);
    const view = playerView(universe, player.id, 201_000_100);
    assert.equal(view.economy.fields.cap, planet.fieldsCap);
    assert.equal(view.starshards, 0);
    assert.deepEqual(view.officers, []);
    assert.deepEqual(view.skillsUnlocked, []);
  });
});

describe("position production multipliers", () => {
  it("slot 8 is neutral 1.0×", () => {
    const m = productionMultForSlot(8);
    assert.deepEqual(m, {
      metal: 1,
      crystal: 1,
      deuterium: 1,
      energy: 1,
    });
  });

  it("inner slots boost crystal/energy; outer boost deuterium", () => {
    const inner = productionMultForSlot(1);
    const outer = productionMultForSlot(15);
    assert.ok(inner.crystal > 1);
    assert.ok(inner.energy > 1);
    assert.ok(inner.deuterium < 1);
    assert.ok(outer.crystal < 1);
    assert.ok(outer.energy < 1);
    assert.ok(outer.deuterium > 1);
  });

  it("applies mults to productionPerHour / economySnapshot", () => {
    const universe = createUniverse("Pos Drift", 8);
    const { planet } = joinUniverse(universe, "Pos", 202_000_000);
    // Force slot 1 vs 15 on identical mines for comparison.
    const a = {
      ...planet,
      coords: { ...planet.coords, slot: 1 },
      buildings: {
        ...planet.buildings,
        metalMine: 1,
        crystalMine: 1,
        deutSynth: 1,
        solarPlant: 5,
      },
    };
    const b = {
      ...planet,
      coords: { ...planet.coords, slot: 15 },
      buildings: { ...a.buildings },
    };
    const ratesA = productionPerHour(a, 1, 0);
    const ratesB = productionPerHour(b, 1, 0);
    assert.ok(
      ratesA.crystal > ratesB.crystal,
      `crystal inner ${ratesA.crystal} vs outer ${ratesB.crystal}`,
    );
    assert.ok(
      ratesA.deuterium < ratesB.deuterium,
      `deut inner ${ratesA.deuterium} vs outer ${ratesB.deuterium}`,
    );
    const snap = economySnapshot(a, 1, 0);
    assert.equal(snap.positionMult.crystal, productionMultForSlot(1).crystal);
  });
});

describe("galaxy view contract shapes", () => {
  it("returns 15 slots + deepSpace + asteroids + pirateBase", () => {
    const universe = createUniverse("Galaxy Drift", 8);
    const { player, planet } = joinUniverse(universe, "Scout", 203_000_000);
    const view = galaxyViewFor(
      universe,
      player.id,
      planet.coords.galaxy,
      planet.coords.system,
    );
    assert.equal(view.slots.length, MAP_SLOTS);
    assert.equal(view.deepSpace.coords.slot, DEEP_SPACE_SLOT);
    assert.ok(Array.isArray(view.asteroids));
    assert.equal(view.pirateBase, null);
    const home = view.slots.find((s) => s.planetId === planet.id);
    assert.ok(home);
    assert.equal(home!.activity, "planet");
    assert.equal(home!.allianceTag, null);
    assert.equal(typeof home!.hasMoon, "boolean");
  });
});

describe("asteroid harvest mission hooks", () => {
  it("launches harvestAsteroid and collects on arrival", () => {
    const universe = createUniverse("Ast Drift", 8);
    const { player, planet } = joinUniverse(universe, "Miner", 204_000_000);
    const body = universe.planets[planet.id];
    body.ships.recycler = 2;
    body.resources.deuterium = 50_000;
    const asteroid = Object.values(universe.asteroids!)[0];
    assert.ok(asteroid);
    const beforeMetal = asteroid.metal;
    const beforeRichness = asteroid.richness;

    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "harvestAsteroid",
      asteroidId: asteroid.id,
      ships: { recycler: 1 },
      now: 204_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const fleet = universe.fleets[launch.fleet.id];
    assert.ok(fleet);
    assert.equal(fleet.phase, "returning");
    assert.ok(fleet.cargo.metal + fleet.cargo.crystal + fleet.cargo.deuterium > 0);
    const after = universe.asteroids?.[asteroid.id];
    if (after) {
      assert.ok(after.richness < beforeRichness || after.metal < beforeMetal);
    }
  });
});

describe("KV schema migration / reset", () => {
  it("keeps current schema blobs", () => {
    const universe = createUniverse("Keep Drift", 8);
    const result = migrateOrResetUniverse(universe);
    assert.equal(result.didReset, false);
    assert.equal(result.universe.id, universe.id);
    assert.equal(result.archived, null);
  });

  it("resets prototype (schemaVersion missing / 1) blobs", () => {
    const legacy = createUniverse("Legacy Drift", 8);
    delete legacy.schemaVersion;
    // Simulate prototype map player still present.
    joinUniverse(legacy, "OldTimer", 205_000_000);
    legacy.schemaVersion = 1;
    const result = migrateOrResetUniverse(legacy, {
      name: "Fresh Drift",
      speed: 8,
    });
    assert.equal(result.didReset, true);
    assert.ok(result.archived);
    assert.equal(result.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
    assert.equal(Object.keys(result.universe.players).length, 0);
    assert.notEqual(result.universe.id, legacy.id);
  });
});
