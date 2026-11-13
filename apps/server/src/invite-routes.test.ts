import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { notePlanetMoved } from "../../../packages/game/dist/planet-index.js";
import { resetMemoryAccounts } from "./accounts.js";
import { createApp } from "./app.js";
import { resetMemoryUniverse, setUniverseFaultForTests, withUniverse } from "./store.js";

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("invite a friend nearby", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_RUNTIME;
    setUniverseFaultForTests(null);
  });

  it("copies a short code, places a friend nearby, and ignores a bad code", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "host@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(signup.status, 200);
    const cookie = cookieFrom(signup);

    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Host" }),
    });
    assert.equal(join.status, 200);
    const host = (await join.json()) as {
      player: { id: string; name: string };
      planet: { coords: { galaxy: number; system: number; slot: number } };
    };

    const denied = await app.request("/api/invite", { method: "POST" });
    assert.equal(denied.status, 401);

    const minted = await app.request("/api/invite", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(minted.status, 200);
    const invite = (await minted.json()) as {
      code: string;
      path: string;
      expiresAt: number;
    };
    assert.deepEqual(Object.keys(invite).sort(), ["code", "expiresAt", "path"]);
    assert.match(invite.code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.equal(invite.path, `/?invite=${invite.code}`);
    const inviteText = JSON.stringify(invite);
    assert.equal(inviteText.includes(host.player.id), false);
    assert.equal(inviteText.includes("host@example.com"), false);
    assert.equal(inviteText.includes("@"), false);

    const again = await app.request("/api/invite", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const reused = (await again.json()) as { code: string };
    assert.equal(reused.code, invite.code);

    await withUniverse((universe) => {
      const planet = universe.planets[universe.players[host.player.id]!.homePlanetId]!;
      const prev = { ...planet.coords };
      planet.coords = { galaxy: 3, system: 40, slot: 4 };
      notePlanetMoved(universe, planet, prev);
    });

    const friend = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Neighbor", invite: invite.code }),
    });
    assert.equal(friend.status, 200);
    const near = (await friend.json()) as {
      planet: { coords: { galaxy: number; system: number; slot: number } };
    };
    assert.equal(near.planet.coords.galaxy, 3);
    assert.ok(Math.abs(near.planet.coords.system - 40) <= 12);
    assert.notDeepEqual(near.planet.coords, { galaxy: 3, system: 40, slot: 4 });

    const stranger = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Wanderer", invite: host.player.id }),
    });
    assert.equal(stranger.status, 200);
    const far = (await stranger.json()) as {
      planet: { coords: { galaxy: number; system: number; slot: number } };
    };
    assert.equal(far.planet.coords.galaxy, 1);

    const state = await app.request(`/api/state?playerId=${encodeURIComponent(host.player.id)}`);
    assert.equal(state.status, 200);
    const stateBody = (await state.json()) as {
      invites?: unknown;
      player: { inviteCode?: string; id: string };
    };
    assert.equal(stateBody.invites, undefined);
    assert.equal(stateBody.player.inviteCode, undefined);
    assert.equal(JSON.stringify(stateBody).includes(invite.code), false);

    const stayed = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Other", invite: invite.code }),
    });
    const same = (await stayed.json()) as { player: { id: string } };
    assert.equal(same.player.id, host.player.id);
  });

  it("rate-limits a replacement code and still joins on an expired one", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "limit@example.com", password: "hunter2xx" }),
    });
    const cookie = cookieFrom(signup);
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Limiter" }),
    });
    const host = (await join.json()) as { player: { id: string } };
    const minted = await app.request("/api/invite", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const invite = (await minted.json()) as { code: string };
    await withUniverse((universe) => {
      const rec = universe.invites?.[invite.code];
      if (!rec) throw new Error("missing invite");
      rec.expiresAt = Date.now() - 1;
    });
    const limited = await app.request("/api/invite", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(limited.status, 429);

    const guest = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Late", invite: invite.code }),
    });
    assert.equal(guest.status, 200);
    const late = (await guest.json()) as { player: { id: string } };
    assert.notEqual(late.player.id, host.player.id);
  });
});
