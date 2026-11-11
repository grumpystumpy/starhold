import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  coordsKey,
  empireColonyCap,
  emptyDefenses,
  emptyFleetShips,
  maxColonies,
} from "./formulas.js";
import type { FleetMission, PlanetState, UniverseState } from "./types.js";
import { resolveFleetArrival } from "./world-arrival.js";
import {
  abandonColony,
  createUniverse,
  joinUniverse,
  migrateOrResetUniverse,
  moonAtCoords,
  ownedPlanetCount,
  planetAtCoords,
} from "./world.js";

function openCoords(universe: UniverseState, galaxy: number): { galaxy: number; system: number; slot: number } {
  for (let system = 1; system <= 30; system++) {
    for (let slot = 1; slot <= 15; slot++) {
      const coords = { galaxy, system, slot };
      if (!planetAtCoords(universe, coords)) return coords;
    }
  }
  throw new Error("no open slot");
}

function addColony(universe: UniverseState, playerId: string) {
  const player = universe.players[playerId]!;
  const home = universe.planets[player.homePlanetId]!;
  const coords = openCoords(universe, home.coords.galaxy);
  const colony: PlanetState = {
    ...structuredClone(home),
    id: `colony_${playerId}`,
    name: "Far Reach",
    coords,
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    ownerPlayerId: playerId,
    resources: { metal: 111, crystal: 222, deuterium: 333 },
    buildings: { ...home.buildings, metalMine: 3 },
    ships: { ...emptyFleetShips(), scout: 4 },
    defenses: { ...emptyDefenses(), laserBattery: 2 },
  };
  const moon: PlanetState = {
    ...structuredClone(colony),
    id: `moon_${playerId}`,
    name: "Far Reach Moon",
    kind: "moon",
    parentPlanetId: colony.id,
    moonId: null,
    resources: { metal: 9, crystal: 8, deuterium: 7 },
    ships: { ...emptyFleetShips(), scout: 2 },
    defenses: { ...emptyDefenses(), laserBattery: 1 },
    buildings: { ...colony.buildings, metalMine: 0, sensorArray: 2 },
  };
  colony.moonId = moon.id;
  universe.planets[colony.id] = colony;
  universe.planets[moon.id] = moon;
  player.planetIds = [...player.planetIds, colony.id, moon.id];
  player.research.astrophysics = 1;
  universe.players[player.id] = player;
  universe.debris[coordsKey(coords)] = { coords: { ...coords }, metal: 50, crystal: 25 };
  return { player, home, colony, moon, coords };
}

function fleet(partial: Pick<FleetMission, "id" | "ownerPlayerId" | "originPlanetId" | "targetPlanetId"> & {
  targetCoords: FleetMission["targetCoords"];
}): FleetMission {
  return {
    targetPlayerId: partial.ownerPlayerId,
    mission: "raid",
    ships: { ...emptyFleetShips(), scout: 1 },
    cargo: { metal: 0, crystal: 0, deuterium: 0 },
    departedAt: 1,
    arrivesAt: 9_000_000_000_000,
    phase: "outbound",
    reportId: null,
    ...partial,
  };
}

