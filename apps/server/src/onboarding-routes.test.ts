import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("onboarding routes", () => {
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
    assert.ok(cookie.includes("starhold_session="));
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name }),
    });
    assert.equal(join.status, 200);
    const view = (await join.json()) as {
      player: { id: string; onboarding?: { claimed?: string[] } };
      planet: { resources: { metal: number; crystal: number } };
      onboarding?: { steps: Array<{ id: string; claimed: boolean; completed: boolean }> };
    };
    return { app, cookie, view };
  }

  it("requires the owning session and claims the ore mine step once", async () => {
    const owner = await signupAndJoin("onboard@example.com", "Briefing");
    const other = await signupAndJoin("other-onboard@example.com", "Intruder");
    const playerId = owner.view.player.id;

    const missing = await owner.app.request("/api/onboarding/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, stepId: "metalMine1" }),
    });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "Sign in required.");

    const stolen = await owner.app.request("/api/onboarding/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, stepId: "metalMine1" }),
    });
    assert.equal(stolen.status, 403);
    assert.equal((await stolen.json()).error, "You do not own this player.");

    const bad = await owner.app.request("/api/onboarding/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(bad.status, 400);

    const claimed = await owner.app.request("/api/onboarding/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, stepId: "metalMine1" }),
    });
    assert.equal(claimed.status, 200);
    const after = (await claimed.json()) as {
      planet: { resources: { metal: number; crystal: number } };
      onboarding: {
        steps: Array<{ id: string; claimed: boolean }>;
      };
      player: { onboarding?: { claimed?: string[] } };
    };
    const metalGain = after.planet.resources.metal - owner.view.planet.resources.metal;
    const crystalGain = after.planet.resources.crystal - owner.view.planet.resources.crystal;
    assert.ok(metalGain >= 600 && metalGain < 700, `metal gain ${metalGain}`);
    assert.ok(crystalGain >= 250 && crystalGain < 350, `crystal gain ${crystalGain}`);
    assert.equal(after.onboarding.steps.find((step) => step.id === "metalMine1")?.claimed, true);
    assert.ok(after.player.onboarding?.claimed?.includes("metalMine1"));

    const twice = await owner.app.request("/api/onboarding/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, stepId: "metalMine1" }),
    });
    assert.equal(twice.status, 400);

    const hidden = await owner.app.request("/api/onboarding/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, dismissed: true }),
    });
    assert.equal(hidden.status, 200);
    const hiddenBody = (await hidden.json()) as { onboarding: { dismissed: boolean } };
    assert.equal(hiddenBody.onboarding.dismissed, true);

    const noCookie = await owner.app.request("/api/onboarding/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, dismissed: false }),
    });
    assert.equal(noCookie.status, 401);

    const foreign = await owner.app.request("/api/onboarding/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, dismissed: false }),
    });
    assert.equal(foreign.status, 403);

    const restored = await owner.app.request("/api/onboarding/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, dismissed: false }),
    });
    assert.equal(restored.status, 200);
    const restoredBody = (await restored.json()) as {
      onboarding: { dismissed: boolean };
      player: { onboarding?: { claimed?: string[] } };
    };
    assert.equal(restoredBody.onboarding.dismissed, false);
    assert.ok(restoredBody.player.onboarding?.claimed?.includes("metalMine1"));
  });
});
