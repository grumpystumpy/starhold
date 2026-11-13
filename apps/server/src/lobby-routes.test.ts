import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import type { D1Like, D1RunResult, D1Stmt } from "./d1-store.js";
import { runWithScope } from "./request-context.js";
import { ensureRowTables } from "./row-store.js";

function sqliteD1(): { db: D1Like; raw: DatabaseSync; queries: string[] } {
  const raw = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const db: D1Like = {
    prepare(sql: string): D1Stmt {
      queries.push(sql);
      const bound: { values: unknown[] } = { values: [] };
      let stmt: ReturnType<DatabaseSync["prepare"]> | null = null;
      const compiled = () => {
        if (!stmt) stmt = raw.prepare(sql);
        return stmt;
      };
      const api: D1Stmt = {
        bind(...values: unknown[]) {
          bound.values = values;
          return api;
        },
        async first<T>() {
          const row = compiled().get(...(bound.values as never[])) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          const rows = compiled().all(...(bound.values as never[])) as T[];
          return { results: rows };
        },
        async run(): Promise<D1RunResult> {
          if (/^\s*SELECT\b/i.test(sql)) {
            return { results: compiled().all(...(bound.values as never[])) as unknown[] };
          }
          const result = compiled().run(...(bound.values as never[]));
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
      };
      return api;
    },
    async batch(statements) {
      raw.exec("BEGIN");
      const results: D1RunResult[] = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return { db, raw, queries };
}

function boardDoc(names: string[]): string {
  return JSON.stringify({
    rows: names.map((name, index) => ({
      rank: index + 1,
      playerId: `p${index}`,
      name,
      points: 5000 - index * 10,
      coords: { galaxy: 1, system: 1, slot: 1 },
      planetCount: 1,
      planetName: "Home",
      homePlanetId: `h${index}`,
      level: 1,
      xpTotal: 0,
    })),
    hallOfFame: [{ shareCode: "sh_secret" }],
    hallOfShame: [{ name: "Hidden" }],
  });
}

describe("GET /api/lobby", () => {
  it("reads only the cached board and publishes five names", async () => {
    const { db, raw, queries } = sqliteD1();
    await ensureRowTables(db);
    queries.length = 0;
    const doc = boardDoc(["<script>", "Bravo", "Cleo", "Dax", "Eve", "Faye", "Gus"]);
    const builtAt = 1_700_000_000_000;
    raw.prepare(
      "INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)",
    ).run(builtAt, doc);
    raw.prepare(
      "INSERT INTO save_players (id, version, doc) VALUES ('p0', 1, '{\"name\":\"nope\"}')",
    ).run();
    const before = queries.length;
    const app = createApp();
    const response = await runWithScope(
      { kv: null, db, mode: "d1", method: "GET", cpuMs: 0 },
      () => app.request("/api/lobby"),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    const body = await response.json() as {
      commanders: number;
      top: Array<{ rank: number; name: string; points: number }>;
    };
    assert.equal(body.commanders, 7);
    assert.equal(body.top.length, 5);
    assert.deepEqual(
      body.top.map((row) => row.name),
      ["<script>", "Bravo", "Cleo", "Dax", "Eve"],
    );
    assert.equal(body.top[0]?.rank, 1);
    assert.equal(body.top[0]?.points, 5000);
    assert.equal("playerId" in (body.top[0] ?? {}), false);
    assert.equal("hallOfFame" in body, false);
    const lobbySql = queries.slice(before);
    assert.equal(lobbySql.length, 1);
    assert.match(lobbySql[0] ?? "", /FROM save_highscores WHERE id = 'board'/);
    assert.doesNotMatch(lobbySql[0] ?? "", /save_players|save_world/);
    const stored = raw.prepare(
      "SELECT built_at, doc FROM save_highscores WHERE id = 'board'",
    ).get() as { built_at: number; doc: string };
    assert.equal(stored.built_at, builtAt);
    assert.equal(stored.doc, doc);
  });

  it("serves an empty teaser when the board row is missing", async () => {
    const { db, queries } = sqliteD1();
    await ensureRowTables(db);
    queries.length = 0;
    const app = createApp();
    const response = await runWithScope(
      { kv: null, db, mode: "d1", method: "GET", cpuMs: 0 },
      () => app.request("/api/lobby"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { commanders: 0, top: [] });
    assert.equal(queries.length, 1);
  });

  it("reads a legacy array board without rescoring", async () => {
    const { db, raw } = sqliteD1();
    await ensureRowTables(db);
    const doc = JSON.stringify([
      { rank: 1, name: "Legacy", points: 12 },
      { rank: 2, name: "Two", points: 3 },
    ]);
    raw.prepare(
      "INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', 0, ?)",
    ).run(doc);
    const app = createApp();
    const response = await runWithScope(
      { kv: null, db, mode: "d1", method: "GET", cpuMs: 0 },
      () => app.request("/api/lobby"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { commanders: number; top: Array<{ name: string }> };
    assert.equal(body.commanders, 2);
    assert.equal(body.top[0]?.name, "Legacy");
    const stored = raw.prepare("SELECT doc FROM save_highscores WHERE id = 'board'").get() as {
      doc: string;
    };
    assert.equal(stored.doc, doc);
  });

  it("returns an empty teaser when this process has no row database", async () => {
    const response = await createApp().request("/api/lobby");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.deepEqual(await response.json(), { commanders: 0, top: [] });
  });

  it("fails closed when the cached document is not JSON", async () => {
    const { db, raw } = sqliteD1();
    await ensureRowTables(db);
    raw.prepare(
      "INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', 1, ?)",
    ).run("not-json");
    const response = await runWithScope(
      { kv: null, db, mode: "d1", method: "GET", cpuMs: 0 },
      () => createApp().request("/api/lobby"),
    );
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
});
