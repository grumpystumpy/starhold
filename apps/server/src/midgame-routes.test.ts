import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("mid-game briefing route", () => {
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
        midgameBriefingDismissed?: boolean;
      };
      planet: { id: string; buildings: { metalMine: number } };
    };
    return { app, cookie, view };
  }

  it("requires the owning session and omits the field until dismiss", async () => {
    const owner = await signupAndJoin("midgame@example.com", "Guide");
    const other = await signupAndJoin("midgame-other@example.com", "Other");
    const playerId = owner.view.player.id;
    assert.equal(owner.view.player.midgameBriefingDismissed, undefined);
    assert.equal(owner.view.player.onboarding, undefined);

    const state = await owner.app.request(
      `/api/state?playerId=${encodeURIComponent(playerId)}`,
    );
    assert.equal(state.status, 200);
    const polled = JSON.stringify(await state.json());
    assert.equal(polled.includes("midgameBriefingDismissed"), false);
    assert.equal(polled.includes("sensorArrayLevel"), false);
    assert.equal(polled.includes("midgame-briefing"), false);

    const missing = await owner.app.request("/api/midgame/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, dismissed: true }),
    });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "Sign in required.");

    const stolen = await owner.app.request("/api/midgame/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, dismissed: true }),
    });
    assert.equal(stolen.status, 403);
    assert.equal((await stolen.json()).error, "You do not own this player.");

    const bad = await owner.app.request("/api/midgame/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(bad.status, 400);

    const hidden = await owner.app.request("/api/midgame/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, dismissed: true }),
    });
    assert.equal(hidden.status, 200);
    const hiddenBody = (await hidden.json()) as {
      player: {
        id: string;
        name: string;
        onboarding?: unknown;
        midgameBriefingDismissed?: boolean;
      };
      planet: { id: string; buildings: { metalMine: number } };
    };
    assert.equal(hiddenBody.player.midgameBriefingDismissed, true);
    assert.equal(hiddenBody.player.onboarding, undefined);
    assert.equal(hiddenBody.player.id, playerId);
    assert.equal(hiddenBody.player.name, owner.view.player.name);
    assert.equal(hiddenBody.planet.id, owner.view.planet.id);
    assert.equal(hiddenBody.planet.buildings.metalMine, owner.view.planet.buildings.metalMine);

    const again = await owner.app.request(
      `/api/state?playerId=${encodeURIComponent(playerId)}`,
    );
    const againBody = (await again.json()) as {
      player: { midgameBriefingDismissed?: boolean };
    };
    assert.equal(againBody.player.midgameBriefingDismissed, true);

    const cleared = await owner.app.request("/api/midgame/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, dismissed: false }),
    });
    assert.equal(cleared.status, 200);
    const clearedBody = (await cleared.json()) as {
      player: { midgameBriefingDismissed?: boolean; onboarding?: unknown };
    };
    assert.equal(clearedBody.player.midgameBriefingDismissed, undefined);
    assert.equal(JSON.stringify(clearedBody).includes("midgameBriefingDismissed"), false);
    assert.equal(clearedBody.player.onboarding, undefined);
  });
});
