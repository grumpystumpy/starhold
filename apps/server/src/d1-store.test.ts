import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, UNIVERSE_SCHEMA_VERSION } from "@starhold/game";
import { createD1Store, type D1Like, type D1RunResult, type D1Stmt } from "./d1-store.js";
import { structuralStamp } from "./persist-stamp.js";
import { runWithScope } from "./request-context.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

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
