import assert from "node:assert/strict";
import type { PlayerView } from "@starhold/game";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { stateRevision } from "./state-response.js";
import { resetMemoryUniverse } from "./store.js";

describe("player state payload", () => {
  beforeEach(() => {
    resetMemoryUniverse();
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
