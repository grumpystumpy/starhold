import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPEDITION_SLOT } from "./catalog.js";
import { FLEET_SAVE_MIN_LEAD_MS } from "./data/tuning.js";
import { normalizeFleetShips } from "./formulas-travel.js";
import type { Coordinates, FleetMission, PlanetState, UniverseState } from "./types.js";
import {
  createUniverse,
  fleetSaveSuggestions,
  joinUniverse,
  launchFleet,
  playerView,
} from "./world.js";

const NOW = 1_700_000_000_000;

function stage(): {
  universe: UniverseState;
  playerId: string;
  home: PlanetState;
} {
  const universe = createUniverse("Fleet Save", 8);
  const joined = joinUniverse(universe, "Saver", NOW);
  joined.planet.ships = { scout: 4, helioBuoy: 2, veinAnchor: 1 };
  return { universe, playerId: joined.player.id, home: joined.planet };
}

function addBody(
  universe: UniverseState,
  playerId: string,
  id: string,
  coords: Coordinates,
  kind: "planet" | "moon" = "planet",
  mini = false,
): PlanetState {
  const home = universe.planets[universe.players[playerId]!.homePlanetId]!;
  const body = structuredClone(home);
  body.id = id;
  body.name = id;
  body.kind = kind;
  body.coords = { ...coords };
  body.ownerPlayerId = playerId;
  body.ships = {};
  body.parentPlanetId = kind === "moon" ? home.id : null;
  body.flags = mini ? { mini: true, miniKind: "standard" } : undefined;
  universe.planets[id] = body;
  universe.players[playerId]!.planetIds.push(id);
  return body;
}

function raid(
  playerId: string,
  target: PlanetState,
  arrivesAt: number,
  overrides: Partial<FleetMission> = {},
): FleetMission {
  return {
    id: "atk-1",
    ownerPlayerId: "plyr_enemy",
    originPlanetId: "enemy-home",
    targetPlanetId: target.id,
    targetPlayerId: playerId,
    targetCoords: { ...target.coords },
    mission: "raid",
    ships: normalizeFleetShips({ scout: 1 }),
    cargo: { metal: 0, crystal: 0, deuterium: 0 },
    departedAt: NOW,
    arrivesAt,
    phase: "outbound",
    reportId: null,
    ...overrides,
  };
}