describe("abandonColony", () => {
  it("rejects the homeworld and a moon by itself", () => {
    const universe = createUniverse("Abandon Home", 8);
    const joined = joinUniverse(universe, "Homebody", 5_000_000);
    const home = universe.planets[joined.player.homePlanetId]!;
    const moon: PlanetState = {
      ...structuredClone(home),
      id: "moon_home",
      name: "Home Moon",
      kind: "moon",
      parentPlanetId: home.id,
      moonId: null,
    };
    home.moonId = moon.id;
    universe.planets[moon.id] = moon;
    joined.player.planetIds = [...joined.player.planetIds, moon.id];

    const homeResult = abandonColony(universe, joined.player.id, home.id);
    assert.equal(homeResult.ok, false);
    if (!homeResult.ok) assert.match(homeResult.error, /homeworld/);
    assert.equal(universe.planets[home.id]?.id, home.id);

    const moonResult = abandonColony(universe, joined.player.id, moon.id);
    assert.equal(moonResult.ok, false);
    if (!moonResult.ok) assert.match(moonResult.error, /moon/);
    assert.equal(universe.planets[moon.id]?.kind, "moon");
    assert.equal(universe.planets[home.id]?.moonId, moon.id);
  });

  it("frees the colony slot and deletes the moon", () => {
    const universe = createUniverse("Abandon Slot", 8);
    const owner = joinUniverse(universe, "Settler", 5_100_000);
    const other = joinUniverse(universe, "Raider", 5_100_001);
    const { player, home, colony, moon, coords } = addColony(universe, owner.player.id);
    player.activePlanetId = moon.id;
    const before = ownedPlanetCount(universe, player.id);
    const cap = empireColonyCap(player, universe, maxColonies);
    assert.equal(before, 2);
    assert.ok(cap >= before);

    universe.occupations[colony.id] = {
      planetId: colony.id,
      occupierPlayerId: other.player.id,
      mothershipFleetId: "occ-fleet",
      startedAt: 1,
      endsAt: 9_000_000_000_000,
    };
    universe.occupations[home.id] = {
      planetId: home.id,
      occupierPlayerId: other.player.id,
      mothershipFleetId: "home-occ",
      startedAt: 1,
      endsAt: 9_000_000_000_000,
    };
    const inbound = fleet({
      id: "inbound",
      ownerPlayerId: other.player.id,
      originPlanetId: other.planet.id,
      targetPlanetId: colony.id,
      targetCoords: coords,
    });
    const unrelated = fleet({
      id: "unrelated",
      ownerPlayerId: player.id,
      originPlanetId: home.id,
      targetPlanetId: other.planet.id,
      targetCoords: universe.planets[other.planet.id]!.coords,
    });
    universe.fleets[inbound.id] = inbound;
    universe.fleets[unrelated.id] = unrelated;

    const result = abandonColony(universe, player.id, colony.id);
    assert.equal(result.ok, true);
    assert.equal(universe.planets[colony.id], undefined);
    assert.equal(universe.planets[moon.id], undefined);
    assert.equal(planetAtCoords(universe, coords), null);
    assert.equal(moonAtCoords(universe, coords), null);
    assert.equal(player.planetIds.includes(colony.id), false);
    assert.equal(player.planetIds.includes(moon.id), false);
    assert.equal(player.activePlanetId, player.homePlanetId);
    assert.equal(ownedPlanetCount(universe, player.id), before - 1);
    assert.ok(ownedPlanetCount(universe, player.id) < empireColonyCap(player, universe, maxColonies));
    assert.equal(universe.debris[coordsKey(coords)]?.metal, 50);
    assert.equal(universe.debris[coordsKey(coords)]?.crystal, 25);
    assert.equal(universe.planets[home.id]?.resources.metal, home.resources.metal);
    assert.equal(universe.fleets[inbound.id]?.targetPlanetId, colony.id);
    assert.equal(universe.fleets[unrelated.id]?.originPlanetId, home.id);
    assert.equal(universe.occupations[colony.id], undefined);
    assert.equal(universe.occupations[home.id]?.mothershipFleetId, "home-occ");

    assert.doesNotThrow(() => resolveFleetArrival(universe, inbound, inbound.arrivesAt));
    assert.equal(universe.players[player.id]?.name, "Settler");
    assert.ok(universe.planets[home.id]);
  });

  it("blocks when the commander's own fleet is in flight to or from the colony", () => {
    const universe = createUniverse("Abandon Fleet", 8);
    const owner = joinUniverse(universe, "Flyer", 5_200_000);
    const { player, home, colony, moon, coords } = addColony(universe, owner.player.id);
    const outbound = fleet({
      id: "from-colony",
      ownerPlayerId: player.id,
      originPlanetId: colony.id,
      targetPlanetId: home.id,
      targetCoords: home.coords,
    });
    universe.fleets[outbound.id] = outbound;
    const blocked = abandonColony(universe, player.id, colony.id);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /wait for your fleet to return/i);
    assert.equal(universe.planets[colony.id]?.resources.metal, 111);
    assert.equal(universe.planets[moon.id]?.ships.scout, 2);

    delete universe.fleets[outbound.id];
    const towardMoon = fleet({
      id: "to-moon",
      ownerPlayerId: player.id,
      originPlanetId: home.id,
      targetPlanetId: moon.id,
      targetCoords: coords,
    });
    universe.fleets[towardMoon.id] = towardMoon;
    const stillBlocked = abandonColony(universe, player.id, colony.id);
    assert.equal(stillBlocked.ok, false);
    assert.equal(universe.planets[colony.id]?.id, colony.id);
    assert.equal(universe.planets[moon.id]?.id, moon.id);
  });

  it("loads an older in-flight save with didReset false", () => {
    const path = fileURLToPath(new URL("./fixtures/in-flight-fleet-save.json", import.meta.url));
    const before = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const fleetId = Object.keys(before.fleets)[0];
    assert.ok(fleetId);
    const savedFleet = before.fleets[fleetId]!;
    const ownerId = savedFleet.ownerPlayerId;
    const ownerBefore = before.players[ownerId]!;
    const homeBefore = before.planets[ownerBefore.homePlanetId]!;
    const loaded = migrateOrResetUniverse(structuredClone(before));
    assert.equal(loaded.didReset, false);
    const owner = loaded.universe.players[ownerId];
    assert.equal(owner?.name, ownerBefore.name);
    const home = loaded.universe.planets[ownerBefore.homePlanetId];
    assert.ok(home);
    for (const key of Object.keys(homeBefore.buildings) as Array<keyof typeof homeBefore.buildings>) {
      assert.equal(home.buildings[key], homeBefore.buildings[key], key);
    }
    for (const key of Object.keys(ownerBefore.research)) {
      assert.equal(owner?.research[key], ownerBefore.research[key], key);
    }
    assert.equal(loaded.universe.fleets[fleetId]?.ships.scout, savedFleet.ships.scout);
    assert.equal(loaded.universe.fleets[fleetId]?.arrivesAt, savedFleet.arrivesAt);
    assert.equal(home.resources.metal, homeBefore.resources.metal);
  });

  it("does not reuse abandonOccupation", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./world-abandon-colony.ts", import.meta.url)),
      "utf8",
    );
    assert.equal(source.includes("abandonOccupation"), false);
  });
});
