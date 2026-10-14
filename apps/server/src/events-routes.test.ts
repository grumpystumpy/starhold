import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("event log read route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
  });

  it("requires playerId and returns an empty log for a new commander", async () => {
    const app = createApp();
    const missing = await app.request("/api/events/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const badIds = await app.request("/api/events/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: "plyr_x", ids: "all" }),
    });
    assert.equal(badIds.status, 400);

    const join = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Logger" }),
    });
    assert.equal(join.status, 200);
    const joined = (await join.json()) as {
      player: { id: string; eventLog?: unknown[] };
    };
    assert.ok(Array.isArray(joined.player.eventLog));
    assert.equal(joined.player.eventLog?.length, 0);

    const read = await app.request("/api/events/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: joined.player.id }),
    });
    assert.equal(read.status, 200);
    const after = (await read.json()) as {
      player: { eventLog?: unknown[] };
    };
    assert.deepEqual(after.player.eventLog, []);

    const unknown = await app.request("/api/events/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: "plyr_missing" }),
    });
    assert.equal(unknown.status, 400);
  });
});
