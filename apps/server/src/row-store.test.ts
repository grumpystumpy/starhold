import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  queueBuildingUpgrade,
  tickPirates,
  UNIVERSE_SCHEMA_VERSION,
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
  rollbackRowsToLegacy,
  ensureRowTables,
} from "./row-store.js";
import { resetMemoryUniverse, withUniverse, withUniverseRead } from "./store.js";
import { createApp } from "./app.js";

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
    arrivesAt: Date.now() + 86_400_000,
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

function migrationState(raw: DatabaseSync): { v: number; stage: string; pass: number; cursor: string } {
  const row = raw.prepare("SELECT value FROM save_meta WHERE id = ?").get("migration") as
    | { value: string }
    | undefined;
  return JSON.parse(row?.value ?? "{}") as { v: number; stage: string; pass: number; cursor: string };
}

describe("row save review fixes", () => {
  it("recopies player progress written after the players section", async () => {
    const { db, raw } = sqliteD1();
    const source = fixture();
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    for (let i = 0; i < 40; i++) {
      const step = await migrateChunk(db, source);
      const state = migrationState(raw);
      if (state.pass === 1 && state.stage === "world" && state.cursor === "") break;
      assert.equal(step.done, false);
    }
    alpha.starshards = 999;
    alpha.research = { ...alpha.research, energyTech: 5 };
    await migrateAll(db, source);
    const loaded = await loadWorkingSet(db, { full: true });
    assert.equal(loaded.universe.players[alpha.id]?.starshards, 999);
    assert.equal(loaded.universe.players[alpha.id]?.research.energyTech, 5);
  });

  it("copies every system in galaxy/system order and finishes a large save", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    source.asteroids = {};
    source.debris = {};
    for (let galaxy = 1; galaxy <= 2; galaxy++) {
      for (let system = 1; system <= 60; system++) {
        const key = `${galaxy}:${system}`;
        source.asteroids[`ast-${key}`] = {
          id: `ast-${key}`,
          coords: { galaxy, system, slot: 15 },
          metal: galaxy * 100 + system,
          crystal: 3,
          deuterium: 1,
          richness: 2,
        };
        source.debris[`deb-${key}`] = {
          coords: { galaxy, system, slot: 16 },
          metal: system,
          crystal: galaxy,
        };
      }
    }
    let steps = 0;
    for (; steps < 80; steps++) {
      const step = await migrateChunk(db, source);
      if (step.done) break;
    }
    assert.ok(steps < 80, `migration still running after ${steps} chunks`);
    const loaded = await loadWorkingSet(db, { full: true });
    for (let galaxy = 1; galaxy <= 2; galaxy++) {
      for (let system = 1; system <= 60; system++) {
        const key = `${galaxy}:${system}`;
        assert.equal(loaded.universe.asteroids?.[`ast-${key}`]?.metal, galaxy * 100 + system);
        assert.equal(loaded.universe.debris?.[`deb-${key}`]?.metal, system);
        assert.equal(loaded.universe.debris?.[`deb-${key}`]?.crystal, galaxy);
      }
    }
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    assert.equal(loaded.universe.players[alpha.id]?.starshards, 42);
  });

  it("resolves a cross-system raid without deleting the attacker's ships", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const bravo = Object.values(source.players).find((player) => player.name === "Other")!;
    const origin = source.planets[alpha.homePlanetId]!;
    const target = source.planets[bravo.homePlanetId]!;
    target.coords = { ...target.coords, system: 40 };
    target.ships = { hauler: 0 };
    const now = Date.now();
    const fleet: FleetMission = {
      id: "fleet-cross",
      ownerPlayerId: alpha.id,
      originPlanetId: origin.id,
      targetPlanetId: target.id,
      targetPlayerId: bravo.id,
      targetCoords: target.coords,
      mission: "raid",
      ships: { hauler: 2 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now - 60_000,
      arrivesAt: now - 1_000,
      phase: "outbound",
      reportId: null,
    };
    source.fleets[fleet.id] = fleet;
    await migrateAll(db, source);
    const store = createD1Store(db);
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          const tick = Date.now();
          advanceUniverse(universe, tick);
          const live = universe.fleets["fleet-cross"];
          assert.ok(live, "defender refresh deleted the fleet");
          assert.equal(live.phase, "returning");
          assert.equal(live.ships.hauler, 2);
          assert.ok(Object.values(universe.reports).some((report) => report.attackerPlayerId === alpha.id && report.id !== "rep-old"));
          advanceUniverse(universe, tick + 30 * 24 * 60 * 60 * 1000);
          assert.equal(universe.fleets["fleet-cross"], undefined);
          assert.ok((universe.planets[origin.id]?.ships.hauler ?? 0) >= 2);
        }, { playerIds: [bravo.id] }),
    );
    const stored = await loadWorkingSet(db, { playerIds: [alpha.id] });
    assert.ok((stored.universe.planets[origin.id]?.ships.hauler ?? 0) >= 2);
    assert.equal(stored.universe.fleets["fleet-cross"], undefined);
  });

  it("merges debris into an unloaded system, clears a harvest, and keeps debris for 30 days", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    source.asteroids = {
      ...(source.asteroids ?? {}),
      "ast-77": {
        id: "ast-77",
        coords: { galaxy: 1, system: 77, slot: 15 },
        metal: 11,
        crystal: 0,
        deuterium: 4,
        richness: 1,
      },
    };
    source.debris = {
      ...(source.debris ?? {}),
      "deb-77": { coords: { galaxy: 1, system: 77, slot: 16 }, metal: 8, crystal: 2 },
      "deb-home": { coords: { galaxy: 1, system: 1, slot: 16 }, metal: 100, crystal: 40 },
    };
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          universe.debris["deb-new"] = {
            coords: { galaxy: 1, system: 77, slot: 14 },
            metal: 5,
            crystal: 1,
          };
          const home = universe.debris["deb-home"];
          assert.ok(home);
          home.metal = 40;
        }, { playerIds: [alpha.id], galaxy: 1, system: 1 }),
    );
    const merged = await loadWorkingSet(db, { full: true });
    assert.equal(merged.universe.asteroids?.["ast-77"]?.metal, 11);
    assert.equal(merged.universe.debris?.["deb-77"]?.metal, 8);
    assert.equal(merged.universe.debris?.["deb-new"]?.metal, 5);
    assert.equal(merged.universe.debris?.["deb-home"]?.metal, 40);

    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          delete universe.debris["deb-home"];
        }, { playerIds: [alpha.id], galaxy: 1, system: 1 }),
    );
    const cleared = await loadWorkingSet(db, { full: true });
    assert.equal(cleared.universe.debris?.["deb-home"], undefined);
    assert.equal(cleared.universe.debris?.["deb-77"]?.metal, 8);

    const day = 24 * 60 * 60 * 1000;
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          advanceUniverse(universe, Date.now() + 30 * day);
        }, { maintenance: true }),
    );
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () => withUniverse((universe) => tickPirates(universe, Date.now() + 30 * day), { npc: true }),
    );
    const aged = await loadWorkingSet(db, { full: true });
    assert.equal(aged.universe.debris?.["deb-77"]?.metal, 8);
    assert.equal(aged.universe.debris?.["deb-77"]?.crystal, 2);
    assert.equal(aged.universe.debris?.["deb-new"]?.metal, 5);
  });

  it("rolls a mid-save conflict back with no partial write and no double apply", async () => {
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const homeId = alpha.homePlanetId;
    await assert.rejects(
      () =>
        runWithScope(
          { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
          () =>
            withUniverse((universe) => {
              const player = universe.players[alpha.id]!;
              player.starshards = (player.starshards ?? 0) + 1;
              const home = universe.planets[homeId]!;
              home.buildings = { ...home.buildings, metalMine: (home.buildings.metalMine ?? 0) + 1 };
              raw.prepare("UPDATE save_planets SET version = version + 1 WHERE id = ?").run(homeId);
            }, { playerIds: [alpha.id] }),
        ),
      /Row changed/,
    );
    const loaded = await loadWorkingSet(db, { full: true });
    assert.equal(loaded.universe.players[alpha.id]?.starshards, 42);
    assert.equal(loaded.universe.planets[homeId]?.buildings.metalMine, 4);
  });

  it("writes rows back into the legacy kv save", async () => {
    const previous = process.env.STARHOLD_ROW_SAVE;
    const { db } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    try {
      await runWithScope(
        { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            universe.players[alpha.id]!.starshards = 999;
          }, { playerIds: [alpha.id] }),
      );
      const copied = await rollbackRowsToLegacy(db, store);
      assert.ok(copied.players >= 2);
      const base = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
      const slice = await store.get<{ player: { starshards: number }; planets: Record<string, unknown> }>(
        `${base}:player:${alpha.id}`,
      );
      assert.equal(slice?.player.starshards, 999);
      assert.ok(slice?.planets[alpha.homePlanetId]);
      process.env.STARHOLD_ROW_SAVE = "legacy";
      resetMemoryUniverse();
      await runWithScope(
        { kv: store, db, mode: "d1", method: "GET", cpuMs: 0 },
        () =>
          withUniverseRead((universe) => {
            assert.equal(universe.players[alpha.id]?.starshards, 999);
          }, { playerIds: [alpha.id] }),
      );
    } finally {
      if (previous == null) delete process.env.STARHOLD_ROW_SAVE;
      else process.env.STARHOLD_ROW_SAVE = previous;
      resetMemoryUniverse();
    }
  });

  it("adds a new commander to the cached highscore board immediately", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    await runWithScope(
      { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          joinUniverse(universe, "NewHand");
        }, { catalog: true }),
    );
    const board = await db
      .prepare("SELECT doc FROM save_highscores WHERE id = 'board'")
      .bind()
      .first<{ doc: string }>();
    assert.match(board?.doc ?? "", /NewHand/);
  });

  it("stays inside the D1 query budget", async () => {
    const { db: inner } = sqliteD1();
    let n = 0;
    const db: D1Like & { take(): number } = {
      take() {
        const value = n;
        n = 0;
        return value;
      },
      prepare(sql: string): D1Stmt {
        const stmt = inner.prepare(sql);
        let bound: D1Stmt = stmt;
        const api: D1Stmt = {
          bind(...values: unknown[]) {
            bound = stmt.bind(...values);
            return api;
          },
          async first<T>() {
            n += 1;
            return bound.first<T>();
          },
          async all<T>() {
            n += 1;
            return bound.all<T>();
          },
          async run() {
            n += 1;
            return bound.run();
          },
        };
        return api;
      },
      batch(statements) {
        return inner.batch(statements);
      },
    };
    const source = fixture();
    await migrateAll(db, source);
    db.take();
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const bravo = Object.values(source.players).find((player) => player.name === "Other")!;
    const home = source.planets[alpha.homePlanetId]!;
    const count = async (run: () => Promise<void>) => {
      db.take();
      await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, run);
      return db.take();
    };
    const state = await count(() =>
      withUniverseRead(() => undefined, { playerIds: [alpha.id], galaxy: home.coords.galaxy, system: home.coords.system }),
    );
    const galaxy = await count(() =>
      withUniverseRead(() => undefined, { playerIds: [alpha.id], galaxy: 2, system: 9 }),
    );
    const upgrade = await count(() =>
      withUniverse((universe) => {
        const planet = universe.planets[home.id]!;
        planet.resources = { metal: 9_000_000, crystal: 9_000_000, deuterium: 9_000_000 };
        queueBuildingUpgrade(universe, alpha.id, "metalMine", Date.now(), home.id);
      }, { playerIds: [alpha.id] }),
    );
    const two = await count(() =>
      withUniverse((universe) => {
        universe.players[alpha.id]!.name = "OldHand2";
      }, { playerIds: [alpha.id, bravo.id] }),
    );
    const join = await count(() =>
      withUniverse((universe) => {
        joinUniverse(universe, "BudgetHand");
      }, { catalog: true }),
    );
    const npcStarted = performance.now();
    const npc = await count(() =>
      withUniverse((universe) => {
        tickPirates(universe, Date.now());
      }, { npc: true }),
    );
    const npcCpu = performance.now() - npcStarted;
    const migrationDb = sqliteD1();
    let migrationQueries = 0;
    const migrationCounter: D1Like = {
      prepare(sql: string): D1Stmt {
        const stmt = migrationDb.db.prepare(sql);
        let bound: D1Stmt = stmt;
        const api: D1Stmt = {
          bind(...values: unknown[]) {
            bound = stmt.bind(...values);
            return api;
          },
          async first<T>() {
            migrationQueries += 1;
            return bound.first<T>();
          },
          async all<T>() {
            migrationQueries += 1;
            return bound.all<T>();
          },
          async run() {
            migrationQueries += 1;
            return bound.run();
          },
        };
        return api;
      },
      batch(statements) {
        return migrationDb.db.batch(statements);
      },
    };
    await ensureRowTables(migrationCounter);
    migrationQueries = 0;
    await migrateChunk(migrationCounter, fixture());
    const migration = migrationQueries;
    const table = { state, galaxy, upgrade, two, join, npc, migration, npcCpu: Number(npcCpu.toFixed(2)) };
    console.log(`query counts ${JSON.stringify(table)}`);
    assert.ok(state <= 20, `state ${state}`);
    assert.ok(galaxy <= 20, `galaxy ${galaxy}`);
    assert.ok(upgrade <= 20, `upgrade ${upgrade}`);
    assert.ok(two <= 20, `two ${two}`);
    assert.ok(join <= 20, `join ${join}`);
    assert.ok(npc <= 40, `npc ${npc}`);
    assert.ok(migration <= 40, `migration ${migration}`);
  });

  it("hides rollback unless the admin token matches", async () => {
    const previous = process.env.STARHOLD_ADMIN_TOKEN;
    delete process.env.STARHOLD_ADMIN_TOKEN;
    try {
      const app = createApp();
      const hidden = await app.request("/api/admin/rollback-rows", { method: "POST" });
      assert.equal(hidden.status, 404);
      process.env.STARHOLD_ADMIN_TOKEN = "secret-token";
      const denied = await app.request("/api/admin/rollback-rows", {
        method: "POST",
        headers: { "x-starhold-admin": "nope" },
      });
      assert.equal(denied.status, 404);
    } finally {
      if (previous == null) delete process.env.STARHOLD_ADMIN_TOKEN;
      else process.env.STARHOLD_ADMIN_TOKEN = previous;
    }
  });
});

