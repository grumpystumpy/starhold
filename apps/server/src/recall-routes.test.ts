import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("fleet recall route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    process.env.STARHOLD_E2E = "1";
    process.env.ALLOW_E2E_HOOKS = "1";
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
      player: { id: string };
      planet: { id: string; resources: { deuterium: number } };
      fleets: Array<{ id: string; phase: string; mission: string }>;
    };
    return { app, cookie, view };
  }

  it("requires the owning session and turns an outbound fleet around", async () => {
    const owner = await signupAndJoin("recall@example.com", "Recall");
    const other = await signupAndJoin("recall-other@example.com", "Other");
    const playerId = owner.view.player.id;

    const missing = await owner.app.request("/api/fleet/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, fleetId: "missing" }),
    });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "Sign in required.");

    const stolen = await owner.app.request("/api/fleet/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify({ playerId, fleetId: "missing" }),
    });
    assert.equal(stolen.status, 403);
    assert.equal((await stolen.json()).error, "You do not own this player.");

    const bad = await owner.app.request("/api/fleet/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId }),
    });
    assert.equal(bad.status, 400);

    const grant = await owner.app.request("/api/e2e/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        ships: { scout: 2 },
        resources: { deuterium: 80_000 },
      }),
    });
    assert.equal(grant.status, 200);

    const launched = await owner.app.request("/api/launch-fleet", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        playerId,
        mission: "expedition",
        ships: { scout: 1 },
        targetCoords: { galaxy: 1, system: 4, slot: 16 },
      }),
    });
    assert.equal(launched.status, 200);
    const inFlight = (await launched.json()) as {
      player: { id: string };
      planet: { resources: { deuterium: number } };
      fleets: Array<{ id: string; phase: string; mission: string; ownerPlayerId: string }>;
    };
    assert.equal(inFlight.player.id, playerId);
    const fleet = inFlight.fleets.find((row) => row.mission === "expedition");
    assert.ok(fleet);
    assert.equal(fleet?.phase, "outbound");
    const deut = inFlight.planet.resources.deuterium;

    const recalled = await owner.app.request("/api/fleet/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, fleetId: fleet!.id }),
    });
    assert.equal(recalled.status, 200);
    const after = (await recalled.json()) as {
      player: { id: string };
      planet: { id: string; resources: { deuterium: number } };
      fleets: Array<{ id: string; phase: string; mission: string }>;
    };
    assert.equal(after.player.id, playerId);
    assert.equal(after.planet.id, owner.view.planet.id);
    const turned = after.fleets.find((row) => row.id === fleet!.id);
    assert.equal(turned?.phase, "returning");
    assert.equal(turned?.mission, "expedition");
    assert.ok(after.planet.resources.deuterium <= deut);

    const twice = await owner.app.request("/api/fleet/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ playerId, fleetId: fleet!.id }),
    });
    assert.equal(twice.status, 400);
    const twiceError = (await twice.json()).error as string;
    assert.ok(
      twiceError === "Only an outbound fleet can be recalled." ||
        twiceError === "Fleet not found.",
      twiceError,
    );

    const state = await owner.app.request(`/api/state?playerId=${playerId}`, {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(state.status, 200);
    const later = (await state.json()) as {
      player: { id: string };
      fleets: Array<{ id: string; phase: string }>;
    };
    assert.equal(later.player.id, playerId);
    const still = later.fleets.find((row) => row.id === fleet!.id);
    assert.ok(!still || still.phase === "returning");
  });
});
