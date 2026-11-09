import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import { advanceUniverse } from "./world-arrival.js";
import { migrateOrResetUniverse } from "./world-migrate.js";
import { whatsNewViewFor } from "./release-notes.js";
import { bindTickBudget } from "./tick-budget.js";
import type { UniverseState } from "./types.js";

function readUniverse(name: string): UniverseState {
  const path = fileURLToPath(
    new URL(`../../../apps/server/src/fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as UniverseState;
}

function tick(universe: UniverseState, now: number): void {
  bindTickBudget(() => ({
    raids: 0,
    levelUps: 0,
    fleets: 0,
    driftSteps: 0,
    seedSystems: 0,
    seedMinis: 0,
    seedPirates: 0,
    lazyPlanets: true,
  }));
  try {
    advanceUniverse(universe, now);
  } finally {
    bindTickBudget(() => undefined);
  }
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
});
