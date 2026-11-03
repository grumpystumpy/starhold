import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "./app.js";

describe("activate-officer duration validation", () => {
  it("rejects unsupported duration hours with 400", async () => {
    const app = createApp();
    const response = await app.request("/api/activate-officer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: "player",
        officerId: "quartermaster",
        hours: 3,
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid officer duration.",
    });
  });
});
