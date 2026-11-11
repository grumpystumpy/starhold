import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MINI_DRIFT_INTERVAL_MS, SPY_REPORT_TTL_MS, UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import { advanceUniverse, playerStateTickDue } from "./world-arrival.js";
import { createUniverse, joinUniverse, launchFleet, playerView } from "./world.js";
import { migrateOrResetUniverse } from "./world-migrate.js";
import { graduateNewbieProtection } from "./world-protection.js";
import { seasonIdFromTime } from "./world-seasons.js";
import { whatsNewViewFor } from "./release-notes.js";
import { bindTickBudget } from "./tick-budget.js";
import { installDeterministicInputs } from "./test-determinism.js";
import type { EspionageReport, UniverseState } from "./types.js";

function readUniverse(name: string): UniverseState {
  const path = fileURLToPath(
    new URL(`../../../apps/server/src/fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as UniverseState;
}

function saveBudget() {
  return {
    raids: 0,
    levelUps: 0,
    fleets: 50,
    driftSteps: 0,
    seedSystems: 0,
    seedMinis: 0,
    seedPirates: 0,
    lazyPlanets: true,
  };
}

function tick(universe: UniverseState, now: number): void {
  bindTickBudget(() => ({ ...saveBudget(), fleets: 0 }));
  try {
    advanceUniverse(universe, now);
  } finally {
    bindTickBudget(() => undefined);
  }
}

function runWithSaveBudget(fn: () => void): void {
  bindTickBudget(saveBudget);
  try {
    fn();
  } finally {
    bindTickBudget(() => undefined);
  }
}

function tickSnapshot(universe: UniverseState) {
  return {
    planets: universe.planets,
    fleets: universe.fleets,
    reports: universe.reports,
    spyReports: universe.spyReports,
    expeditionReports: universe.expeditionReports,
    players: universe.players,
    occupations: universe.occupations,
    debris: universe.debris,
    acsGroups: universe.acsGroups,
    pirateBases: universe.pirateBases,
    alienBases: universe.alienBases,
    seasons: universe.seasons,
    miniPlanetIds: universe.miniPlanetIds,
  };
}

describe("cross-version save fixtures", () => {
  it("loads a pre-row-save universe without resetting progress", () => {
    const raw = readUniverse("pre-row-save.json");
    assert.equal(raw.schemaVersion, 2);
    const planetId = "plnt_fixture_row";
    const playerId = "plyr_fixture_row";
    const rawPlanet = raw.planets[planetId]!;
    assert.equal(Array.isArray(rawPlanet.buildQueue), false);
    assert.equal(Array.isArray(raw.players[playerId]!.researchQueue), false);

    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    assert.equal(raw.invites, undefined);
    assert.equal(loaded.universe.invites, undefined);
    assert.equal(loaded.universe.id, "uni_fixture_pre_row");
    assert.equal(loaded.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);

    const planet = loaded.universe.planets[planetId]!;
    const player = loaded.universe.players[playerId]!;
    assert.equal(planet.resources.metal, 123456);
    assert.equal(planet.resources.crystal, 23456);
    assert.equal(planet.resources.deuterium, 3456);
    assert.equal(planet.buildings.metalMine, 7);
    assert.equal(planet.buildings.crystalMine, 4);
    assert.equal(player.research.energyTech, 3);
    assert.equal(player.whatsNewDismissedReleaseId, undefined);
    assert.equal(loaded.universe.fleets.flt_fixture_outbound!.ships.scout, 4);
    assert.equal(loaded.universe.fleets.flt_fixture_outbound!.phase, "outbound");
    assert.equal(planet.buildQueue[0]?.id, "q_fixture_metal");
    assert.equal(planet.buildQueue[0]?.buildingId, "metalMine");
    assert.equal(player.researchQueue[0]?.id, "q_fixture_energy");
    assert.equal(player.researchQueue[0]?.researchId, "energyTech");
    assert.equal(player.onboarding, undefined);

    tick(loaded.universe, planet.lastTickAt + 1000);
    const after = loaded.universe.planets[planetId]!;
    assert.ok(after.resources.metal >= 123456);
    assert.equal(after.buildings.metalMine, 7);
    assert.equal(after.buildQueue[0]?.id, "q_fixture_metal");
    assert.equal(loaded.universe.fleets.flt_fixture_outbound!.ships.scout, 4);
    assert.equal(loaded.universe.players[playerId]!.research.energyTech, 3);
  });

  it("loads a pre-onboarding pre-boss save without resetting progress", () => {
    const raw = readUniverse("pre-onboarding-boss-save.json");
    assert.equal(raw.schemaVersion, 4);
    assert.equal(raw.pirateBossBaseId, undefined);
    assert.equal(raw.pirateBossActiveUntil, undefined);
    assert.equal(raw.pirateBossNextSpawnAt, undefined);
    const planetId = "plnt_fixture_boss";
    const playerId = "plyr_fixture_boss";
    assert.equal(raw.players[playerId]!.onboarding, undefined);

    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.pirateBossBaseId, undefined);
    assert.equal(loaded.universe.pirateBossActiveUntil, undefined);
    assert.equal(loaded.universe.pirateBossNextSpawnAt, undefined);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.ships.hauler, 9);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.phase, "outbound");
    assert.equal(loaded.universe.id, "uni_fixture_pre_boss");
    assert.equal(loaded.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);

    const planet = loaded.universe.planets[planetId]!;
    const player = loaded.universe.players[playerId]!;
    assert.equal(planet.resources.metal, 777001);
    assert.equal(planet.resources.crystal, 88002);
    assert.equal(planet.resources.deuterium, 9903);
    assert.equal(planet.buildings.metalMine, 3);
    assert.equal(planet.buildings.crystalMine, 5);
    assert.equal(player.research.energyTech, 1);
    assert.equal(player.research.weaponsTech, 2);
    assert.equal(player.onboarding, undefined);
    assert.equal(player.whatsNewDismissedReleaseId, undefined);
    assert.ok(whatsNewViewFor(player));
    assert.equal(player.whatsNewDismissedReleaseId, undefined);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.ships.hauler, 9);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.phase, "outbound");
    assert.equal(planet.buildQueue[0]?.id, "q_pre_boss_lab");
    assert.equal(planet.buildQueue[0]?.buildingId, "researchLab");

    tick(loaded.universe, planet.lastTickAt + 1000);
    const after = loaded.universe.planets[planetId]!;
    assert.ok(after.resources.metal >= 777001);
    assert.equal(after.buildings.crystalMine, 5);
    assert.equal(after.buildQueue[0]?.id, "q_pre_boss_lab");
    assert.equal(loaded.universe.fleets.flt_pre_boss!.ships.hauler, 9);
    assert.equal(loaded.universe.players[playerId]!.research.weaponsTech, 2);
    assert.equal(loaded.universe.players[playerId]!.onboarding, undefined);
    assert.equal(
      loaded.universe.players[playerId]!.whatsNewDismissedReleaseId,
      undefined,
    );
  });

  it("loads a pre-what's-new in-flight save from main without resetting progress", () => {
    const path = fileURLToPath(
      new URL("./fixtures/pre-whats-new-inflight.json", import.meta.url),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const fleetId = Object.keys(raw.fleets)[0];
    assert.ok(fleetId);
    const savedFleet = raw.fleets[fleetId]!;
    const ownerId = savedFleet.ownerPlayerId;
    const ownerBefore = raw.players[ownerId]!;
    assert.equal(ownerBefore.whatsNewDismissedReleaseId, undefined);
    assert.equal(ownerBefore.onboarding, undefined);
    assert.equal(savedFleet.mission, "deploy");
    assert.equal(savedFleet.phase, "outbound");
    assert.equal(savedFleet.ships.scout, 1);
    const homeId = ownerBefore.homePlanetId;
    const metalBefore = raw.planets[homeId]!.resources.metal;

    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
    const fleet = loaded.universe.fleets[fleetId];
    assert.ok(fleet);
    assert.equal(fleet.mission, "deploy");
    assert.equal(fleet.phase, "outbound");
    assert.equal(fleet.ships.scout, 1);
    assert.equal(fleet.arrivesAt, savedFleet.arrivesAt);
    assert.equal(fleet.ownerPlayerId, ownerId);
    const owner = loaded.universe.players[ownerId]!;
    assert.equal(owner.name, "Hold");
    assert.equal(owner.onboarding, undefined);
    assert.equal(owner.whatsNewDismissedReleaseId, undefined);
    const home = loaded.universe.planets[homeId]!;
    assert.equal(home.resources.metal, metalBefore);
    assert.equal(home.buildings.metalMine, raw.planets[homeId]!.buildings.metalMine);
    assert.ok(whatsNewViewFor(owner)?.releaseId);
    assert.equal(owner.whatsNewDismissedReleaseId, undefined);

    tick(loaded.universe, home.lastTickAt + 1000);
    assert.equal(loaded.universe.fleets[fleetId]!.ships.scout, 1);
    assert.equal(loaded.universe.fleets[fleetId]!.phase, "outbound");
    assert.ok(loaded.universe.planets[homeId]!.resources.metal >= metalBefore);
    assert.equal(
      loaded.universe.players[ownerId]!.whatsNewDismissedReleaseId,
      undefined,
    );
    assert.equal(loaded.universe.players[ownerId]!.onboarding, undefined);
  });

  it("keeps an old in-flight save through a state view (didReset false)", () => {
    const path = fileURLToPath(
      new URL("./fixtures/pre-whats-new-inflight.json", import.meta.url),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const fleetId = Object.keys(raw.fleets)[0]!;
    const savedFleet = raw.fleets[fleetId]!;
    const ownerId = savedFleet.ownerPlayerId;
    const homeId = raw.players[ownerId]!.homePlanetId;
    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    const quietAt = loaded.universe.planets[homeId]!.lastTickAt + 1000;
    assert.ok(savedFleet.arrivesAt > quietAt);

    runWithSaveBudget(() => {
      const due = playerStateTickDue(loaded.universe, ownerId, quietAt);
      playerView(loaded.universe, ownerId, quietAt, undefined, undefined, {
        skipUniverseTick: !due,
      });
    });

    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.players[ownerId]!.name, "Hold");
    assert.equal(loaded.universe.fleets[fleetId]!.mission, "deploy");
    assert.equal(loaded.universe.fleets[fleetId]!.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleetId]!.ships.scout, 1);
    assert.equal(
      loaded.universe.planets[homeId]!.buildings.metalMine,
      raw.planets[homeId]!.buildings.metalMine,
    );
    assert.ok(loaded.universe.planets[homeId]!.resources.metal > 1000);

    const arrived = structuredClone(loaded.universe);
    const full = structuredClone(loaded.universe);
    const at = savedFleet.arrivesAt;
    runWithSaveBudget(() => {
      assert.equal(playerStateTickDue(arrived, ownerId, at), true);
      const restoreDue = installDeterministicInputs(5, at);
      playerView(arrived, ownerId, at, undefined, undefined, {
        skipUniverseTick: !playerStateTickDue(arrived, ownerId, at),
      });
      restoreDue();
      const restoreFull = installDeterministicInputs(5, at);
      playerView(full, ownerId, at);
      restoreFull();
    });
    assert.deepEqual(tickSnapshot(arrived), tickSnapshot(full));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.players[ownerId]!.name, "Hold");
  });
});

describe("quiet state tick", () => {
  it("skips when nothing is due, runs when a fleet or swarm is due, and matches a full tick", () => {
    const now = 1_700_000_000_000;
    const restoreClock = installDeterministicInputs(3, now);
    const universe = createUniverse("Quiet state", 8, 8, { lazySeed: true });
    universe.seedCursor = { at: 0, ranks: [], pirates: 0, done: true };
    universe.skipNpcRaids = true;
    universe.skipPirateTopUp = true;
    universe.pirateBossNextSpawnAt = now + 86_400_000;
    const defender = joinUniverse(universe, "Defender", now);
    const attacker = joinUniverse(universe, "Attacker", now);
    advanceUniverse(universe, now);
    restoreClock();

    const quietAt = now + 1000;
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), false);

    const planetId = defender.planet.id;
    const home = universe.planets[planetId]!;
    home.lastTickAt = now - 3_600_000;
    home.resources = { metal: 0, crystal: 0, deuterium: 0 };
    const produced = structuredClone(universe);
    playerView(universe, defender.player.id, quietAt, undefined, undefined, {
      skipUniverseTick: true,
    });
    advanceUniverse(produced, quietAt);
    const refreshed = universe.planets[planetId]!;
    assert.ok(refreshed.resources.metal > 0);
    assert.deepEqual(refreshed.resources, produced.planets[planetId]!.resources);
    assert.deepEqual(refreshed.buildings, produced.planets[planetId]!.buildings);
    assert.equal(Object.keys(universe.reports).length, 0);

    refreshed.flags = { ...(refreshed.flags ?? {}), mini: true };
    universe.miniPlanetIds = [...(universe.miniPlanetIds ?? []), planetId];
    refreshed.lastDriftAt = quietAt;
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), false);
    refreshed.lastDriftAt = quietAt - MINI_DRIFT_INTERVAL_MS;
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), true);
    refreshed.lastDriftAt = quietAt;
    refreshed.flags = { ...(refreshed.flags ?? {}), mini: false };

    graduateNewbieProtection(universe, universe.players[defender.player.id]!);
    universe.planets[attacker.planet.id]!.ships.scout = 1;
    universe.planets[attacker.planet.id]!.resources.deuterium = 50_000;
    const launch = launchFleet(
      universe,
      attacker.player.id,
      defender.planet.id,
      "raid",
      { scout: 1 },
      quietAt,
    );
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (!launch.ok) return;
    const fleet = universe.fleets[launch.fleet.id]!;
    fleet.arrivesAt = quietAt + 3_600_000;
    fleet.swarmProduce = { remaining: 4, unitSeconds: 10, progressAt: quietAt - 10_000 };
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), true);
    const warned = playerView(universe, defender.player.id, quietAt);
    assert.ok(warned.hostileInbound.some((row) => row.id === fleet.id));
    fleet.swarmProduce = null;
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), false);
    fleet.arrivesAt = quietAt;
    assert.equal(playerStateTickDue(universe, defender.player.id, quietAt), true);

    const dueView = structuredClone(universe);
    const fullView = structuredClone(universe);
    const restoreDue = installDeterministicInputs(9, quietAt);
    playerView(dueView, defender.player.id, quietAt, undefined, undefined, {
      skipUniverseTick: !playerStateTickDue(dueView, defender.player.id, quietAt),
    });
    restoreDue();
    const restoreFull = installDeterministicInputs(9, quietAt);
    playerView(fullView, defender.player.id, quietAt);
    restoreFull();
    assert.deepEqual(tickSnapshot(dueView), tickSnapshot(fullView));
    assert.ok(Object.keys(dueView.reports).length >= 1);
    assert.equal(
      Object.values(dueView.fleets).some(
        (row) => row.id === fleet.id && row.phase === "outbound",
      ),
      false,
    );

    const spy: EspionageReport = {
      id: "spy_old",
      at: quietAt - SPY_REPORT_TTL_MS - 1,
      missionId: "mission_old",
      spyPlayerId: defender.player.id,
      targetPlayerId: attacker.player.id,
      targetName: "Attacker",
      targetCoords: universe.planets[attacker.planet.id]!.coords,
      detail: 1,
      resources: null,
      buildings: null,
      ships: null,
      defenses: null,
      research: null,
      summary: "old scan",
    };
    const quietSpy = structuredClone(fullView);
    quietSpy.spyReports[spy.id] = { ...spy, at: quietAt };
    assert.equal(playerStateTickDue(quietSpy, defender.player.id, quietAt), false);
    quietSpy.spyReports[spy.id] = spy;
    assert.equal(playerStateTickDue(quietSpy, defender.player.id, quietAt), true);
    assert.equal(quietSpy.players[defender.player.id]!.season?.seasonId, seasonIdFromTime(quietAt));
  });
});