describe("fleet save suggestions", () => {
  it("deploys mobile ships to the nearest planet or moon", () => {
    const { universe, playerId, home } = stage();
    const far = addBody(universe, playerId, "far", {
      galaxy: home.coords.galaxy + 1,
      system: home.coords.system,
      slot: home.coords.slot,
    });
    const near = addBody(universe, playerId, "near", {
      ...home.coords,
      slot: home.coords.slot === 15 ? 14 : home.coords.slot + 1,
    });
    const moon = addBody(
      universe,
      playerId,
      "moon",
      { ...home.coords },
      "moon",
    );
    const suggestions = fleetSaveSuggestions(
      universe,
      playerId,
      [raid(playerId, home, NOW + FLEET_SAVE_MIN_LEAD_MS + 1)],
      NOW,
    );
    assert.equal(suggestions.length, 1);
    const row = suggestions[0]!;
    assert.equal(row.mission, "deploy");
    assert.equal(row.originPlanetId, home.id);
    assert.equal(row.targetPlanetId, moon.id);
    assert.equal(row.targetCoords, null);
    assert.deepEqual(row.ships, { scout: 4 });
    assert.equal(home.ships.helioBuoy, 2);
    assert.notEqual(row.targetPlanetId, near.id);
    assert.notEqual(row.targetPlanetId, far.id);
  });

  it("breaks a distance tie by planet id", () => {
    const { universe, playerId, home } = stage();
    home.coords = { galaxy: 2, system: 5, slot: 8 };
    addBody(universe, playerId, "z-haven", { galaxy: 2, system: 5, slot: 10 });
    addBody(universe, playerId, "a-haven", { galaxy: 2, system: 5, slot: 6 });
    const [row] = fleetSaveSuggestions(
      universe,
      playerId,
      [raid(playerId, home, NOW + 120_000)],
      NOW,
    );
    assert.equal(row?.targetPlanetId, "a-haven");
  });

  it("sends a one-world commander on an expedition the server accepts", () => {
    const { universe, playerId, home } = stage();
    home.resources.deuterium = 50_000;
    addBody(
      universe,
      playerId,
      "mini-only",
      { ...home.coords, slot: home.coords.slot === 1 ? 2 : 1 },
      "planet",
      true,
    );
    const [row] = fleetSaveSuggestions(
      universe,
      playerId,
      [raid(playerId, home, NOW + 120_000)],
      NOW,
    );
    assert.ok(row);
    assert.equal(row?.mission, "expedition");
    assert.equal(row?.originPlanetId, home.id);
    assert.equal(row?.targetPlanetId, null);
    assert.equal(row?.targetCoords?.slot, EXPEDITION_SLOT);
    assert.equal(row?.targetCoords?.galaxy, home.coords.galaxy);
    assert.equal(row?.targetCoords?.system, home.coords.system);
    assert.deepEqual(row?.ships, { scout: 4 });
    const launch = launchFleet(universe, {
      playerId,
      originPlanetId: row!.originPlanetId,
      mission: row!.mission,
      ships: row!.ships,
      targetCoords: row!.targetCoords ?? undefined,
      now: NOW,
    });
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (!launch.ok) return;
    assert.equal(launch.fleet.mission, "expedition");
    assert.equal(launch.fleet.targetCoords.slot, EXPEDITION_SLOT);
  });

  it("hides the reminder when a one-world commander has no free expedition slot", () => {
    const { universe, playerId, home } = stage();
    universe.fleets.out = raid(playerId, home, NOW + 90_000, {
      id: "out",
      ownerPlayerId: playerId,
      mission: "expedition",
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...home.coords, slot: EXPEDITION_SLOT },
    });
    assert.deepEqual(
      fleetSaveSuggestions(
        universe,
        playerId,
        [raid(playerId, home, NOW + 120_000)],
        NOW,
      ),
      [],
    );
  });

  it("skips spies, short notice, stationary hangars, and own fleets", () => {
    const { universe, playerId, home } = stage();
    addBody(universe, playerId, "haven", {
      ...home.coords,
      slot: home.coords.slot === 1 ? 2 : 1,
    });
    const soon = raid(playerId, home, NOW + FLEET_SAVE_MIN_LEAD_MS);
    const spy = raid(playerId, home, NOW + 120_000, {
      id: "spy",
      mission: "espionage",
    });
    const own = raid(playerId, home, NOW + 120_000, {
      id: "own",
      ownerPlayerId: playerId,
    });
    const returning = raid(playerId, home, NOW + 120_000, {
      id: "back",
      phase: "returning",
    });
    assert.deepEqual(
      fleetSaveSuggestions(universe, playerId, [soon, spy, own, returning], NOW),
      [],
    );

    home.ships = { helioBuoy: 3 };
    assert.deepEqual(
      fleetSaveSuggestions(
        universe,
        playerId,
        [raid(playerId, home, NOW + 120_000)],
        NOW,
      ),
      [],
    );
  });

  it("includes a pirate raid and leaves the universe fleets untouched", () => {
    const { universe, playerId, home } = stage();
    const colony = addBody(universe, playerId, "colony", {
      ...home.coords,
      system: home.coords.system === 1 ? 2 : home.coords.system - 1,
    });
    const pirate = raid(playerId, home, NOW + 180_000, {
      id: "pirate-raid",
      ownerPlayerId: "npc_pirates",
      originPlanetId: "",
      originPirateBaseId: "pir-1",
    });
    universe.fleets[pirate.id] = pirate;
    const before = Object.keys(universe.fleets).length;
    const [row] = fleetSaveSuggestions(universe, playerId, [pirate], NOW);
    assert.equal(row?.attackId, "pirate-raid");
    assert.equal(row?.mission, "deploy");
    assert.equal(row?.targetPlanetId, colony.id);
    assert.equal(Object.keys(universe.fleets).length, before);

    const view = playerView(universe, playerId, NOW);
    assert.equal(view.fleetSave?.[0]?.attackId, "pirate-raid");
    assert.equal(view.fleetSave?.[0]?.ships.scout, 4);
  });
});
