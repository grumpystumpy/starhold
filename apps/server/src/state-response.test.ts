import assert from "node:assert/strict";
import { advanceUniverse, launchFleet, playerView, type PlayerView, type UniverseState } from "@starhold/game";
import { installDeterministicInputs } from "../../../packages/game/src/test-determinism.js";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { stateRevision } from "./state-response.js";
import {
  memoryUniverseLoaded,
  resetMemoryUniverse,
  setUniverseFaultForTests,
  withUniverse,
} from "./store.js";

function savedTickState(universe: UniverseState) {
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

describe("player state payload", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    setUniverseFaultForTests(null);
  });

  it("rejects unauthenticated universe reads before loading the universe", async () => {
    const app = createApp();
    setUniverseFaultForTests("read");
    const response = await app.request("/api/universe");
    assert.equal(response.status, 401);
    assert.equal(memoryUniverseLoaded(), false);
  });

  it("serves the compact universe summary to an authenticated session", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "universe@example.com", password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "UniversePilot" }),
    });
    assert.equal(join.status, 200);
    const joined = (await join.json()) as { player: { id: string; name: string; homePlanetId: string } };

    const response = await app.request("/api/universe", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      now: number; id: string; name: string; speed: number; fleetSpeed: number;
      players: Array<{ id: string; name: string; coords: unknown; planetId: string }>;
    };
    assert.equal(typeof body.now, "number");
    assert.equal(typeof body.id, "string");
    assert.equal(typeof body.name, "string");
    assert.equal(typeof body.speed, "number");
    assert.equal(typeof body.fleetSpeed, "number");
    assert.deepEqual(Object.keys(body.players[0]!).sort(), ["coords", "id", "name", "planetId"]);
    assert.equal(body.players[0]?.id, joined.player.id);
    assert.equal(body.players[0]?.name, joined.player.name);
    assert.equal(body.players[0]?.planetId, joined.player.homePlanetId);
  });

  it("sends a tiny body for an unchanged empire and gzips when asked", async () => {
    const app = createApp();
    const join = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rev" }),
    });
    const joined = (await join.json()) as PlayerView;
    const state = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
    );
    const full = (await state.json()) as PlayerView;
    const etag = state.headers.get("etag");
    assert.ok(etag);
    assert.equal(stateRevision(full), etag.replaceAll('"', ""));

    const again = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
      { headers: { "If-None-Match": etag } },
    );
    const tiny = (await again.json()) as {
      unchanged?: boolean;
      resources?: { metal: number };
      ownedPlanetResources?: Array<{ id: string; resources: unknown }>;
      player?: unknown;
    };
    assert.equal(again.status, 200);
    assert.equal(tiny.unchanged, true);
    assert.equal(tiny.player, undefined);
    assert.equal(typeof tiny.resources?.metal, "number");
    assert.equal(tiny.ownedPlanetResources?.length, 1);
    assert.equal(tiny.ownedPlanetResources?.[0]?.id, joined.planet.id);
    assert.equal(typeof tiny.ownedPlanetResources?.[0]?.resources.metal, "number");
    assert.ok(JSON.stringify(tiny).length * 8 < JSON.stringify(full).length);

    const stripped = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
      { headers: { "X-Starhold-Have-Catalogs": "1" } },
    );
    const omitted = (await stripped.json()) as PlayerView & {
      catalogsOmitted?: boolean;
    };
    assert.equal(omitted.catalogsOmitted, true);
    assert.equal(omitted.officerCatalog, undefined);
    assert.equal(omitted.skillCatalog, undefined);
    assert.equal(omitted.player.id, joined.player.id);

    const up = await app.request("/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: joined.player.id,
        buildingId: "metalMine",
      }),
    });
    assert.equal(up.status, 200);
    const changed = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
      { headers: { "If-None-Match": etag } },
    );
    const next = (await changed.json()) as { unchanged?: boolean; player?: { id: string } };
    assert.equal(next.unchanged, undefined);
    assert.equal(next.player?.id, joined.player.id);
    assert.notEqual(changed.headers.get("etag"), etag);

    const gzipped = await app.request("/api/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
      },
      body: JSON.stringify({ name: "Zip" }),
    });
    assert.equal(gzipped.headers.get("content-encoding"), "gzip");
    const bytes = new Uint8Array(await gzipped.arrayBuffer());
    assert.equal(bytes[0], 0x1f);
    assert.equal(bytes[1], 0x8b);
  });

  it("skips the universe tick for a quiet poll without structural writes", async () => {
    const app = createApp();
    const join = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "QuietPoll" }),
    });
    const joined = (await join.json()) as PlayerView;
    const snapshot = () =>
      withUniverse((universe: UniverseState) => {
        const player = universe.players[joined.player.id]!;
        const planet = universe.planets[joined.planet.id]!;
        return JSON.stringify({
          player: {
            research: player.research,
            researchQueue: player.researchQueue,
            officers: player.officers,
            highscoreStarshardsClaimed: player.highscoreStarshardsClaimed,
          },
          planet: {
            buildings: planet.buildings,
            ships: planet.ships,
            defenses: planet.defenses,
            buildQueue: planet.buildQueue,
            shipQueue: planet.shipQueue,
            defenseQueue: planet.defenseQueue,
          },
          fleets: universe.fleets,
          reports: universe.reports,
        });
      });
    const before = await snapshot();

    const response = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Starhold-State-Tick"), "skipped");
    assert.equal(await snapshot(), before);
  });

  it("advances a due build queue on the state poll", async () => {
    const app = createApp();
    const join = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "DuePoll" }),
    });
    const joined = (await join.json()) as PlayerView;
    const upgrade = await app.request("/api/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: joined.player.id,
        buildingId: "metalMine",
        planetId: joined.planet.id,
      }),
    });
    assert.equal(upgrade.status, 200);
    await withUniverse((universe) => {
      const item = universe.planets[joined.planet.id]!.buildQueue[0]!;
      item.completesAt = Date.now() - 1;
    });

    const response = await app.request(
      `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
    );
    const view = (await response.json()) as PlayerView;

    assert.equal(response.headers.get("X-Starhold-State-Tick"), "advanced");
    assert.equal(view.planet.buildings.metalMine, 2);
  });

  it("keeps hostile inbound visible on a skipped state poll", async () => {
    const app = createApp();
    const join = async (name: string) => {
      const response = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return (await response.json()) as PlayerView;
    };
    const defender = await join("QuietDefender");
    const attacker = await join("QuietAttacker");
    let inboundId = "";
    await withUniverse((universe) => {
      universe.planets[attacker.planet.id]!.ships.scout = 1;
      universe.players[defender.player.id]!.newbieForfeitedAt = Date.now();
      const launch = launchFleet(
        universe,
        attacker.player.id,
        defender.planet.id,
        "raid",
        { scout: 1 },
        Date.now(),
      );
      assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
      if (!launch.ok) throw new Error(launch.error);
      inboundId = launch.fleet.id;
    });

    const response = await app.request(
      `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
    );
    const view = (await response.json()) as PlayerView;

    assert.equal(response.headers.get("X-Starhold-State-Tick"), "skipped");
    assert.ok(view.hostileInbound.some((fleet) => fleet.id === inboundId));
  });

  it("refreshes mine output on a skipped poll to match a full tick", async () => {
    const now = 1_700_000_100_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const app = createApp();
      const join = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ResourcePoll" }),
      });
      const joined = (await join.json()) as PlayerView;
      await withUniverse((universe) => {
        const planet = universe.planets[joined.planet.id]!;
        planet.lastTickAt = now - 3_600_000;
        planet.resources = { metal: 0, crystal: 0, deuterium: 0 };
      });
      let expectedMetal = 0;
      await withUniverse((universe) => {
        const clone = structuredClone(universe);
        advanceUniverse(clone, now);
        expectedMetal = clone.planets[joined.planet.id]!.resources.metal;
      });

      const response = await app.request(
        `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
      );
      const view = (await response.json()) as PlayerView;

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Starhold-State-Tick"), "skipped");
      assert.ok(view.planet.resources.metal > 0);
      assert.equal(view.planet.resources.metal, expectedMetal);
      assert.equal(view.planet.buildings.metalMine, joined.planet.buildings.metalMine);
    } finally {
      Date.now = originalNow;
    }
  });

  it("resolves a due attack on time and saves the same state as a full tick", async () => {
    const now = 1_700_000_200_000;
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => now;
    try {
      const app = createApp();
      const join = async (name: string) => {
        const response = await app.request("/api/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return (await response.json()) as PlayerView;
      };
      const defender = await join("DueDefender");
      const attacker = await join("DueAttacker");
      let fleetId = "";
      let clone: UniverseState | undefined;
      await withUniverse((universe) => {
        universe.planets[attacker.planet.id]!.ships.scout = 1;
        universe.planets[attacker.planet.id]!.resources.deuterium = 50_000;
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
        launch.fleet.arrivesAt = now;
        fleetId = launch.fleet.id;
        clone = structuredClone(universe);
      });
      if (!clone) throw new Error("missing clone");
      const expected = clone;

      const restoreExpected = installDeterministicInputs(4, now);
      playerView(expected, defender.player.id, now);
      restoreExpected();

      const restoreLive = installDeterministicInputs(4, now);
      const response = await app.request(
        `/api/state?playerId=${encodeURIComponent(defender.player.id)}`,
      );
      const view = (await response.json()) as PlayerView;
      restoreLive();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Starhold-State-Tick"), "advanced");
      assert.equal(
        view.hostileInbound.some((fleet) => fleet.id === fleetId),
        false,
      );
      assert.ok(view.reports.some((report) => report.missionId === fleetId));
      assert.ok(view.planet.resources.metal > 0);

      await withUniverse((universe) => {
        assert.deepEqual(savedTickState(universe), savedTickState(expected));
      });
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });

  it("routes validated Shop trades in both directions", async () => {
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const app = createApp();
      const signup = await app.request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "shop-trader@example.com", password: "hunter2xx" }),
      });
      assert.equal(signup.status, 200);
      const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
      const join = await app.request("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "ShopTrader" }),
      });
      assert.equal(join.status, 200);
      const initial = (await join.json()) as PlayerView;
      const otherJoin = await app.request("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OtherShopTrader" }),
      });
      const other = (await otherJoin.json()) as PlayerView;
      await withUniverse((universe) => {
        universe.players[initial.player.id]!.starshards = 1500;
        universe.planets[initial.planet.id]!.resources = {
          metal: 100,
          crystal: 200,
          deuterium: 300,
        };
      });

      const unauthenticated = await app.request("/api/shop/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: initial.player.id, direction: "buy" }),
      });
      assert.equal(unauthenticated.status, 401);

      const forbidden = await app.request("/api/shop/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ playerId: other.player.id, direction: "buy" }),
      });
      assert.equal(forbidden.status, 403);

      const bought = await app.request("/api/shop/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: initial.planet.id,
          direction: "buy",
        }),
      });
      assert.equal(bought.status, 200);
      const afterBuy = (await bought.json()) as PlayerView;
      assert.equal(afterBuy.starshards, 50);
      assert.deepEqual(afterBuy.planet.resources, {
        metal: 3100,
        crystal: 2200,
        deuterium: 1300,
      });

      const sold = await app.request("/api/shop/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: initial.planet.id,
          direction: "sell",
        }),
      });
      assert.equal(sold.status, 200);
      const afterSell = (await sold.json()) as PlayerView;
      assert.equal(afterSell.starshards, 1550);
      assert.deepEqual(afterSell.planet.resources, {
        metal: 100,
        crystal: 200,
        deuterium: 300,
      });

      const invalid = await app.request("/api/shop/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          playerId: initial.player.id,
          planetId: initial.planet.id,
          direction: "exchange",
        }),
      });
      assert.equal(invalid.status, 400);
    } finally {
      Date.now = originalNow;
    }
  });
});
