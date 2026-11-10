import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  PLAYER_ACTIVITY_STAMP_MS,
  PLAYER_INACTIVE_MS,
  PLAYER_LONG_INACTIVE_MS,
  type PlayerView,
} from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

function cookieOf(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const cookie = raw.split(";")[0] ?? "";
  assert.match(cookie, /starhold_session=/);
  return cookie;
}

async function signupAndJoin(app: ReturnType<typeof createApp>, email: string, name: string) {
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "hunter2xx" }),
  });
  assert.equal(signup.status, 200);
  const cookie = cookieOf(signup);
  const join = await app.request("/api/auth/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  assert.equal(join.status, 200);
  const view = (await join.json()) as PlayerView;
  return { cookie, view };
}

describe("authenticated state stamps galaxy inactivity", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
  });

  it("does not write lastActiveAt without that commander's session", async () => {
    const app = createApp();
    const owner = await signupAndJoin(app, "quiet@example.com", "Quiet");
    const other = await signupAndJoin(app, "other@example.com", "Other");
    const stale = Date.now() - PLAYER_ACTIVITY_STAMP_MS - 5_000;
    await withUniverse((universe) => {
      universe.players[owner.view.player.id]!.lastActiveAt = stale;
    });

    const anon = await app.request(
      `/api/state?playerId=${encodeURIComponent(owner.view.player.id)}`,
    );
    assert.equal(anon.status, 200);
    const anonBody = (await anon.json()) as PlayerView;
    assert.equal(anonBody.player.lastActiveAt, stale);

    const stolen = await app.request(
      `/api/state?playerId=${encodeURIComponent(owner.view.player.id)}`,
      { headers: { Cookie: other.cookie } },
    );
    assert.equal(stolen.status, 200);
    const stolenBody = (await stolen.json()) as PlayerView;
    assert.equal(stolenBody.player.lastActiveAt, stale);
    assert.equal(
      (await withUniverse((universe) => universe.players[owner.view.player.id]?.lastActiveAt)),
      stale,
    );
    assert.equal(stolenBody.planet.buildings.metalMine, 1);
    assert.equal(stolenBody.fleets.length, owner.view.fleets.length);
  });

  it("stamps at most once per hour and serves i or I on the galaxy payload", async () => {
    const app = createApp();
    const viewer = await signupAndJoin(app, "viewer@example.com", "Viewer");
    const quiet = await signupAndJoin(app, "away@example.com", "Away");
    const week = Date.now() - PLAYER_INACTIVE_MS - 1_000;
    const due = Date.now() - PLAYER_ACTIVITY_STAMP_MS - 1_000;
    await withUniverse((universe) => {
      universe.players[quiet.view.player.id]!.lastActiveAt = week;
      universe.players[viewer.view.player.id]!.lastActiveAt = due;
    });
    const coords = quiet.view.planet.coords;
    const started = Date.now();
    const first = await app.request(
      `/api/state?playerId=${encodeURIComponent(viewer.view.player.id)}&galaxy=${coords.galaxy}&system=${coords.system}`,
      { headers: { Cookie: viewer.cookie } },
    );
    assert.equal(first.status, 200);
    const body = (await first.json()) as PlayerView;
    assert.equal(typeof body.player.lastActiveAt, "number");
    assert.ok(body.player.lastActiveAt! >= started);
    assert.ok(body.player.lastActiveAt! <= Date.now());
    const stamped = body.player.lastActiveAt!;
    const row = body.galaxy.slots.find((slot) => slot.planetId === quiet.view.planet.id);
    assert.ok(row);
    assert.equal(row.inactivity, "i");
    assert.equal(row.playerName, "Away");
    const self = body.galaxy.slots.find((slot) => slot.playerId === viewer.view.player.id);
    if (self) assert.equal(self.inactivity, undefined);

    const second = await app.request(
      `/api/state?playerId=${encodeURIComponent(viewer.view.player.id)}&galaxy=${coords.galaxy}&system=${coords.system}`,
      { headers: { Cookie: viewer.cookie } },
    );
    assert.equal(second.status, 200);
    const again = (await second.json()) as PlayerView;
    assert.equal(again.player.lastActiveAt, stamped);
    assert.equal(
      (await withUniverse((universe) => universe.players[viewer.view.player.id]?.lastActiveAt)),
      stamped,
    );
    assert.equal(
      (await withUniverse((universe) => universe.players[quiet.view.player.id]?.lastActiveAt)),
      week,
    );

    await withUniverse((universe) => {
      universe.players[quiet.view.player.id]!.lastActiveAt = Date.now() - PLAYER_LONG_INACTIVE_MS;
    });
    const third = await app.request(
      `/api/state?playerId=${encodeURIComponent(viewer.view.player.id)}&galaxy=${coords.galaxy}&system=${coords.system}`,
      { headers: { Cookie: viewer.cookie } },
    );
    const longBody = (await third.json()) as PlayerView;
    assert.equal(longBody.player.lastActiveAt, stamped);
    assert.equal(
      longBody.galaxy.slots.find((slot) => slot.planetId === quiet.view.planet.id)?.inactivity,
      "I",
    );
    assert.equal(longBody.planet.id, viewer.view.planet.id);
    assert.equal(longBody.planet.buildings.metalMine, viewer.view.planet.buildings.metalMine);
  });
});
