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
  queueDefenseBuild,
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

  it("skips new building, ship, defense, and research completion mail", () => {
    const universe = createUniverse("Build Drift", 8);
    const { player, planet } = joinUniverse(universe, "Builder", 50_000_000);
    planet.resources = { metal: 20_000, crystal: 20_000, deuterium: 20_000 };
    planet.buildings.shipyard = 1;
    planet.buildings.researchLab = 1;
    const saved = {
      id: "evt_saved_build",
      kind: "buildComplete" as const,
      createdAt: 49_000_000,
      readAt: 49_500_000,
      title: "Solar Array → level 3",
      body: "Finished on Home.",
    };
    player.eventLog = [saved];

    const building = queueBuildingUpgrade(
      universe,
      player.id,
      "metalMine",
      50_000_000,
    );
    assert.equal(building.ok, true);
    const buildDone = universe.planets[planet.id].buildQueue[0]!.completesAt;
    advanceUniverse(universe, buildDone);
    assert.equal(universe.planets[planet.id].buildings.metalMine, 2);
    const afterBuild = universe.players[player.id].eventLog ?? [];
    assert.equal(
      afterBuild.some((entry) => entry.title === "Ore Mine → level 2"),
      false,
    );
    const kept = afterBuild.find((entry) => entry.id === saved.id);
    assert.ok(kept);
    assert.equal(kept?.kind, saved.kind);
    assert.equal(kept?.title, saved.title);
    assert.equal(kept?.body, saved.body);
    assert.equal(kept?.createdAt, saved.createdAt);
    assert.equal(kept?.readAt, saved.readAt);

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
    assert.deepEqual(
      (universe.players[player.id].eventLog ?? [])
        .filter((entry) => entry.kind === "buildComplete")
        .map((entry) => entry.title),
      [saved.title],
    );

    const defense = queueDefenseBuild(
      universe,
      player.id,
      "laserBattery",
      2,
      shipDone + 1,
    );
    assert.equal(defense.ok, true, defense.ok ? "" : defense.error);
    const defenseDone = universe.planets[planet.id].defenseQueue[0]!.completesAt;
    advanceUniverse(universe, defenseDone);
    assert.equal(universe.planets[planet.id].defenses.laserBattery, 2);
    assert.deepEqual(
      (universe.players[player.id].eventLog ?? [])
        .filter((entry) => entry.kind === "buildComplete")
        .map((entry) => entry.title),
      [saved.title],
    );

    const research = queueResearch(
      universe,
      player.id,
      "energyTech",
      defenseDone + 1,
    );
    assert.equal(research.ok, true, research.ok ? "" : research.error);
    const researchDone =
      universe.players[player.id].researchQueue[0]!.completesAt;
    advanceUniverse(universe, researchDone);
    const view = playerView(universe, player.id, researchDone + 1);
    const titles = (view.player.eventLog ?? []).map((entry) => entry.title);
    assert.deepEqual(titles, [saved.title]);
    assert.equal(unreadEventCount(view.player), 0);
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
        (entry) => entry.title === "Recon Drone × 2",
      ),
      false,
    );
    advanceUniverse(universe, item.completesAt);
    assert.equal(universe.planets[planet.id].ships.scout, 2);
    const titles = (universe.players[player.id].eventLog ?? [])
      .filter((entry) => entry.kind === "buildComplete")
      .map((entry) => entry.title);
    assert.deepEqual(titles, []);
  });

  it("gives both commanders the combat report and keeps a later hostile warning", () => {
    const universe = createUniverse("Raid Log", 8);
    const a = joinUniverse(universe, "Raider", 60_000_000);
    const b = joinUniverse(universe, "Victim", 60_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 6;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    universe.players[a.player.id]!.research.computerTech = 1;
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
    const followUp = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 1 },
      60_000_110,
    );
    assert.equal(followUp.ok, true);
    if (!followUp.ok) return;
    universe.fleets[followUp.fleet.id]!.arrivesAt = launch.fleet.arrivesAt + 3_600_000;

    const inboundView = playerView(
      universe,
      b.player.id,
      launch.fleet.arrivesAt - 1,
    );
    assert.ok(
      inboundView.hostileInbound.some((fleet) => fleet.id === launch.fleet.id),
      "incoming hostile fleet warning remains visible before combat",
    );
    assert.ok(
      inboundView.hostileInbound.some((fleet) => fleet.id === followUp.fleet.id),
      "a second inbound fleet is warned before the first fight",
    );

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const defenderLog = universe.players[b.player.id].eventLog ?? [];
    assert.equal(
      defenderLog.some((entry) => entry.kind === "raidAlert"),
      false,
      "resolved combat does not add a duplicate raid alert",
    );
    assert.equal(
      (universe.players[a.player.id].eventLog ?? []).filter(
        (entry) => entry.kind === "raidAlert",
      ).length,
      0,
    );
    for (const recipient of [a, b]) {
      const view = playerView(
        universe,
        recipient.player.id,
        launch.fleet.arrivesAt + 1,
      );
      assert.ok(
        view.reports.some((report) => report.missionId === launch.fleet.id),
        `${recipient.player.name} receives the combat report`,
      );
      assert.equal(
        view.player.eventLog?.some(
          (entry) =>
            entry.kind === "raidAlert" &&
            entry.meta?.reportId != null &&
            view.reports.some((report) => report.id === entry.meta?.reportId),
        ) ?? false,
        false,
      );
    }
    const after = playerView(universe, b.player.id, launch.fleet.arrivesAt + 1);
    assert.equal(
      after.hostileInbound.some((fleet) => fleet.id === launch.fleet.id),
      false,
    );
    assert.ok(
      after.hostileInbound.some((fleet) => fleet.id === followUp.fleet.id),
      "an in-flight hostile warning stays after another combat resolves",
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
