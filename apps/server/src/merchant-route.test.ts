import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { STARSHARDS_HIGHSCORE_TOP3, type PlayerView } from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

describe("resource merchant route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
  });

  it("trades the selected planet and rejects a missing planet, another commander, and a blocked trade", async () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const app = createApp();
      const signup = await app.request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "merchant@example.com", password: "hunter2xx" }),
      });
      assert.equal(signup.status, 200);
      const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
      const join = await app.request("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Merchant" }),
      });
      assert.equal(join.status, 200);
      const initial = (await join.json()) as PlayerView;
      const otherJoin = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OtherMerchant" }),
      });
      const other = (await otherJoin.json()) as PlayerView;

      let colonyId = "";
      let homeId = "";
      await withUniverse((universe) => {
        const player = universe.players[initial.player.id]!;
        const home = universe.planets[player.homePlanetId]!;
        const colony = structuredClone(home);
        colony.id = `${home.id}_colony`;
        colony.name = "Trade Colony";
        colony.coords = { ...home.coords, slot: Math.min(15, home.coords.slot + 1) };
        if (colony.coords.slot === home.coords.slot) colony.coords.slot = Math.max(1, home.coords.slot - 1);
        home.resources = { metal: 111, crystal: 222, deuterium: 333 };
        colony.resources = { metal: 9000, crystal: 100, deuterium: 50 };
        universe.planets[colony.id] = colony;
        player.planetIds.push(colony.id);
        player.activePlanetId = colony.id;
        player.starshards = 77;
        colonyId = colony.id;
        homeId = home.id;
      });

      const unauthenticated = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: colonyId,
          give: "metal",
          get: "deuterium",
          amount: 3000,
        }),
      });
      assert.equal(unauthenticated.status, 401);

      const forbidden = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: other.player.id,
          planetId: other.planet.id,
          give: "metal",
          get: "deuterium",
          amount: 3000,
        }),
      });
      assert.equal(forbidden.status, 403);

      const missingPlanet = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          give: "metal",
          get: "deuterium",
          amount: 3000,
        }),
      });
      assert.equal(missingPlanet.status, 400);

      const traded = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: colonyId,
          give: "metal",
          get: "deuterium",
          amount: 3000,
        }),
      });
      assert.equal(traded.status, 200);
      const after = (await traded.json()) as PlayerView;
      assert.equal(after.planet.id, colonyId);
      assert.notEqual(after.planet.id, homeId);
      const achievementShards = (after.achievements ?? [])
        .filter((row) => row.unlocked)
        .reduce((sum, row) => sum + row.starshards, 0);
      assert.equal(after.starshards, 77 + STARSHARDS_HIGHSCORE_TOP3 + achievementShards);
      const shardsAfterTrade = after.starshards ?? 0;
      assert.deepEqual(after.planet.resources, {
        metal: 6000,
        crystal: 100,
        deuterium: 950,
      });

      await withUniverse((universe) => {
        assert.deepEqual(universe.planets[homeId]!.resources, {
          metal: 111,
          crystal: 222,
          deuterium: 333,
        });
      });

      const short = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: colonyId,
          give: "metal",
          get: "crystal",
          amount: 7000,
        }),
      });
      assert.equal(short.status, 400);
      const shortBody = (await short.json()) as { error: string };
      assert.match(shortBody.error, /Not enough metal/);

      await withUniverse((universe) => {
        universe.planets[colonyId]!.resources.deuterium = 50_000_000;
      });
      const full = await app.request("/api/shop/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: colonyId,
          give: "crystal",
          get: "deuterium",
          amount: 100,
        }),
      });
      assert.equal(full.status, 400);
      const fullBody = (await full.json()) as { error: string };
      assert.match(fullBody.error, /deuterium storage is too full/);
      await withUniverse((universe) => {
        assert.equal(universe.planets[colonyId]!.resources.metal, 6000);
        assert.equal(universe.planets[homeId]!.resources.metal, 111);
        assert.equal(universe.players[initial.player.id]!.starshards, shardsAfterTrade);
      });
    } finally {
      Date.now = originalNow;
    }
  });
});
