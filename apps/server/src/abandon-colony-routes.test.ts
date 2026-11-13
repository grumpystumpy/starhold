import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("abandon colony route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
  });

  async function signupAndJoin(email: string, name: string) {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name }),
    });
    assert.equal(join.status, 200);
    const view = (await join.json()) as {
      player: { id: string; homePlanetId: string };
      planet: { id: string; name: string };
    };
    return { app, cookie, view };
  }

  it("requires the owning session and rejects the homeworld", async () => {
    const owner = await signupAndJoin("abandon@example.com", "Leaver");
    const other = await signupAndJoin("thief@example.com", "Thief");
    const playerId = owner.view.player.id;
    const planetId = owner.view.planet.id;
    assert.equal(planetId, owner.view.player.homePlanetId);

    const missing = await owner.app.request("/api/abandon-colony", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, planetId }),
    });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "Sign in required.");

    const stolen = await owner.app.request("/api/abandon-colony", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, planetId }),
    });
    assert.equal(stolen.status, 403);
    assert.equal((await stolen.json()).error, "You do not own this player.");

    const bad = await owner.app.request("/api/abandon-colony", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(bad.status, 400);

    const rejected = await owner.app.request("/api/abandon-colony", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, planetId }),
    });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /homeworld/);

    const state = await owner.app.request(`/api/state?playerId=${playerId}`, {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(state.status, 200);
    const body = (await state.json()) as { planet: { id: string } };
    assert.equal(body.planet.id, planetId);
  });
});
