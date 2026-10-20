import assert from "node:assert/strict";
import type { PlayerView } from "@starhold/game";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { stateRevision } from "./state-response.js";
import { memoryUniverseLoaded, resetMemoryUniverse, setUniverseFaultForTests } from "./store.js";

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
      player?: unknown;
    };
    assert.equal(again.status, 200);
    assert.equal(tiny.unchanged, true);
    assert.equal(tiny.player, undefined);
    assert.equal(typeof tiny.resources?.metal, "number");
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
});
