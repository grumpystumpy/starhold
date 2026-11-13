import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  EXPEDITION_SLOT,
  FLEET_SAVE_MIN_LEAD_MS,
  launchFleet,
  type PlayerView,
} from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

describe("fleet save on the state route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
  });

  it("returns a deploy prefill and does not launch it", async () => {
    const app = createApp();
    const join = async (name: string) => {
      const response = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as PlayerView;
    };
    const defender = await join("SaveDefender");
    const attacker = await join("SaveAttacker");
    const now = Date.now();
    let attackId = "";
    await withUniverse((universe) => {
      const home = universe.planets[defender.planet.id]!;
      home.ships.scout = 3;
      home.ships.helioBuoy = 2;
      const colony = structuredClone(home);
      colony.id = `${home.id}-colony`;
      colony.name = "Haven";
      colony.ships = {};
      colony.coords = {
        ...home.coords,
        slot: home.coords.slot === 15 ? 14 : home.coords.slot + 1,
      };
      universe.planets[colony.id] = colony;
      universe.players[defender.player.id]!.planetIds.push(colony.id);
      universe.planets[attacker.planet.id]!.ships.scout = 1;
      universe.players[defender.player.id]!.newbieForfeitedAt = now;
      const launch = launchFleet(
        universe,
        attacker.player.id,
        home.id,
        "raid",
        { scout: 1 },
        now,
      );
      assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
      if (!launch.ok) throw new Error(launch.error);
      launch.fleet.arrivesAt = now + FLEET_SAVE_MIN_LEAD_MS + 60_000;
      attackId = launch.fleet.id;
    });

    const response = await app.request(
      `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
    );
    const view = (await response.json()) as PlayerView;
    assert.equal(response.status, 200);
    const row = view.fleetSave?.find((entry) => entry.attackId === attackId);
    assert.ok(row);
    assert.equal(row?.mission, "deploy");
    assert.equal(row?.originPlanetId, defender.planet.id);
    assert.equal(row?.ships.scout, 3);
    assert.equal(row?.ships.helioBuoy, undefined);
    assert.ok(row?.targetPlanetId);
    assert.equal(
      view.fleets.some((fleet) => fleet.ownerPlayerId === defender.player.id),
      false,
    );
  });

  it("omits the prefill when the raid is a minute away or the hangar is empty", async () => {
    const app = createApp();
    const join = async (name: string) => {
      const response = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return (await response.json()) as PlayerView;
    };
    const defender = await join("SoonDefender");
    const attacker = await join("SoonAttacker");
    const now = Date.now();
    await withUniverse((universe) => {
      universe.planets[attacker.planet.id]!.ships.scout = 1;
      universe.players[defender.player.id]!.newbieForfeitedAt = now;
      const launch = launchFleet(
        universe,
        attacker.player.id,
        defender.planet.id,
        "raid",
        { scout: 1 },
        now,
      );
      assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
      if (!launch.ok) throw new Error(launch.error);
      launch.fleet.arrivesAt = now + FLEET_SAVE_MIN_LEAD_MS;
      universe.planets[defender.planet.id]!.ships.scout = 2;
    });

    const soon = await app.request(
      `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
    );
    const soonView = (await soon.json()) as PlayerView;
    assert.equal(soon.status, 200);
    assert.equal(soonView.fleetSave, undefined);

    await withUniverse((universe) => {
      const fleet = Object.values(universe.fleets).find(
        (entry) => entry.targetPlanetId === defender.planet.id,
      );
      if (!fleet) throw new Error("missing raid");
      fleet.arrivesAt = now + 120_000;
      universe.planets[defender.planet.id]!.ships = {};
    });
    const empty = await app.request(
      `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
    );
    const emptyView = (await empty.json()) as PlayerView;
    assert.equal(emptyView.fleetSave, undefined);
  });

  it("launches the one-world expedition prefill", async () => {
    const app = createApp();
    const join = async (name: string) => {
      const response = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as PlayerView;
    };
    const defender = await join("ExpeditionSaver");
    const attacker = await join("ExpeditionRaider");
    const now = Date.now();
    await withUniverse((universe) => {
      const home = universe.planets[defender.planet.id]!;
      home.ships.scout = 2;
      home.resources.deuterium = 50_000;
      universe.planets[attacker.planet.id]!.ships.scout = 1;
      universe.players[defender.player.id]!.newbieForfeitedAt = now;
      const launch = launchFleet(
        universe,
        attacker.player.id,
        home.id,
        "raid",
        { scout: 1 },
        now,
      );
      assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
      if (!launch.ok) throw new Error(launch.error);
      launch.fleet.arrivesAt = now + FLEET_SAVE_MIN_LEAD_MS + 120_000;
    });

    const state = await app.request(
      `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
    );
    const view = (await state.json()) as PlayerView;
    const row = view.fleetSave?.[0];
    assert.equal(row?.mission, "expedition");
    assert.equal(row?.originPlanetId, defender.planet.id);
    assert.equal(row?.targetCoords?.slot, EXPEDITION_SLOT);
    assert.deepEqual(row?.ships, { scout: 2 });

    const sent = await app.request("/api/launch-fleet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: defender.player.id,
        originPlanetId: row?.originPlanetId,
        mission: row?.mission,
        ships: row?.ships,
        targetCoords: row?.targetCoords,
      }),
    });
    const launched = (await sent.json()) as PlayerView & { error?: string };
    assert.equal(sent.status, 200, launched.error);
    assert.ok(
      launched.fleets.some(
        (fleet) =>
          fleet.ownerPlayerId === defender.player.id &&
          fleet.mission === "expedition" &&
          fleet.targetCoords.slot === EXPEDITION_SLOT,
      ),
    );
  });
});
