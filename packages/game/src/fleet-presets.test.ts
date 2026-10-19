import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPEDITION_SLOT } from "./catalog.js";
import { normalizeFleetShips } from "./formulas.js";
import {
  advanceUniverse,
  batchScanSystem,
  createUniverse,
  deleteFleetPreset,
  ensureUniverseShape,
  joinUniverse,
  launchMaxExpeditions,
  listFleetPresets,
  playerView,
  saveFleetPreset,
} from "./world.js";

describe("fleet presets + batch galaxy actions", () => {
  it("seeds built-in presets on join / ensure", () => {
    const universe = createUniverse("Preset Drift", 8);
    const a = joinUniverse(universe, "Preset Pilot", 150_000_000);
    const presets = listFleetPresets(a.player);
    assert.equal(presets.length >= 5, true);
    assert.deepEqual(
      presets.filter((p) => p.builtIn).map((p) => p.name),
      [
        "Expedition",
        "Raid",
        "Moon Destruction",
        "Mini Planet Capture",
        "Mini Planet Destruction",
      ],
    );
    ensureUniverseShape(universe);
    assert.equal(
      universe.players[a.player.id].fleetPresets?.some(
        (p) => p.id === "expedition",
      ),
      true,
    );
  });

  it("saves custom presets and edits built-in ship counts", () => {
    const universe = createUniverse("Custom Drift", 8);
    const a = joinUniverse(universe, "Customist", 150_100_000);

    const edited = saveFleetPreset(universe, a.player.id, {
      id: "expedition",
      name: "ignored",
      ships: { scout: 5, hauler: 2 },
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    const exp = edited.presets.find((p) => p.id === "expedition");
    assert.equal(exp?.name, "Expedition");
    assert.equal(exp?.ships.scout, 5);
    assert.equal(exp?.ships.hauler, 2);

    const custom = saveFleetPreset(universe, a.player.id, {
      name: "Night Raid",
      ships: { bomber: 3, interceptor: 20 },
    });
    assert.equal(custom.ok, true);
    if (!custom.ok) return;
    const night = custom.presets.find((p) => p.name === "Night Raid");
    assert.ok(night);
    assert.equal(night?.builtIn, false);

    const delBuiltin = deleteFleetPreset(universe, a.player.id, "raid");
    assert.equal(delBuiltin.ok, false);

    const del = deleteFleetPreset(universe, a.player.id, night!.id);
    assert.equal(del.ok, true);
    if (!del.ok) return;
    assert.equal(
      del.presets.some((p) => p.id === night!.id),
      false,
    );
  });

  it("launchMaxExpeditions splits every ship type evenly across free expedition slots (leftovers to first slots)", () => {
    const universe = createUniverse("Max Exp Drift", 8);
    const a = joinUniverse(universe, "MaxExp", 150_200_000);
    const player = universe.players[a.player.id];
    player.research.astrophysics = 2; // 3 expedition slots
    player.research.computerTech = 5; // plenty of fleet slots
    // 10 cargo (hauler) + 3 fighters (interceptor) over 3 slots -> cargo 4/3/3, fighters 1/1/1
    universe.planets[a.planet.id].ships.hauler = 10;
    universe.planets[a.planet.id].ships.interceptor = 3;
    universe.planets[a.planet.id].resources.deuterium = 50_000;

    const batch = launchMaxExpeditions(universe, {
      playerId: a.player.id,
      now: 150_200_100,
    });
    assert.equal(batch.ok, true);
    if (!batch.ok) return;
    assert.equal(batch.launched.length, 3);
    assert.equal(
      batch.launched.every((f) => f.mission === "expedition"),
      true,
    );
    assert.equal(
      batch.launched.every((f) => f.targetCoords.slot === EXPEDITION_SLOT),
      true,
    );
    assert.deepEqual(
      batch.launched[0].ships,
      normalizeFleetShips({ hauler: 4, interceptor: 1 }),
    );
    assert.deepEqual(
      batch.launched[1].ships,
      normalizeFleetShips({ hauler: 3, interceptor: 1 }),
    );
    assert.deepEqual(
      batch.launched[2].ships,
      normalizeFleetShips({ hauler: 3, interceptor: 1 }),
    );
    assert.equal(universe.planets[a.planet.id].ships.hauler, 0);
    assert.equal(universe.planets[a.planet.id].ships.interceptor, 0);

    const again = launchMaxExpeditions(universe, {
      playerId: a.player.id,
      now: 150_200_200,
    });
    assert.equal(again.ok, false);
  });

  it("launchMaxExpeditions uses explicit preset/ships when provided by caller", () => {
    const universe = createUniverse("Max Exp Explicit Drift", 8);
    const a = joinUniverse(universe, "MaxExpExplicit", 150_250_000);
    const player = universe.players[a.player.id];
    player.research.astrophysics = 2; // 3 expedition slots
    player.research.computerTech = 5; // plenty of fleet slots
    universe.planets[a.planet.id].ships.scout = 20;
    universe.planets[a.planet.id].ships.hauler = 10;
    universe.planets[a.planet.id].resources.deuterium = 50_000;

    const batch = launchMaxExpeditions(universe, {
      playerId: a.player.id,
      ships: { scout: 2, hauler: 1 },
      now: 150_250_100,
    });
    assert.equal(batch.ok, true);
    if (!batch.ok) return;
    assert.equal(batch.launched.length, 3);
    assert.deepEqual(
      batch.launched[0].ships,
      normalizeFleetShips({ scout: 2, hauler: 1 }),
    );
    assert.deepEqual(
      batch.launched[1].ships,
      normalizeFleetShips({ scout: 2, hauler: 1 }),
    );
    assert.deepEqual(
      batch.launched[2].ships,
      normalizeFleetShips({ scout: 2, hauler: 1 }),
    );
    assert.equal(universe.planets[a.planet.id].ships.scout, 14);
    assert.equal(universe.planets[a.planet.id].ships.hauler, 7);
  });

  it("batchScanSystem probes every foreign-owned body in the system", () => {
    const universe = createUniverse("Scan Drift", 8);
    const a = joinUniverse(universe, "Scanner", 150_300_000);
    const b = joinUniverse(universe, "TargetA", 150_300_100);
    const c = joinUniverse(universe, "TargetB", 150_300_200);

    // Place B and C in A's system on different slots.
    const home = universe.planets[a.planet.id];
    universe.planets[b.planet.id].coords = {
      galaxy: home.coords.galaxy,
      system: home.coords.system,
      slot: Math.min(15, home.coords.slot === 2 ? 3 : 2),
    };
    universe.planets[c.planet.id].coords = {
      galaxy: home.coords.galaxy,
      system: home.coords.system,
      slot: Math.min(15, home.coords.slot === 4 ? 5 : 4),
    };

    universe.players[a.player.id].research.computerTech = 5;
    universe.planets[a.planet.id].ships.probe = 5;
    universe.planets[a.planet.id].resources.deuterium = 5_000;

    const batch = batchScanSystem(universe, {
      playerId: a.player.id,
      galaxy: home.coords.galaxy,
      system: home.coords.system,
      now: 150_300_300,
    });
    assert.equal(batch.ok, true);
    if (!batch.ok) return;
    assert.equal(batch.launched.length, 2);
    assert.equal(
      batch.launched.every((f) => f.mission === "espionage"),
      true,
    );
    assert.equal(universe.planets[a.planet.id].ships.probe, 3);

    for (const fleet of batch.launched) {
      advanceUniverse(universe, fleet.arrivesAt);
    }
    const view = playerView(universe, a.player.id, 150_400_000);
    assert.ok(view.spyReports.length >= 2);
  });
});
