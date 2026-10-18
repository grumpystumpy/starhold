import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  createUniverse,
  joinUniverse,
  type CombatReport,
  type FleetMission,
  type PlanetState,
  type UniverseState,
} from "@starhold/game";
import { createD1Store, type D1Like, type D1RunResult, type D1Stmt } from "./d1-store.js";
import type { KvStore } from "./kv.js";
import { runWithScope } from "./request-context.js";
import {
  HIGHSCORE_TTL_MS,
  highscoreCacheExpired,
  loadWorkingSet,
  migrateAll,
  migrateChunk,
  readHighscoreMeta,
} from "./row-store.js";
import { resetMemoryUniverse, withUniverse, withUniverseRead } from "./store.js";

function sqliteD1(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER
    );
  `);
  const db: D1Like = {
    prepare(sql: string): D1Stmt {
      const stmt = raw.prepare(sql);
      const bound: { values: unknown[] } = { values: [] };
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
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { db, raw };
}

function progress(universe: UniverseState) {
  return Object.values(universe.players)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      starshards: player.starshards ?? 0,
      research: player.research,
      events: (player.eventLog ?? []).map((event) => event.id),
      planets: player.planetIds.map((id) => {
        const planet = universe.planets[id];
        return {
          id,
          kind: planet?.kind ?? "planet",
          buildings: planet?.buildings,
          resources: planet?.resources,
          owner: planet?.ownerPlayerId,
        };
      }),
      fleets: Object.values(universe.fleets ?? {})
        .filter((fleet) => fleet.ownerPlayerId === player.id)
        .map((fleet) => ({
          id: fleet.id,
          mission: fleet.mission,
          phase: fleet.phase,
          arrivesAt: fleet.arrivesAt,
        })),
    }));
}

function fixture(): UniverseState {
  const now = 1_700_000_000_000;
  const universe = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
  if (universe.seedCursor) universe.seedCursor.done = true;
  const alpha = joinUniverse(universe, "OldHand", now).player;
  const bravo = joinUniverse(universe, "Other", now + 1).player;
  alpha.starshards = 42;
  alpha.research = { ...alpha.research, energyTech: 3 };
  alpha.eventLog = [
    {
      id: "note-1",
      kind: "raidAlert",
      createdAt: now,
      readAt: null,
      title: "Contact",
      body: "Kept",
    },
  ];
  const home = universe.planets[alpha.homePlanetId]!;
  home.buildings = { ...home.buildings, metalMine: 4 };
  home.resources = { ...home.resources, metal: 4321 };
  const moon: PlanetState = {
    ...home,
    id: "moon-old",
    name: "Luna",
    kind: "moon",
    parentPlanetId: home.id,
    moonId: null,
    ownerPlayerId: alpha.id,
    buildings: { ...home.buildings, metalMine: 0, sensorArray: 1 },
    resources: { metal: 10, crystal: 20, deuterium: 30 },
  };
  home.moonId = moon.id;
  universe.planets[moon.id] = moon;
  alpha.planetIds = [...alpha.planetIds, moon.id];
  const target = universe.planets[bravo.homePlanetId]!;
  const fleet: FleetMission = {
    id: "fleet-old",
    ownerPlayerId: alpha.id,
    originPlanetId: home.id,
    targetPlanetId: target.id,
    targetPlayerId: bravo.id,
    targetCoords: target.coords,
    mission: "raid",
    ships: { scout: 1 },
    cargo: { metal: 5, crystal: 0, deuterium: 0 },
    departedAt: now,
    arrivesAt: now + 11_000,
    phase: "outbound",
    reportId: "rep-old",
  };
  universe.fleets[fleet.id] = fleet;
  universe.reports[fleet.reportId] = {
    id: "rep-old",
    attackerPlayerId: alpha.id,
    defenderPlayerId: bravo.id,
    at: now,
  } as CombatReport;
  universe.planets["far-mini"] = {
    ...home,
    id: "far-mini",
    name: "Far",
    ownerPlayerId: "",
    kind: "planet",
    coords: { galaxy: 2, system: 9, slot: 4 },
    moonId: null,
    parentPlanetId: null,
  };
  return universe;
}

describe("row save migration", () => {
  it("keeps progress, is idempotent, and resumes after an interrupt", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    const before = progress(source);
    const kvSentinel = JSON.stringify({ keep: "legacy-universe" });
    const store = createD1Store(db);
    await store.set("starhold:universe:v5", { id: "legacy" });
    await store.set("starhold:universe:v5:player:old", kvSentinel);

    const interrupted = await migrateChunk(db, source, 25, 1);
    assert.equal(interrupted.done, false);
    await migrateAll(db, source);
    await migrateAll(db, source);

    assert.equal(await store.get("starhold:universe:v5:player:old"), kvSentinel);
    const loaded = await loadWorkingSet(db, { maintenance: true });
    const after = progress(loaded.universe);
    assert.deepEqual(after, before);
    console.log(
      "migration compare",
      JSON.stringify({
        match: true,
        players: after.length,
        starshards: after.map((row) => row.starshards),
        metalMine: after[0]?.planets.find((planet) => planet.kind !== "moon")?.buildings,
        moon: after[0]?.planets.some((planet) => planet.kind === "moon"),
        fleets: after.reduce((sum, row) => sum + row.fleets.length, 0),
        events: after[0]?.events,
      }),
    );

    const meta = await readHighscoreMeta(db);
    assert.ok(meta && meta.rows >= 2);
    assert.equal(highscoreCacheExpired(meta!.builtAt, meta!.builtAt + HIGHSCORE_TTL_MS - 1), false);
    assert.equal(highscoreCacheExpired(meta!.builtAt, meta!.builtAt + HIGHSCORE_TTL_MS), true);
  });

  it("does not rebuild a stale highscore board on a page read", async () => {
    resetMemoryUniverse();
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const staleAt = Date.now() - HIGHSCORE_TTL_MS - 5_000;
    raw.prepare("UPDATE save_highscores SET built_at = ? WHERE id = 'board'").run(staleAt);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    await runWithScope(
      { kv: store, db, mode: "d1", method: "GET", cpuMs: 0 },
      () =>
        withUniverseRead((universe) => {
          assert.equal(universe.players[alpha.id]?.starshards, 42);
          assert.equal(universe.planets["far-mini"], undefined);
        }, { playerIds: [alpha.id], galaxy: 1, system: 1 }),
    );
    const afterRead = await readHighscoreMeta(db);
    assert.equal(afterRead?.builtAt, staleAt);
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () => withUniverse(() => undefined, { maintenance: true }),
    );
    const rebuilt = await readHighscoreMeta(db);
    assert.ok(rebuilt && rebuilt.builtAt !== staleAt);
    assert.equal(highscoreCacheExpired(rebuilt!.builtAt), false);
  });

  it("locks per player and rejects a stale row", async () => {
    resetMemoryUniverse();
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store: KvStore = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const bravo = Object.values(source.players).find((player) => player.name === "Other")!;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      async () => {
        const held = withUniverse(async () => {
          await gate;
        }, { playerIds: [alpha.id] });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const started = Date.now();
        await withUniverse((universe) => {
          const player = universe.players[bravo.id];
          assert.ok(player);
          player.name = "Moved";
        }, { playerIds: [bravo.id] });
        assert.ok(Date.now() - started < 800, "second player waited on the first lock");
        release();
        await held;
      },
    );
    const renamed = await loadWorkingSet(db, { playerIds: [bravo.id] });
    assert.equal(renamed.universe.players[bravo.id]?.name, "Moved");

    await assert.rejects(
      () =>
        runWithScope(
          { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
          () =>
            withUniverse(async (universe) => {
              const player = universe.players[alpha.id];
              assert.ok(player);
              player.name = "Nope";
              raw
                .prepare("UPDATE save_players SET version = version + 1 WHERE id = ?")
                .run(alpha.id);
            }, { playerIds: [alpha.id] }),
        ),
      /Row changed/,
    );
  });
});
