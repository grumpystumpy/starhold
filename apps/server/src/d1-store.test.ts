import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, UNIVERSE_SCHEMA_VERSION } from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { createD1Store, type D1Like, type D1RunResult, type D1Stmt } from "./d1-store.js";
import type { KvStore } from "./kv.js";
import { structuralStamp } from "./persist-stamp.js";
import { runWithScope } from "./request-context.js";
import { resetMemoryUniverse, withUniverse, withUniverseRead } from "./store.js";
import { splitUniverse } from "./universe-docs.js";

function sqliteD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER
    );
  `);
  return {
    prepare(sql: string): D1Stmt {
      const stmt = db.prepare(sql);
      const bound: { sql: string; values: unknown[] } = { sql, values: [] };
      const api: D1Stmt = {
        bind(...values: unknown[]) {
          bound.values = values;
          return api;
        },
        async first<T>() {
          const row = stmt.get(...(bound.values as never[])) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          const rows = stmt.all(...(bound.values as never[])) as T[];
          return { results: rows };
        },
        async run(): Promise<D1RunResult> {
          const result = stmt.run(...(bound.values as never[]));
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
      };
      return api;
    },
    async batch(statements) {
      const results: D1RunResult[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  };
}

describe("D1 kv store", () => {
  it("round-trips JSON and chunks values past one SQL cell", async () => {
    const store = createD1Store(sqliteD1());
    await store.set("small", { ok: true });
    assert.deepEqual(await store.get("small"), { ok: true });

    const big = "x".repeat(120_000);
    await store.set("big", big);
    assert.equal(await store.get("big"), big);

    const nx = await store.set("small", { ok: false }, { nx: true });
    assert.equal(nx, null);
    assert.deepEqual(await store.get("small"), { ok: true });
  });

  it("lock NX expires and can be taken again", async () => {
    let now = 1_000;
    const store = createD1Store(sqliteD1(), () => now);
    assert.equal(await store.set("lock", "a", { nx: true, px: 50 }), "OK");
    assert.equal(await store.set("lock", "b", { nx: true, px: 50 }), null);
    now = 1_060;
    assert.equal(await store.set("lock", "c", { nx: true, px: 50 }), "OK");
    assert.equal(await store.get("lock"), "c");
  });

  it("GET skips a D1 write when only resources change", async () => {
    resetMemoryUniverse();
    const previous = process.env.STARHOLD_RUNTIME;
    process.env.STARHOLD_RUNTIME = "workers";
    const store = createD1Store(sqliteD1());
    try {
      await runWithScope(
        { kv: store, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            joinUniverse(universe, "Ada");
          }),
      );
      const base = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
      const versionKey = `${base}:ver`;
      const before = await store.get<string>(versionKey);
      const playerRows = await store.list!(`${base}:player:`);
      assert.equal(playerRows.length, 1);
      const playerKey = playerRows[0]!.key;
      const playerBefore = JSON.stringify(playerRows[0]!.value);
      const asteroidsBefore = JSON.stringify(await store.get(`${base}:asteroids`));
      assert.equal(await store.get(base), null);
      await runWithScope(
        { kv: store, mode: "d1", method: "GET", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            const planet = Object.values(universe.planets)[0];
            if (planet) planet.resources.metal += 25;
          }),
      );
      const after = await store.get<string>(versionKey);
      assert.equal(after, before);
      assert.equal(JSON.stringify(await store.get(playerKey)), playerBefore);
      assert.equal(JSON.stringify(await store.get(`${base}:asteroids`)), asteroidsBefore);

      await runWithScope(
        { kv: store, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            const planet = Object.values(universe.planets)[0];
            planet?.buildQueue.push({
              id: "q1",
              kind: "building",
              buildingId: "metalMine",
              targetLevel: 2,
              startedAt: 1,
              finishesAt: 2,
            } as never);
          }),
      );
      assert.notEqual(JSON.stringify(await store.get(playerKey)), playerBefore);
      assert.equal(JSON.stringify(await store.get(`${base}:asteroids`)), asteroidsBefore);
      assert.notEqual(await store.get<string>(versionKey), before);
    } finally {
      if (previous == null) delete process.env.STARHOLD_RUNTIME;
      else process.env.STARHOLD_RUNTIME = previous;
      resetMemoryUniverse();
    }
  });
});

describe("structural stamp", () => {
  it("ignores resource floats and notices a build queue", () => {
    const universe = createUniverse("Stamp", 1, 1, { lazySeed: true });
    const { player } = joinUniverse(universe, "Ada");
    const planet = universe.planets[player.homePlanetId]!;
    const before = structuralStamp(universe);
    planet.resources.metal += 100;
    planet.lastTickAt += 5_000;
    assert.equal(structuralStamp(universe), before);
    planet.buildQueue.push({
      id: "q1",
      kind: "building",
      buildingId: "metalMine",
      targetLevel: 1,
      startedAt: 1,
      finishesAt: 2,
    } as never);
    assert.notEqual(structuralStamp(universe), before);
  });
});

describe("version-checked saves and read snapshots", () => {
  it("rejects a stale write and retries on the newer snapshot", async () => {
    resetMemoryUniverse();
    const previous = process.env.STARHOLD_RUNTIME;
    process.env.STARHOLD_RUNTIME = "workers";
    const inner = createD1Store(sqliteD1());
    let arm = false;
    let versionReads = 0;
    const writtenNames: string[] = [];
    const store: KvStore = {
      get: (key, opts) => {
        if (arm && key.endsWith(":ver")) {
          versionReads += 1;
          if (versionReads === 1) return inner.get(key, opts);
          return Promise.resolve("9999999999999");
        }
        return inner.get(key, opts);
      },
      set: async (key, value, opts) => {
        if (
          key.includes(":player:") &&
          value &&
          typeof value === "object" &&
          "player" in value
        ) {
          const name = (value as { player?: { name?: string } }).player?.name;
          if (name) writtenNames.push(name);
        }
        return inner.set(key, value, opts);
      },
      del: (key) => inner.del(key),
      list: (prefix) => inner.list!(prefix),
    };
    try {
      await runWithScope(
        { kv: store, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            joinUniverse(universe, "Keeper");
          }),
      );
      resetMemoryUniverse();
      arm = true;
      let attempts = 0;
      await runWithScope(
        { kv: store, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            attempts += 1;
            const player = Object.values(universe.players)[0];
            assert.ok(player);
            player.name = attempts === 1 ? "STALE" : "RETRIED";
          }),
      );
      assert.equal(attempts, 2);
      assert.deepEqual(writtenNames.filter((name) => name === "STALE"), []);
      assert.ok(writtenNames.includes("RETRIED"));
      const base = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
      const rows = await inner.list!(`${base}:player:`);
      const saved = rows[0]?.value as { player?: { name?: string } };
      assert.equal(saved.player?.name, "RETRIED");
    } finally {
      if (previous == null) delete process.env.STARHOLD_RUNTIME;
      else process.env.STARHOLD_RUNTIME = previous;
      resetMemoryUniverse();
    }
  });

  it("loads a save written before the version check with progress intact", async () => {
    resetMemoryUniverse();
    const previous = process.env.STARHOLD_RUNTIME;
    process.env.STARHOLD_RUNTIME = "workers";
    const store = createD1Store(sqliteD1());
    try {
      const universe = createUniverse("Alpha Drift", 8, 1_700_000_000_000, {
        lazySeed: true,
      });
      const { player } = joinUniverse(universe, "OldHand");
      const home = universe.planets[player.homePlanetId]!;
      home.buildings.metalMine = 4;
      home.resources.metal = 4321;
      const parts = splitUniverse(universe);
      const base = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
      await store.set(`${base}:world`, parts.world);
      await store.set(`${base}:asteroids`, parts.asteroids);
      await store.set(`${base}:pirates`, parts.pirates);
      await store.set(`${base}:aliens`, parts.aliens);
      await store.set(`${base}:player:${player.id}`, parts.players[player.id]);
      await store.set(`${base}:ver`, "100");
      resetMemoryUniverse();
      await runWithScope(
        { kv: store, mode: "d1", method: "GET", cpuMs: 0 },
        () =>
          withUniverseRead((loaded) => {
            const again = loaded.players[player.id];
            assert.ok(again);
            assert.equal(again.name, "OldHand");
            const planet = loaded.planets[again.homePlanetId];
            assert.equal(planet?.buildings.metalMine, 4);
            assert.equal(planet?.resources.metal, 4321);
          }),
      );
    } finally {
      if (previous == null) delete process.env.STARHOLD_RUNTIME;
      else process.env.STARHOLD_RUNTIME = previous;
      resetMemoryUniverse();
    }
  });

  it("does not take the universe lock for /api/state or /api/auth/me", async () => {
    resetMemoryUniverse();
    resetMemoryAccounts();
    const previousRuntime = process.env.STARHOLD_RUNTIME;
    const previousVercel = process.env.VERCEL;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.VERCEL;
    const inner = createD1Store(sqliteD1());
    let lockWrites = 0;
    const store: KvStore = {
      get: (key, opts) => inner.get(key, opts),
      set: async (key, value, opts) => {
        if (key.endsWith(":lock")) lockWrites += 1;
        return inner.set(key, value, opts);
      },
      del: (key) => inner.del(key),
      list: (prefix) => inner.list!(prefix),
    };
    const app = createApp();
    const call = (method: string, path: string, init?: RequestInit) =>
      runWithScope({ kv: store, mode: "d1", method, cpuMs: 0 }, () =>
        app.request(path, { method, ...init }),
      );
    try {
      const signup = await call("POST", "/api/auth/signup", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "lockless@example.com",
          password: "hunter2xx",
        }),
      });
      assert.equal(signup.status, 200);
      const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
      const join = await call("POST", "/api/auth/join", {
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Lockless" }),
      });
      assert.equal(join.status, 200);
      const joined = (await join.json()) as { player: { id: string } };
      lockWrites = 0;
      const state = await call(
        "GET",
        `/api/state?playerId=${encodeURIComponent(joined.player.id)}`,
      );
      assert.equal(state.status, 200);
      const me = await call("GET", "/api/auth/me", {
        headers: { Cookie: cookie },
      });
      assert.equal(me.status, 200);
      const meBody = (await me.json()) as { view: { player: { id: string } } | null };
      assert.equal(meBody.view?.player.id, joined.player.id);
      assert.equal(lockWrites, 0);
    } finally {
      if (previousRuntime == null) delete process.env.STARHOLD_RUNTIME;
      else process.env.STARHOLD_RUNTIME = previousRuntime;
      if (previousVercel == null) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
      resetMemoryUniverse();
      resetMemoryAccounts();
    }
  });
});
