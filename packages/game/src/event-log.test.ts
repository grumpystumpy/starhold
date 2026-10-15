import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_LOG_MAX } from "./catalog.js";
import {
  advanceUniverse,
  createUniverse,
  ensureUniverseShape,
  graduateNewbieProtection,
  joinUniverse,
  launchFleet,
  markEventsRead,
  playerView,
  pushEventLog,
  queueBuildingUpgrade,
  queueResearch,
  queueShipBuild,
  recordMiniPlanetSighting,
  unreadEventCount,
} from "./world.js";

describe("event log", () => {
  it("migrates a missing log to an empty array", () => {
    const universe = createUniverse("Migrate Drift", 1);
    const { player } = joinUniverse(universe, "OldHand", 1_000);
    delete player.eventLog;
    ensureUniverseShape(universe);
    assert.deepEqual(player.eventLog, []);
  });

  it("caps the ring buffer and marks read", () => {
    const universe = createUniverse("Cap Drift", 1);
    const { player } = joinUniverse(universe, "Capper", 2_000);
    for (let i = 0; i < EVENT_LOG_MAX + 5; i++) {
      pushEventLog(player, {
        kind: "fleetReturn",
        title: `n${i}`,
        body: "returned",
        createdAt: 1_000 + i,
      });
    }
    assert.equal(player.eventLog?.length, EVENT_LOG_MAX);
    assert.equal(player.eventLog?.[0]?.title, "n5");
    assert.equal(unreadEventCount(player), EVENT_LOG_MAX);

    const firstId = player.eventLog?.[0]?.id ?? "";
    const marked = markEventsRead(universe, player.id, [firstId], 9_000);
    assert.equal(marked.ok, true);
    assert.equal(player.eventLog?.[0]?.readAt, 9_000);
    assert.equal(player.eventLog?.[1]?.readAt, null);
    assert.equal(unreadEventCount(player), EVENT_LOG_MAX - 1);

    const none = markEventsRead(universe, player.id, [], 9_001);
    assert.equal(none.ok, true);
    if (none.ok) assert.equal(none.marked, 0);
    assert.equal(player.eventLog?.[1]?.readAt, null);

    markEventsRead(universe, player.id, undefined, 9_002);
    assert.ok(player.eventLog?.every((entry) => entry.readAt === 9_002 || entry.id === firstId));
    assert.equal(unreadEventCount(player), 0);
  });

  it("emits build, ship, and research completions on catch-up", () => {
    const universe = createUniverse("Build Drift", 8);
    const { player, planet } = joinUniverse(universe, "Builder", 50_000_000);
    planet.resources = { metal: 20_000, crystal: 20_000, deuterium: 20_000 };
    planet.buildings.shipyard = 1;
    planet.buildings.researchLab = 1;

    const building = queueBuildingUpgrade(
      universe,
      player.id,
      "metalMine",
      50_000_000,
    );
    assert.equal(building.ok, true);
    const buildDone = universe.planets[planet.id].buildQueue[0]!.completesAt;
    advanceUniverse(universe, buildDone);
    const builds = (universe.players[player.id].eventLog ?? []).filter(
      (entry) => entry.kind === "buildComplete",
    );
    assert.ok(
      builds.some((entry) => entry.title === "Ore Extractor → level 2"),
      JSON.stringify(builds.map((entry) => entry.title)),
    );

    const ship = queueShipBuild(
      universe,
      player.id,
      "scout",
      2,
      buildDone + 1,
    );
    assert.equal(ship.ok, true, ship.ok ? "" : ship.error);
    const shipDone = universe.planets[planet.id].shipQueue[0]!.completesAt;
    advanceUniverse(universe, shipDone);
    assert.ok(
      (universe.players[player.id].eventLog ?? []).some(
        (entry) =>
          entry.kind === "buildComplete" && entry.title === "Scout Skiff × 2",
      ),
    );

    const research = queueResearch(
      universe,
      player.id,
      "energyTech",
      shipDone + 1,
    );
    assert.equal(research.ok, true, research.ok ? "" : research.error);
    const researchDone =
      universe.players[player.id].researchQueue[0]!.completesAt;
    advanceUniverse(universe, researchDone);
    assert.ok(
      (universe.players[player.id].eventLog ?? []).some(
        (entry) => entry.title === "Power Discipline → level 1",
      ),
    );

    const view = playerView(universe, player.id, researchDone + 1);
    assert.ok((view.player.eventLog ?? []).length >= 3);
    assert.ok(unreadEventCount(view.player) >= 3);
  });

  it("reports the full ship order when batches finish across ticks", () => {
    const universe = createUniverse("Split Yard", 1);
    const { player, planet } = joinUniverse(universe, "Splitter", 70_000_000);
    planet.resources = { metal: 20_000, crystal: 20_000, deuterium: 20_000 };
    planet.buildings.shipyard = 1;

    const ship = queueShipBuild(universe, player.id, "scout", 2, 70_000_000);
    assert.equal(ship.ok, true, ship.ok ? "" : ship.error);
    const item = universe.planets[planet.id].shipQueue[0]!;
    const mid = (item.startedAt ?? 70_000_000) + item.unitSeconds * 1000;
    advanceUniverse(universe, mid);
    assert.equal(universe.planets[planet.id].ships.scout, 1);
    assert.equal(
      (universe.players[player.id].eventLog ?? []).some(
        (entry) => entry.title === "Scout Skiff × 2",
      ),
      false,
    );
    advanceUniverse(universe, item.completesAt);
    assert.equal(universe.planets[planet.id].ships.scout, 2);
    const titles = (universe.players[player.id].eventLog ?? [])
      .filter((entry) => entry.kind === "buildComplete")
      .map((entry) => entry.title);
    assert.deepEqual(titles, ["Scout Skiff × 2"]);
  });

  it("alerts the defender on a hostile raid and the owner when the fleet returns", () => {
    const universe = createUniverse("Raid Log", 8);
    const a = joinUniverse(universe, "Raider", 60_000_000);
    const b = joinUniverse(universe, "Victim", 60_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 5;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources.deuterium = 500;
    universe.planets[b.planet.id].ships.scout = 0;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 4, hauler: 1 },
      60_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const defenderLog = universe.players[b.player.id].eventLog ?? [];
    assert.ok(
      defenderLog.some(
        (entry) =>
          entry.kind === "raidAlert" &&
          entry.title === `Hostile raid resolved at ${b.planet.name}`,
      ),
    );
    assert.equal(
      (universe.players[a.player.id].eventLog ?? []).filter(
        (entry) =>
          entry.kind === "raidAlert" && entry.title.includes(b.planet.name),
      ).length,
      0,
    );

    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    advanceUniverse(universe, mid.arrivesAt);
    assert.ok(
      (universe.players[a.player.id].eventLog ?? []).some(
        (entry) =>
          entry.kind === "fleetReturn" &&
          entry.title === `Fleet returned to ${a.planet.name}`,
      ),
    );
  });

  it("notifies in-radius empires except the discoverer", () => {
    const universe = createUniverse("Mini Drift", 1);
    const finder = joinUniverse(universe, "Finder", 70_000_000);
    const near = joinUniverse(universe, "Near", 70_000_001);
    const edge = joinUniverse(universe, "Edge", 70_000_002);
    const far = joinUniverse(universe, "Far", 70_000_003);
    const otherGalaxy = joinUniverse(universe, "Other", 70_000_004);

    finder.planet.coords = { galaxy: 1, system: 10, slot: 4 };
    near.planet.coords = { galaxy: 1, system: 15, slot: 2 };
    edge.planet.coords = { galaxy: 1, system: 16, slot: 2 };
    far.planet.coords = { galaxy: 1, system: 40, slot: 1 };
    otherGalaxy.planet.coords = { galaxy: 2, system: 10, slot: 3 };

    const mini = {
      ...finder.planet,
      id: "mini_sighting",
      name: "Shard",
      coords: { galaxy: 1, system: 10, slot: 20 },
      flags: {},
      ownerPlayerId: "",
    };
    universe.planets[mini.id] = mini;

    const created = recordMiniPlanetSighting(
      universe,
      mini.coords,
      finder.player.id,
      70_000_500,
      mini.id,
    );
    assert.equal(created.length, 1);
    assert.equal(created[0]?.kind, "miniNearby");
    assert.equal(
      created[0]?.title,
      "Mini planet sighted near 1:10 (while away)",
    );
    assert.equal(universe.planets[mini.id]?.flags?.mini, true);
    assert.ok(universe.miniPlanetIds?.includes(mini.id));
    assert.equal(
      (finder.player.eventLog ?? []).filter((entry) => entry.kind === "miniNearby")
        .length,
      0,
    );
    assert.equal(
      (near.player.eventLog ?? []).filter((entry) => entry.kind === "miniNearby")
        .length,
      1,
    );
    assert.equal(
      (edge.player.eventLog ?? []).filter((entry) => entry.kind === "miniNearby")
        .length,
      0,
    );
    assert.equal(
      (far.player.eventLog ?? []).filter((entry) => entry.kind === "miniNearby")
        .length,
      0,
    );
    assert.equal(
      (otherGalaxy.player.eventLog ?? []).filter(
        (entry) => entry.kind === "miniNearby",
      ).length,
      0,
    );
  });
});
