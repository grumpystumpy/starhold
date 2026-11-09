import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("what's new dismiss route", () => {
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
      player: {
        id: string;
        name: string;
        onboarding?: unknown;
        whatsNewDismissedReleaseId?: string;
      };
      planet: {
        id: string;
        resources: { metal: number; crystal: number };
        buildings: { metalMine: number; crystalMine: number };
      };
      fleets: unknown[];
      whatsNew: { releaseId: string; items: string[] } | null;
    };
    return { app, cookie, view };
  }

  it("requires the owner and stores the release key without resetting the save", async () => {
    const owner = await signupAndJoin("notes@example.com", "Hold");
    const other = await signupAndJoin("other-notes@example.com", "Far");
    const playerId = owner.view.player.id;
    assert.equal(owner.view.player.whatsNewDismissedReleaseId, undefined);
    assert.equal(owner.view.player.onboarding, undefined);
    assert.equal(owner.view.whatsNew?.releaseId, "271");
    assert.equal(owner.view.whatsNew?.items.length, 5);
    const metal = owner.view.planet.resources.metal;
    const crystal = owner.view.planet.resources.crystal;
    const metalMine = owner.view.planet.buildings.metalMine;
    const fleetCount = owner.view.fleets.length;

    const missing = await owner.app.request("/api/whats-new/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(missing.status, 401);

    const stolen = await owner.app.request("/api/whats-new/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(stolen.status, 403);

    const dismissed = await owner.app.request("/api/whats-new/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(dismissed.status, 200);
    const after = (await dismissed.json()) as typeof owner.view;
    assert.equal(after.player.whatsNewDismissedReleaseId, "271");
    assert.equal(after.player.onboarding, undefined);
    assert.equal(after.player.name, "Hold");
    assert.equal(after.whatsNew, null);
    assert.equal(after.planet.id, owner.view.planet.id);
    assert.equal(after.planet.buildings.metalMine, metalMine);
    assert.ok(after.planet.resources.metal >= metal);
    assert.ok(after.planet.resources.metal < metal + 50);
    assert.ok(after.planet.resources.crystal >= crystal);
    assert.equal(after.fleets.length, fleetCount);

    const again = await owner.app.request("/api/whats-new/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(again.status, 200);

    const reloaded = await owner.app.request(`/api/state?playerId=${playerId}`);
    assert.equal(reloaded.status, 200);
    const state = (await reloaded.json()) as typeof owner.view;
    assert.equal(state.player.whatsNewDismissedReleaseId, "271");
    assert.equal(state.whatsNew, null);
    assert.equal(state.player.onboarding, undefined);
    assert.equal(state.planet.buildings.metalMine, metalMine);
    assert.ok(state.planet.resources.metal >= metal);
    assert.ok(state.planet.resources.metal < metal + 50);
    assert.equal(state.fleets.length, fleetCount);
  });
});
