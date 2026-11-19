import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

describe("achievement state route", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
  });

  it("pays retro achievements once on the owning state read", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "achievements@example.com", password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Achiever" }),
    });
    assert.equal(join.status, 200);
    const joined = (await join.json()) as {
      starshards: number;
      achievements?: Array<{ id: string; unlocked: boolean }>;
      player: { id: string; achievements?: { unlocked: Array<{ id: string }> } };
    };
    assert.equal(joined.starshards, 0);
    assert.equal(joined.achievements?.length, 12);
    assert.equal(joined.achievements?.every((row) => row.unlocked === false), true);
    const playerId = joined.player.id;

    await withUniverse((universe) => {
      const player = universe.players[playerId]!;
      const home = universe.planets[player.homePlanetId]!;
      const moon = structuredClone(home);
      moon.id = "moon_route";
      moon.kind = "moon";
      moon.name = "Route Moon";
      moon.parentPlanetId = home.id;
      moon.moonId = null;
      universe.planets[moon.id] = moon;
      home.moonId = moon.id;
      player.planetIds.push(moon.id);
      player.research = { ...player.research, energyTech: 1 };
      player.combatStats = { lostValue: 0, destroyedValue: 0, wins: 10, losses: 0 };
      player.starshards = 0;
      delete player.achievements;
    });

    const first = await app.request(`/api/state?playerId=${playerId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(first.status, 200);
    const paid = (await first.json()) as {
      starshards: number;
      achievements?: Array<{ id: string; unlocked: boolean; starshards: number }>;
      player: { achievements?: { unlocked: Array<{ id: string; at: number }> } };
    };
    const unlocked = new Set(
      (paid.player.achievements?.unlocked ?? []).map((row) => row.id),
    );
    for (const id of ["firstMoon", "firstResearch", "firstVictory", "victories10"]) {
      assert.equal(unlocked.has(id), true, id);
      assert.equal(paid.achievements?.find((row) => row.id === id)?.unlocked, true);
    }
    assert.equal(unlocked.has("shipsDestroyed1000"), false);
    assert.equal(unlocked.has("highscoreTop10"), false);
    const expected = (paid.achievements ?? [])
      .filter((row) => row.unlocked)
      .reduce((sum, row) => sum + row.starshards, 0);
    assert.equal(paid.starshards, expected);
    assert.ok(expected >= 15 + 10 + 10 + 20);
    for (const row of paid.player.achievements?.unlocked ?? []) {
      assert.equal(typeof row.at, "number");
    }

    const second = await app.request(`/api/state?playerId=${playerId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(second.status, 200);
    const again = (await second.json()) as { starshards: number };
    assert.equal(again.starshards, paid.starshards);

    const missing = await app.request("/api/state?playerId=missing-commander");
    assert.equal(missing.status, 404);
  });
});
