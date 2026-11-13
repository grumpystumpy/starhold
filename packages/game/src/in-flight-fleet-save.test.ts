import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrateOrResetUniverse, type UniverseState } from "./index.js";

describe("in-flight fleet save from main", () => {
  it("keeps the flying fleet, its owner, and the home stockpile", () => {
    const path = fileURLToPath(new URL("./fixtures/in-flight-fleet-save.json", import.meta.url));
    const before = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    assert.equal(before.invites, undefined);
    const fleetId = Object.keys(before.fleets)[0];
    assert.ok(fleetId);
    const saved = before.fleets[fleetId]!;
    const loaded = migrateOrResetUniverse(structuredClone(before));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.invites, undefined);
    const fleet = loaded.universe.fleets[fleetId];
    assert.ok(fleet);
    assert.equal(fleet.mission, "deploy");
    assert.equal(fleet.arrivesAt, saved.arrivesAt);
    assert.equal(fleet.ships.scout, 1);
    assert.equal(fleet.ownerPlayerId, saved.ownerPlayerId);
    const owner = loaded.universe.players[fleet.ownerPlayerId];
    assert.equal(owner?.name, "Hold");
    const home = loaded.universe.planets[owner!.homePlanetId];
    assert.ok(home);
    assert.ok(home.resources.metal > 1000, `metal wiped: ${home.resources.metal}`);
    assert.equal(home.ships.scout, 0);
    assert.equal(Object.keys(loaded.universe.fleets).length, 1);
  });
});
