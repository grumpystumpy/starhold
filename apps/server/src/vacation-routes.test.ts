import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("vacation mode route", () => {
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
      player: { id: string; name: string; vacationMode?: boolean };
      planet: { resources: { metal: number }; buildings: { metalMine: number } };
      fleets: unknown[];
    };
    return { app, cookie, view };
  }

  it("requires the owner and stores vacation mode without resetting the save", async () => {
    const owner = await signupAndJoin("vacation@example.com", "Hold");
    const other = await signupAndJoin("other-vacation@example.com", "Far");
    const playerId = owner.view.player.id;
    assert.equal(owner.view.player.vacationMode, undefined);
    const metal = owner.view.planet.resources.metal;
    const metalMine = owner.view.planet.buildings.metalMine;
    const fleetCount = owner.view.fleets.length;

    const missing = await owner.app.request("/api/vacation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, enabled: true }),
    });
    assert.equal(missing.status, 401);

    const stolen = await owner.app.request("/api/vacation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, enabled: true }),
    });
    assert.equal(stolen.status, 403);

    const on = await owner.app.request("/api/vacation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, enabled: true }),
    });
    assert.equal(on.status, 200);
    const enabled = (await on.json()) as typeof owner.view;
    assert.equal(enabled.player.vacationMode, true);
    assert.equal(enabled.player.name, "Hold");
    assert.equal(enabled.planet.buildings.metalMine, metalMine);
    assert.ok(enabled.planet.resources.metal >= metal);
    assert.equal(enabled.fleets.length, fleetCount);

    const off = await owner.app.request("/api/vacation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, enabled: false }),
    });
    assert.equal(off.status, 200);
    const cleared = (await off.json()) as typeof owner.view;
    assert.equal(cleared.player.vacationMode, undefined);
    assert.equal(cleared.planet.buildings.metalMine, metalMine);
    assert.equal(cleared.fleets.length, fleetCount);

    const reloaded = await owner.app.request(`/api/state?playerId=${playerId}`, {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(reloaded.status, 200);
    const state = (await reloaded.json()) as typeof owner.view;
    assert.equal(state.player.vacationMode, undefined);
    assert.equal(state.planet.buildings.metalMine, metalMine);
    assert.equal(state.fleets.length, fleetCount);
  });
});
