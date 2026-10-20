import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  activePirateBases,
  advanceUniverse,
  createPirateBase,
  createUniverse,
  joinUniverse,
  launchFleet,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  NEWBIE_PROTECTION_POINTS,
  PIRATE_TARGET_BASE_COUNT,
  playerView,
  queueBuildingUpgrade,
  queueResearch,
  queueShipBuild,
  tickPirates,
  UNIVERSE_SCHEMA_VERSION,
  type CombatReport,
  type FleetMission,
  type PirateBase,
  type PlanetState,
  type UniverseState,
} from "@starhold/game";
import { continueUniverseSeed } from "../../../packages/game/src/world-seed.ts";
import { hashPbkdf2 } from "./password.js";
import { createD1Store, type D1Like, type D1RunResult, type D1Stmt } from "./d1-store.js";
import type { KvStore } from "./kv.js";
import { runWithScope, setServerErrorReporter } from "./request-context.js";
import {
  HIGHSCORE_TTL_MS,
  highscoreCacheExpired,
  loadWorkingSet,
  migrateAll,
  migrateChunk,
  migrationDone,
  readHighscoreMeta,
  rollbackRowsToLegacy,
  ensureRowTables,
  ROW_LOCK_MS,
  SaveKilledError,
  setMigrationClockForTests,
  setSaveAbortForTests,
} from "./row-store.js";
import { resetMemoryUniverse, setUniverseFaultForTests, withUniverse, withUniverseRead } from "./store.js";
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
  return { db, raw };
}

function subrequestD1(inner: D1Like, limit = 50): D1Like & { count(): number; reset(): number } {
  let n = 0;
  let inBatch = false;
  const hit = () => {
    if (inBatch) return;
    n += 1;
    if (n > limit) throw new Error("D1 query limit");
  };
  return {
    count: () => n,
    reset() {
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
          hit();
          return bound.first<T>();
        },
        async all<T>() {
          hit();
          return bound.all<T>();
        },
        async run() {
          hit();
          return bound.run();
        },
      };
      return api;
    },
    async batch(statements) {
      hit();
      inBatch = true;
      try {
        return await inner.batch(statements);
      } finally {
        inBatch = false;
      }
    },
  };
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
      let page = copied;
      while (!page.done) page = await rollbackRowsToLegacy(db, store);
      assert.ok(page.players >= 2);
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

  it("includes a joining commander in their response and the existing roster", async () => {
    resetMemoryUniverse();
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const existing = Object.values(source.players).find((player) => player.name === "OldHand")!;
    // Reproduce a live first join before maintenance has created the board.
    // The request scopes are separate, matching the Workers fetch lifecycle.
    raw.prepare("DELETE FROM save_highscores WHERE id = 'board'").run();
    const store = createD1Store(db);
    const app = createApp();
    const request = (method: string, fn: () => Promise<unknown>) =>
      runWithScope({ kv: store, db, mode: "d1", method, cpuMs: 0 }, fn);
    const joined = await request("POST", async () => {
        const response = await app.request("/api/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "NewHand" }),
        });
        assert.equal(response.status, 200);
        const joined = (await response.json()) as PlayerView;
        assert.ok(joined.roster.some(
          (entry) => entry.id === joined.player.id && entry.planetId === joined.player.homePlanetId,
        ));
        return joined;
    });
    // Workers create a fresh request scope for every fetch. Re-read the
    // board from D1 as an existing player would on its next /api/state.
    const existingResponse = await request("GET", () => app.request(
      `/api/state?playerId=${encodeURIComponent(existing.id)}`,
    ));
    assert.equal(existingResponse.status, 200);
    const existingView = (await existingResponse.json()) as PlayerView;
    assert.ok(existingView.roster.some(
      (entry) => entry.id === joined.player.id && entry.planetId === joined.player.homePlanetId,
    ));
  });

  it("an existing roster shows a joiner's current points after the joiner changes", async () => {
    resetMemoryUniverse();
    const { db } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const existing = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const store = createD1Store(db);
    const app = createApp();
    const previousHooks = process.env.ALLOW_E2E_HOOKS;
    process.env.ALLOW_E2E_HOOKS = "1";
    const request = (method: string, path: string, body?: unknown) =>
      runWithScope({ kv: store, db, mode: "d1", method, cpuMs: 0 }, () =>
        app.request(path, body === undefined ? { method } : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    try {
      const join = await request("POST", "/api/join", { name: "Rival" });
      assert.equal(join.status, 200);
      const rival = (await join.json()) as PlayerView;
      // Same path as the Workers e2e: the rival graduates, then the existing
      // player reloads and needs the rival as an attackable fleet target.
      const grad = await request("POST", "/api/e2e/graduate-newbie", { playerId: rival.player.id });
      assert.equal(grad.status, 200);
      const { points } = (await grad.json()) as { points: number };
      assert.ok(points >= NEWBIE_PROTECTION_POINTS);
      const state = await request("GET", `/api/state?playerId=${encodeURIComponent(existing.id)}`);
      assert.equal(state.status, 200);
      const view = (await state.json()) as PlayerView;
      const entry = view.roster.find((row) => row.id === rival.player.id);
      assert.equal(entry?.planetId, rival.player.homePlanetId);
      assert.ok((entry?.pointsHint ?? 0) >= NEWBIE_PROTECTION_POINTS, `stale pointsHint ${entry?.pointsHint}`);
    } finally {
      if (previousHooks == null) delete process.env.ALLOW_E2E_HOOKS;
      else process.env.ALLOW_E2E_HOOKS = previousHooks;
    }
  });

  it("keeps a write made without player ids (e2e grant) for an existing player", async () => {
    resetMemoryUniverse();
    const { db } = sqliteD1();
    await migrateAll(db, fixture());
    const store = createD1Store(db);
    const app = createApp();
    const previous = process.env.STARHOLD_E2E;
    process.env.STARHOLD_E2E = "1";
    const request = (method: string, path: string, body?: unknown) =>
      runWithScope({ kv: store, db, mode: "d1", method, cpuMs: 0 }, () =>
        app.request(path, body === undefined ? { method } : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    try {
      const join = await request("POST", "/api/join", { name: "Granted" });
      const joined = (await join.json()) as PlayerView;
      const grant = await request("POST", "/api/e2e/grant", {
        playerId: joined.player.id,
        resources: { metal: 800 },
      });
      assert.equal(grant.status, 200);
      const state = await request("GET", `/api/state?playerId=${encodeURIComponent(joined.player.id)}`);
      const view = (await state.json()) as PlayerView;
      assert.ok(view.planet.resources.metal >= 800, `grant lost: metal ${view.planet.resources.metal}`);
    } finally {
      if (previous == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = previous;
    }
  });

  it("writes the loot a raid takes from a victim planet that is otherwise untouched", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const bravo = Object.values(source.players).find((player) => player.name === "Other")!;
    const origin = source.planets[alpha.homePlanetId]!;
    const target = source.planets[bravo.homePlanetId]!;
    target.ships = { hauler: 0 };
    target.defenses = {} as PlanetState["defenses"];
    target.resources = { metal: 50_000, crystal: 50_000, deuterium: 50_000 };
    const now = Date.now();
    source.fleets["fleet-loot"] = {
      id: "fleet-loot",
      ownerPlayerId: alpha.id,
      originPlanetId: origin.id,
      targetPlanetId: target.id,
      targetPlayerId: bravo.id,
      targetCoords: target.coords,
      mission: "raid",
      ships: { hauler: 5 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now - 60_000,
      arrivesAt: now - 1_000,
      phase: "outbound",
      reportId: null,
    };
    await migrateAll(db, source);
    const store = createD1Store(db);
    let before = 0;
    let after = 0;
    let carried = 0;
    await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
      withUniverse((universe) => {
        const victim = universe.planets[target.id]!;
        before = victim.resources.metal + victim.resources.crystal + victim.resources.deuterium;
        advanceUniverse(universe, Date.now());
        const fleet = universe.fleets["fleet-loot"]!;
        carried = fleet.cargo.metal + fleet.cargo.crystal + fleet.cargo.deuterium;
        const looted = universe.planets[target.id]!;
        after = looted.resources.metal + looted.resources.crystal + looted.resources.deuterium;
      }, { playerIds: [alpha.id] }),
    );
    assert.ok(carried > 0, "raid carried no loot");
    assert.ok(after < before, "raid took nothing in memory");
    const stored = await loadWorkingSet(db, { playerIds: [bravo.id] });
    const res = stored.universe.planets[target.id]!.resources;
    const total = res.metal + res.crystal + res.deuterium;
    assert.ok(total <= after + 1, `victim kept loot: stored ${total}, after raid ${after}, carried ${carried}`);
  });

  it("writes a build cost deduction", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const home = source.planets[alpha.homePlanetId]!;
    home.resources = { metal: 100_000, crystal: 100_000, deuterium: 100_000 };
    home.buildQueue = [];
    await migrateAll(db, source);
    const store = createD1Store(db);
    let spent = 0;
    await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
      withUniverse((universe) => {
        const result = queueBuildingUpgrade(universe, alpha.id, "metalMine", Date.now(), home.id);
        assert.ok(result.ok, JSON.stringify(result));
        spent = universe.planets[home.id]!.resources.metal;
      }, { playerIds: [alpha.id] }),
    );
    assert.ok(spent < 100_000);
    const stored = await loadWorkingSet(db, { playerIds: [alpha.id] });
    assert.ok(stored.universe.planets[home.id]!.resources.metal <= spent + 1, "build cost not saved");
  });

  it("writes harvested debris delivered home when only the planet's resources change", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const home = source.planets[alpha.homePlanetId]!;
    home.resources = { metal: 1_000, crystal: 1_000, deuterium: 0 };
    const now = Date.now();
    source.fleets["fleet-harvest"] = {
      id: "fleet-harvest",
      ownerPlayerId: alpha.id,
      originPlanetId: home.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...home.coords, slot: 16 },
      mission: "harvest",
      ships: { recycler: 1 },
      cargo: { metal: 7_000, crystal: 3_000, deuterium: 0 },
      departedAt: now - 120_000,
      arrivesAt: now - 1_000,
      phase: "returning",
      reportId: null,
    } as unknown as FleetMission;
    await migrateAll(db, source);
    const store = createD1Store(db);
    await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
      withUniverse((universe) => {
        advanceUniverse(universe, Date.now());
        assert.equal(universe.fleets["fleet-harvest"], undefined);
        assert.ok(universe.planets[home.id]!.resources.metal >= 8_000);
      }, { playerIds: [alpha.id] }),
    );
    const stored = await loadWorkingSet(db, { playerIds: [alpha.id] });
    assert.ok(stored.universe.planets[home.id]!.resources.metal >= 8_000, "harvest delivery lost");
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

  it("spends no D1 queries rechecking a finished migration", async () => {
    const { db: inner } = sqliteD1();
    let n = 0;
    const db: D1Like = {
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
    let now = 1_700_000_000_000;
    setMigrationClockForTests(() => now);
    try {
      await migrateAll(db, fixture());
      n = 0;
      assert.equal(await migrationDone(db), true);
      assert.equal(n, 0);
      assert.equal(await migrationDone(db), true);
      assert.equal(n, 0);
      now += 60_000;
      assert.equal(await migrationDone(db), true);
      assert.equal(n, 1);
      n = 0;
      assert.equal(await migrationDone(db), true);
      assert.equal(n, 0);
    } finally {
      setMigrationClockForTests(null);
    }
  });

  it("returns 503 busy from upgrade and still reports a real 500", async () => {
    let reported = 0;
    setServerErrorReporter(() => {
      reported += 1;
    });
    setUniverseFaultForTests("busy");
    try {
      const app = createApp();
      app.get("/api/boom", () => {
        throw new Error("real failure");
      });
      const res = await app.request("/api/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "plyr_busy", buildingId: "metalMine" }),
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error?: string; code?: string };
      assert.equal(body.code, "busy");
      assert.match(body.error ?? "", /^Universe busy/);
      assert.equal(reported, 0);

      const boom = await app.request("/api/boom");
      assert.equal(boom.status, 500);
      assert.equal(reported, 1);
    } finally {
      setUniverseFaultForTests(null);
      setServerErrorReporter(null);
    }
  });

  it("a kill before commit writes nothing and the next action waits out the lock", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const home = source.planets[alpha.homePlanetId]!;
    const readPlayer = async () => {
      const row = await db
        .prepare("SELECT version, doc FROM save_players WHERE id = ?")
        .bind(alpha.id)
        .first<{ version: number; doc: string }>();
      return { version: row?.version ?? 0, doc: JSON.parse(row?.doc ?? "{}") as { name: string; starshards: number } };
    };
    const readMine = async () => {
      const row = await db
        .prepare("SELECT doc FROM save_planets WHERE id = ?")
        .bind(home.id)
        .first<{ doc: string }>();
      return (JSON.parse(row?.doc ?? "{}") as { buildings?: { metalMine?: number } }).buildings?.metalMine;
    };
    setSaveAbortForTests("before-commit");
    try {
      await assert.rejects(
        () =>
          runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
            withUniverse((universe) => {
              const player = universe.players[alpha.id]!;
              player.name = "Killed";
              player.starshards = 999;
              const planet = universe.planets[home.id]!;
              planet.buildings = { ...planet.buildings, metalMine: 9 };
            }, { playerIds: [alpha.id] }),
          ),
        (err: unknown) => err instanceof SaveKilledError,
      );
    } finally {
      setSaveAbortForTests(null);
    }
    const mid = await readPlayer();
    assert.equal(mid.doc.name, "OldHand");
    assert.equal(mid.doc.starshards, 42);
    assert.equal(await readMine(), 4);

    const started = Date.now();
    await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
      withUniverse((universe) => {
        const player = universe.players[alpha.id]!;
        player.name = "After";
        player.starshards = 49;
      }, { playerIds: [alpha.id] }),
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= ROW_LOCK_MS - 100, `returned before the lock TTL (${elapsed}ms)`);
    assert.ok(elapsed < ROW_LOCK_MS + 1_500, `blocked past the lock TTL (${elapsed}ms)`);
    const after = await readPlayer();
    assert.equal(after.doc.name, "After");
    assert.equal(after.doc.starshards, 49);
    assert.equal(await readMine(), 4);
    assert.equal(after.version, mid.version + 1);
  });

  it("a kill after commit keeps the whole save and does not apply it twice", async () => {
    const { db } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const home = source.planets[alpha.homePlanetId]!;
    const before = await db
      .prepare("SELECT version FROM save_players WHERE id = ?")
      .bind(alpha.id)
      .first<{ version: number }>();
    setSaveAbortForTests("after-commit");
    try {
      await assert.rejects(
        () =>
          runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
            withUniverse((universe) => {
              const player = universe.players[alpha.id]!;
              player.name = "Landed";
              player.starshards = 70;
              const planet = universe.planets[home.id]!;
              planet.buildings = { ...planet.buildings, metalMine: 8 };
            }, { playerIds: [alpha.id] }),
          ),
        (err: unknown) => err instanceof SaveKilledError,
      );
    } finally {
      setSaveAbortForTests(null);
    }
    const playerRow = await db
      .prepare("SELECT version, doc FROM save_players WHERE id = ?")
      .bind(alpha.id)
      .first<{ version: number; doc: string }>();
    const planetRow = await db
      .prepare("SELECT doc FROM save_planets WHERE id = ?")
      .bind(home.id)
      .first<{ doc: string }>();
    const player = JSON.parse(playerRow?.doc ?? "{}") as { name: string; starshards: number };
    const planet = JSON.parse(planetRow?.doc ?? "{}") as { buildings?: { metalMine?: number } };
    assert.equal(player.name, "Landed");
    assert.equal(player.starshards, 70);
    assert.equal(planet.buildings?.metalMine, 8);
    assert.equal(playerRow?.version, (before?.version ?? 0) + 1);

    const started = Date.now();
    await runWithScope({ kv: store, db, mode: "d1", method: "POST", cpuMs: 0 }, () =>
      withUniverse((universe) => {
        universe.players[alpha.id]!.starshards = 71;
      }, { playerIds: [alpha.id] }),
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= ROW_LOCK_MS - 100, `returned before the lock TTL (${elapsed}ms)`);
    assert.ok(elapsed < ROW_LOCK_MS + 1_500, `blocked past the lock TTL (${elapsed}ms)`);
    const next = JSON.parse(
      (await db.prepare("SELECT version, doc FROM save_players WHERE id = ?").bind(alpha.id).first<{ version: number; doc: string }>())?.doc ?? "{}",
    ) as { name: string; starshards: number };
    const nextVersion = await db
      .prepare("SELECT version FROM save_players WHERE id = ?")
      .bind(alpha.id)
      .first<{ version: number }>();
    assert.equal(next.name, "Landed");
    assert.equal(next.starshards, 71);
    assert.equal(nextVersion?.version, (before?.version ?? 0) + 2);
  });

  it("stays under the CPU budget on a shaped save and beats the legacy blob", async () => {
    const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    if (source.seedCursor) source.seedCursor.done = true;
    const now = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) joinUniverse(source, `Pilot${i}`, now + i);
    for (let n = 0; n < 100; n++) {
      const galaxy = 1 + Math.floor(n / 50);
      const system = (n % 50) + 1;
      const key = `${galaxy}:${system}:16`;
      source.debris[key] = { coords: { galaxy, system, slot: 16 }, metal: 1_000 + n, crystal: 400 };
      source.asteroids[key] = {
        id: key,
        coords: { galaxy, system, slot: 16 },
        metal: 800,
        crystal: 300,
        deuterium: 40,
        richness: 4,
      };
    }
    const { db } = sqliteD1();
    const stepDb = sqliteD1().db;
    const stepScope = { kv: null, db: stepDb, mode: "d1" as const, method: "POST", cpuMs: 0 };
    const steps: number[] = [];
    await runWithScope(stepScope, async () => {
      for (let i = 0; i < 10_000; i++) {
        const before = stepScope.cpuMs;
        const step = await migrateChunk(stepDb, source);
        steps.push(Number((stepScope.cpuMs - before).toFixed(3)));
        if (step.done) break;
      }
    });
    await migrateAll(db, source);
    const systems = await db.prepare("SELECT COUNT(*) AS n FROM save_systems").bind().first<{ n: number }>();
    const players = await db.prepare("SELECT COUNT(*) AS n FROM save_players").bind().first<{ n: number }>();
    assert.ok((systems?.n ?? 0) >= 100, `systems ${systems?.n}`);
    assert.ok((players?.n ?? 0) >= 20, `players ${players?.n}`);

    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((player) => player.name === "Pilot0")!;
    const bravo = Object.values(source.players).find((player) => player.name === "Pilot1")!;
    const home = source.planets[alpha.homePlanetId]!;
    const target = source.planets[bravo.homePlanetId]!;
    const scope = { kv: store, db, mode: "d1" as const, method: "POST", cpuMs: 0 };
    const blob = JSON.stringify(source);
    const rich = () => ({ metal: 9_000_000, crystal: 9_000_000, deuterium: 9_000_000 });
    const calls: Record<string, (universe: UniverseState) => void> = {
      refresh: (universe) => {
        playerView(universe, alpha.id, now);
      },
      galaxy: (universe) => {
        playerView(universe, alpha.id, now, 2, 10);
      },
      upgrade: (universe) => {
        const planet = universe.planets[home.id]!;
        planet.resources = rich();
        planet.buildQueue = [];
        const result = queueBuildingUpgrade(universe, alpha.id, "metalMine", now, home.id);
        if (!result.ok) throw new Error(result.error);
      },
      research: (universe) => {
        const planet = universe.planets[home.id]!;
        planet.resources = rich();
        planet.buildings = { ...planet.buildings, researchLab: 1 };
        planet.buildQueue = [];
        universe.players[alpha.id]!.researchQueue = null;
        const result = queueResearch(universe, alpha.id, "energyTech", now);
        if (!result.ok) throw new Error(result.error);
      },
      "build-ship": (universe) => {
        const planet = universe.planets[home.id]!;
        planet.resources = rich();
        planet.buildings = { ...planet.buildings, shipyard: 1 };
        planet.shipQueue = [];
        const result = queueShipBuild(universe, alpha.id, "scout", 1, now, home.id);
        if (!result.ok) throw new Error(result.error);
      },
      "send-fleet": (universe) => {
        const planet = universe.planets[home.id]!;
        planet.resources = rich();
        planet.ships = { ...planet.ships, scout: 5 };
        for (const [id, fleet] of Object.entries(universe.fleets)) {
          if (fleet.ownerPlayerId === alpha.id) delete universe.fleets[id];
        }
        const result = launchFleet(universe, alpha.id, target.id, "deploy", { scout: 1 }, now);
        if (!result.ok) throw new Error(result.error);
      },
      login: (universe) => {
        playerView(universe, alpha.id, now);
      },
      "job-30m": (universe) => {
        advanceUniverse(universe, now);
      },
    };
    const workFor = (name: string) => {
      if (name === "galaxy") return { playerIds: [alpha.id], galaxy: 2, system: 10 };
      if (name === "job-30m") return { maintenance: true as const };
      if (name === "refresh" || name === "login") return { playerIds: [alpha.id] };
      return { playerIds: [alpha.id] };
    };
    const sampleRow = async (name: string) => {
      scope.cpuMs = 0;
      await runWithScope(scope, async () => {
        if (name === "login") await hashPbkdf2("measure:secret");
        const run = (universe: UniverseState) => calls[name]!(universe);
        if (name === "refresh" || name === "galaxy" || name === "login") {
          await withUniverseRead(run, workFor(name));
        } else {
          await withUniverse(run, workFor(name));
        }
      });
      return scope.cpuMs;
    };
    const sampleLegacy = async (name: string) => {
      const started = performance.now();
      const copy = JSON.parse(blob) as UniverseState;
      calls[name]!(copy);
      let ms = performance.now() - started;
      if (name === "login") {
        const hashStarted = performance.now();
        await hashPbkdf2("measure:secret");
        ms += performance.now() - hashStarted;
      }
      return ms;
    };
    const names = Object.keys(calls);
    for (const name of names) {
      await sampleRow(name);
      await sampleLegacy(name);
    }
    const table: Record<string, { median: number; p95: number; legacy: number }> = {};
    for (const name of names) {
      const rows: number[] = [];
      const legacies: number[] = [];
      for (let i = 0; i < 9; i++) {
        rows.push(await sampleRow(name));
        legacies.push(await sampleLegacy(name));
      }
      const sorted = [...rows].sort((a, b) => a - b);
      const legacySorted = [...legacies].sort((a, b) => a - b);
      const pick = (values: number[], p: number) => values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)]!;
      table[name] = {
        median: Number(pick(sorted, 50).toFixed(2)),
        p95: Number(pick(sorted, 95).toFixed(2)),
        legacy: Number(pick(legacySorted, 50).toFixed(2)),
      };
    }
    const stepSorted = [...steps].sort((a, b) => a - b);
    const stepMedian = stepSorted[Math.ceil(0.5 * stepSorted.length) - 1] ?? 0;
    const stepP95 = stepSorted[Math.min(stepSorted.length - 1, Math.ceil(0.95 * stepSorted.length) - 1)] ?? 0;
    console.log(`cpu ms ${JSON.stringify({ ...table, migrationSteps: steps.length, stepMedian, stepP95 })}`);
    for (const [name, row] of Object.entries(table)) {
      const limit = name === "login" ? 35 : 10;
      assert.ok(row.median <= limit, `${name} median ${row.median}`);
      assert.ok(row.p95 <= 35, `${name} p95 ${row.p95}`);
      assert.ok(row.median < row.legacy, `${name} median ${row.median} is not under legacy ${row.legacy}`);
    }
    assert.ok(steps.length > 1);
    assert.ok(stepMedian <= 10, `migration median ${stepMedian}`);
    assert.ok(stepP95 <= 20, `migration p95 ${stepP95}`);
  });

  it("returns 404 from /api/state for an unknown player and does not report it", async () => {
    let reported = 0;
    setServerErrorReporter(() => {
      reported += 1;
    });
    try {
      const app = createApp();
      const missing = await app.request("/api/state?playerId=no-such-commander");
      assert.equal(missing.status, 404);
      const body = (await missing.json()) as { error?: string };
      assert.match(body.error ?? "", /Unknown player/);
      assert.equal(reported, 0);

      setUniverseFaultForTests("both");
      const busy = await app.request("/api/state?playerId=no-such-commander");
      assert.equal(busy.status, 503);
      const busyBody = (await busy.json()) as { code?: string };
      assert.equal(busyBody.code, "busy");
      assert.equal(reported, 0);
    } finally {
      setUniverseFaultForTests(null);
      setServerErrorReporter(null);
      resetMemoryUniverse();
    }
  });

  it("finishes migration while writes and galaxy seeding keep landing", async () => {
    resetMemoryUniverse();
    const { db } = sqliteD1();
    const now = 1_700_000_000_000;
    const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    const { player } = joinUniverse(source, "Seeder", now);
    const home = source.planets[player.homePlanetId]!;
    for (let i = 0; i < 40; i++) {
      const id = `extra-${i}`;
      source.planets[id] = {
        ...home,
        id,
        name: id,
        ownerPlayerId: "",
        coords: { galaxy: 2, system: i + 1, slot: 3 },
        moonId: null,
        parentPlanetId: null,
      };
    }
    const store = createD1Store(db);
    const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
    await store.set(key, source);
    await store.set(`${key}:ver`, "seed-0");
    let requests = 0;
    let done = false;
    const bound = 80;
    while (requests < bound && !done) {
      const n = requests;
      await runWithScope(
        { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            const who = universe.players[player.id];
            if (who && n % 3 === 0) {
              who.starshards = (who.starshards ?? 0) + 1;
              if (!universe.seedCursor || universe.seedCursor.done) {
                universe.seedCursor = { at: 0, ranks: [], pirates: 0 };
              }
              continueUniverseSeed(universe, now + n * 1_000, {
                systems: 1,
                minis: 2,
                pirates: 0,
              });
              universe.asteroids[`proof-${n}`] = {
                id: `proof-${n}`,
                coords: { galaxy: 1, system: 40 + (n % 20), slot: 16 },
                metal: 70 + n,
                crystal: 1,
                deuterium: 1,
                richness: 1,
              };
            }
          }),
      );
      requests += 1;
      done = await migrationDone(db);
    }
    console.log(`migration under writes requests=${requests} done=${done}`);
    assert.equal(done, true);
    assert.ok(requests < bound, `migration still running after ${requests}`);
    const loaded = await loadWorkingSet(db, { full: true });
    const who = loaded.universe.players[player.id];
    const writes = Math.floor((requests - 1) / 3) + 1;
    assert.equal(who?.starshards, writes);
    const proof = loaded.universe.asteroids?.["proof-0"];
    assert.equal(proof?.metal, 70, `proof asteroid missing after ${requests} requests`);
    assert.ok(Object.keys(loaded.universe.asteroids ?? {}).length > 0);
    resetMemoryUniverse();
  });

  it("restores destroyed pirates on a page load and keeps a base with no site", async () => {
    resetMemoryUniverse();
    const { db } = sqliteD1();
    const source = fixture();
    source.miniPlanetIds = ["already-seeded"];
    const alpha = Object.values(source.players).find((player) => player.name === "OldHand")!;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    source.pirateBases = {};
    const destroyedIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const base = createPirateBase(source.seed ?? source.id, 1, i + 1, 8, now - 40 * day, 0);
      base.destroyedAt = now - 40 * day;
      source.pirateBases[base.id] = base;
      destroyedIds.push(base.id);
    }
    const blocked = { galaxy: 3, system: 12, slot: 4 };
    const home = source.planets[alpha.homePlanetId]!;
    source.planets["hidden-rock"] = {
      ...home,
      id: "hidden-rock",
      name: "Hidden",
      ownerPlayerId: "",
      kind: "planet",
      coords: blocked,
      moonId: null,
      parentPlanetId: null,
    };
    await migrateAll(db, source);
    const store = createD1Store(db);
    await runWithScope(
      { kv: store, db, mode: "d1", method: "GET", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          advanceUniverse(universe, now);
        }, { playerIds: [alpha.id] }),
    );
    const afterPage = await loadWorkingSet(db, { full: true });
    const living = activePirateBases(afterPage.universe);
    console.log(`pirate page-load living=${living.length} destroyedLeft=${Object.values(afterPage.universe.pirateBases ?? {}).filter((b) => b.destroyedAt != null).length}`);
    assert.ok(living.length >= PIRATE_TARGET_BASE_COUNT, `living ${living.length}`);
    for (const id of destroyedIds) assert.equal(afterPage.universe.pirateBases?.[id], undefined);
    assert.equal(
      living.some((base) => base.coords.galaxy === blocked.galaxy && base.coords.system === blocked.system && base.coords.slot === blocked.slot),
      false,
    );

    const packed = fixture();
    packed.miniPlanetIds = ["already-seeded"];
    const blockedGalaxy = MAP_GALAXIES;
    const blockedSystem = MAP_SYSTEMS;
    const bases: Record<string, PirateBase> = {};
    for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
      for (let system = 1; system <= MAP_SYSTEMS; system++) {
        if (galaxy === blockedGalaxy && system === blockedSystem) continue;
        const id = `blocker-${galaxy}-${system}`;
        bases[id] = {
          id,
          coords: { galaxy, system, slot: 1 },
          destroyedAt: null,
          name: id,
          tier: 0,
          level: 0,
          ships: {},
          defenses: {},
          resources: { metal: 0, crystal: 0, deuterium: 0 },
          techs: {},
          lastGrewAt: now,
          lastRaidAt: now,
          nextRaidAt: now + day,
          lastFreeSpawnAt: now,
          coalitionId: id,
          splitDone: false,
        } as PirateBase;
      }
    }
    const wreck = createPirateBase(packed.seed ?? packed.id, 1, 1, 2, now - 40 * day, 0);
    wreck.destroyedAt = now - 40 * day;
    bases[wreck.id] = wreck;
    packed.pirateBases = bases;
    for (let slot = 1; slot <= MAP_SLOTS; slot++) {
      const id = `wall-${slot}`;
      packed.planets[id] = {
        ...packed.planets[alpha.homePlanetId]!,
        id,
        name: id,
        ownerPlayerId: "",
        kind: "planet",
        coords: { galaxy: blockedGalaxy, system: blockedSystem, slot },
        moonId: null,
        parentPlanetId: null,
      };
    }
    const packedDb = sqliteD1();
    await migrateAll(packedDb.db, packed);
    const packedStore = createD1Store(packedDb.db);
    const before = Object.keys(packed.pirateBases).length;
    await runWithScope(
      { kv: packedStore, db: packedDb.db, mode: "d1", method: "GET", cpuMs: 0 },
      () =>
        withUniverse((universe) => {
          tickPirates(universe, now);
        }, { playerIds: [Object.values(packed.players).find((player) => player.name === "OldHand")!.id] }),
    );
    const kept = await loadWorkingSet(packedDb.db, { full: true });
    assert.equal(kept.universe.pirateBases?.[wreck.id]?.destroyedAt != null, true);
    assert.equal(Object.keys(kept.universe.pirateBases ?? {}).length, before);
    const parked = Object.values(kept.universe.pirateBases ?? {}).find(
      (base) => base.coords.galaxy === blockedGalaxy && base.coords.system === blockedSystem,
    );
    assert.equal(parked, undefined);
    resetMemoryUniverse();
  });

  it("fails a request that would exceed 50 D1 queries", async () => {
    const { db: inner } = sqliteD1();
    const db = subrequestD1(inner, 50);
    await assert.rejects(async () => {
      for (let i = 0; i < 51; i++) {
        await db.prepare("SELECT 1 AS n").bind().first();
      }
    }, /D1 query limit/);
    assert.ok(db.count() > 50);
  });

  it("keeps every migration request under 50 queries and loses no sealed write", async () => {
    resetMemoryUniverse();
    const { db: inner, raw } = sqliteD1();
    const db = subrequestD1(inner, 50);
    const now = 1_700_000_000_000;
    const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    if (source.seedCursor) source.seedCursor.done = true;
    source.miniPlanetIds = ["already-seeded"];
    for (let i = 0; i < 20; i++) joinUniverse(source, `Pilot${i}`, now + i);
    for (let n = 0; n < 100; n++) {
      const galaxy = 1 + Math.floor(n / 50);
      const system = (n % 50) + 1;
      const key = `${galaxy}:${system}:16`;
      source.asteroids[key] = {
        id: key,
        coords: { galaxy, system, slot: 16 },
        metal: 800,
        crystal: 300,
        deuterium: 40,
        richness: 4,
      };
    }
    const store = createD1Store(db);
    const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
    await store.set(key, source);
    await store.set(`${key}:ver`, "seed-0");
    db.reset();
    const who = Object.values(source.players).find((player) => player.name === "Pilot0")!;
    const counts: number[] = [];
    const sealCounts: number[] = [];
    let requests = 0;
    let done = false;
    const bound = 80;
    const sealOn = () => {
      try {
        const row = raw.prepare("SELECT value FROM save_meta WHERE id = 'migration'").get() as
          | { value: string }
          | undefined;
        if (!row) return false;
        return Boolean(JSON.parse(row.value).seal);
      } catch {
        return false;
      }
    };
    while (requests < bound && !done) {
      const n = requests;
      const sealedBefore = sealOn();
      db.reset();
      await runWithScope(
        { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
        () =>
          withUniverse((universe) => {
            const player = universe.players[who.id];
            if (player && n % 2 === 0) {
              player.starshards = (player.starshards ?? 0) + 1;
              universe.asteroids[`proof-${n}`] = {
                id: `proof-${n}`,
                coords: { galaxy: 3, system: 1 + (n % 20), slot: 15 },
                metal: 70 + n,
                crystal: 1,
                deuterium: 1,
                richness: 1,
              };
            }
          }),
      );
      const queries = db.count();
      counts.push(queries);
      if (sealedBefore || sealOn()) sealCounts.push(queries);
      requests += 1;
      done = await migrationDone(inner);
    }
    const max = counts.reduce((best, value) => Math.max(best, value), 0);
    const sealMax = sealCounts.reduce((best, value) => Math.max(best, value), 0);
    const table = {
      requests,
      max,
      sealRequests: sealCounts.length,
      sealMax,
      over50: counts.filter((value) => value > 50).length,
    };
    console.log(`migration query counts ${JSON.stringify(table)}`);
    assert.equal(done, true, `still migrating after ${requests}`);
    assert.equal(table.over50, 0);
    assert.ok(sealCounts.length > 0, "seal pass never ran");
    assert.ok(sealMax <= 30, `seal pass ${sealMax}`);
    assert.ok(max <= 50, `migration request ${max}`);
    const loaded = await loadWorkingSet(inner, { full: true });
    const writes = Math.floor((requests - 1) / 2) + 1;
    assert.equal(loaded.universe.players[who.id]?.starshards, writes);
    assert.equal(loaded.universe.asteroids?.["proof-0"]?.metal, 70);
    resetMemoryUniverse();
  });

  it("rolls a 100-player universe back under 50 queries per request", async () => {
    const previous = process.env.STARHOLD_ROW_SAVE;
    const { db: inner } = sqliteD1();
    const db = subrequestD1(inner, 50);
    const now = 1_700_000_000_000;
    const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    if (source.seedCursor) source.seedCursor.done = true;
    source.miniPlanetIds = ["already-seeded"];
    for (let i = 0; i < 110; i++) joinUniverse(source, `Pilot${i}`, now + i);
    const alpha = Object.values(source.players).find((player) => player.name === "Pilot0")!;
    const last = Object.values(source.players).find((player) => player.name === "Pilot109")!;
    alpha.starshards = 4242;
    last.starshards = 109109;
    await migrateAll(inner, source);
    const counts: number[] = [];
    try {
      const store = createD1Store(db);
      let done = false;
      let pages = 0;
      let players = 0;
      while (!done && pages < 20) {
        db.reset();
        const page = await rollbackRowsToLegacy(db, store);
        const queries = db.count();
        counts.push(queries);
        assert.ok(queries <= 50, `rollback page ${pages} used ${queries}`);
        players = page.players;
        done = page.done;
        pages += 1;
      }
      const max = counts.reduce((best, value) => Math.max(best, value), 0);
      console.log(`rollback query counts ${JSON.stringify({ pages, max, players, counts })}`);
      assert.equal(done, true);
      assert.ok(players >= 110, `players ${players}`);
      assert.ok(max <= 50, `rollback ${max}`);
      process.env.STARHOLD_ROW_SAVE = "legacy";
      resetMemoryUniverse();
      const legacy = createD1Store(inner);
      await runWithScope(
        { kv: legacy, db: inner, mode: "d1", method: "GET", cpuMs: 0 },
        () =>
          withUniverseRead((universe) => {
            assert.ok(Object.keys(universe.players).length >= 110);
            assert.equal(universe.players[alpha.id]?.starshards, 4242);
            assert.equal(universe.players[last.id]?.starshards, 109109);
            assert.equal(universe.players[alpha.id]?.name, "Pilot0");
            assert.ok(universe.planets[alpha.homePlanetId]);
            assert.ok(universe.planets[last.homePlanetId]);
          }),
      );
    } finally {
      if (previous == null) delete process.env.STARHOLD_ROW_SAVE;
      else process.env.STARHOLD_ROW_SAVE = previous;
      resetMemoryUniverse();
    }
  });

  it("recopies current rows on rollback after done or restart (B2-B9)", async () => {
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((p) => p.name === "OldHand")!;

    // Initial rollback to done
    let page = await rollbackRowsToLegacy(db, store);
    while (!page.done) {
      page = await rollbackRowsToLegacy(db, store);
    }
    assert.equal(page.done, true);

    const baseKey = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}:player:${alpha.id}`;
    let slice = await store.get<{ player: { starshards: number } }>(baseKey, { fresh: true });
    assert.equal(slice?.player.starshards, 42);

    // Modify row store directly
    const row1 = raw.prepare("SELECT doc FROM save_players WHERE id = ?").get(alpha.id) as { doc: string };
    const doc1 = JSON.parse(row1.doc);
    doc1.starshards = 9999;
    raw.prepare("UPDATE save_players SET doc = ? WHERE id = ?").run(JSON.stringify(doc1), alpha.id);

    // Rollback again without restart parameter: since cursor stage was "done", it starts fresh from world page
    page = await rollbackRowsToLegacy(db, store);
    while (!page.done) {
      page = await rollbackRowsToLegacy(db, store);
    }
    slice = await store.get<{ player: { starshards: number } }>(baseKey, { fresh: true });
    assert.equal(slice?.player.starshards, 9999);

    // Modify row store again
    const row2 = raw.prepare("SELECT doc FROM save_players WHERE id = ?").get(alpha.id) as { doc: string };
    const doc2 = JSON.parse(row2.doc);
    doc2.starshards = 8888;
    raw.prepare("UPDATE save_players SET doc = ? WHERE id = ?").run(JSON.stringify(doc2), alpha.id);

    // Rollback with explicit ?restart=1
    page = await rollbackRowsToLegacy(db, store, { restart: true });
    while (!page.done) {
      page = await rollbackRowsToLegacy(db, store);
    }
    slice = await store.get<{ player: { starshards: number } }>(baseKey, { fresh: true });
    assert.equal(slice?.player.starshards, 8888);
  });

  it("restarts a partial cursor older than ROLLBACK_STALE_MS instead of resuming (B2-B9)", async () => {
    const { db, raw } = sqliteD1();
    const source = fixture();
    await migrateAll(db, source);
    const store = createD1Store(db);
    const alpha = Object.values(source.players).find((p) => p.name === "OldHand")!;

    // Start a run, perform page 1 (world + first chunk)
    const page1 = await rollbackRowsToLegacy(db, store);
    assert.equal(page1.done, true); // fixture has only 2 players, fits in 1 page. Let's verify with 110 players to test multi-page.

    // Multi-player setup for partial cursor test
    const bigSource = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    for (let i = 0; i < 70; i++) joinUniverse(bigSource, `Commander${i}`, 1_700_000_000_000 + i);
    const { db: bigDb, raw: bigRaw } = sqliteD1();
    await migrateAll(bigDb, bigSource);
    const bigStore = createD1Store(bigDb);

    const firstCommander = Object.values(bigSource.players).find((p) => p.name === "Commander0")!;

    // Run page 1
    const p1 = await rollbackRowsToLegacy(bigDb, bigStore);
    assert.equal(p1.done, false);

    // Change row store values
    const bigRow = bigRaw.prepare("SELECT doc FROM save_players WHERE id = ?").get(firstCommander.id) as { doc: string };
    const bigDoc = JSON.parse(bigRow.doc);
    bigDoc.starshards = 7777;
    bigRaw.prepare("UPDATE save_players SET doc = ? WHERE id = ?").run(JSON.stringify(bigDoc), firstCommander.id);

    // Make cursor stale by setting updatedAt 10 minutes in the past
    const staleTime = Date.now() - 10 * 60 * 1000;
    const metaRow = bigRaw.prepare("SELECT value FROM save_meta WHERE id = 'rollback'").get() as { value: string };
    const savedCursor = JSON.parse(metaRow.value);
    savedCursor.updatedAt = staleTime;
    bigRaw.prepare("UPDATE save_meta SET value = ? WHERE id = 'rollback'").run(JSON.stringify(savedCursor));

    // Next call should detect stale cursor and restart from page 1, picking up the updated value for Commander0
    let res = await rollbackRowsToLegacy(bigDb, bigStore);
    while (!res.done) {
      res = await rollbackRowsToLegacy(bigDb, bigStore);
    }

    const c0Key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}:player:${firstCommander.id}`;
    const c0Slice = await bigStore.get<{ player: { starshards: number } }>(c0Key, { fresh: true });
    assert.equal(c0Slice?.player.starshards, 7777);
  });

  it("loads only page players on rollback and reports CPU & query counts at 115 players (B2-N1)", async () => {
    const { db: inner } = sqliteD1();
    const db = subrequestD1(inner, 50);
    const now = 1_700_000_000_000;
    const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
    if (source.seedCursor) source.seedCursor.done = true;
    for (let i = 0; i < 115; i++) joinUniverse(source, `FleetCmd${i}`, now + i);
    await migrateAll(inner, source);

    const store = createD1Store(db);
    const queryCounts: number[] = [];
    const cpuTimes: number[] = [];

    let done = false;
    let pageCount = 0;
    let totalPlayers = 0;

    while (!done) {
      db.reset();
      const started = performance.now();
      const result = await rollbackRowsToLegacy(db, store);
      const elapsed = performance.now() - started;
      const queries = db.count();

      queryCounts.push(queries);
      cpuTimes.push(elapsed);
      assert.ok(queries <= 50, `rollback page ${pageCount} used ${queries} queries (must be <= 50)`);

      totalPlayers = result.players;
      done = result.done;
      pageCount++;
    }

    const maxQueries = Math.max(...queryCounts);
    const totalCpuMs = cpuTimes.reduce((a, b) => a + b, 0);

    console.log(
      `rollback B2-N1 115 players report: pages=${pageCount}, totalPlayers=${totalPlayers}, maxQueriesPerPage=${maxQueries}, totalCpuMs=${totalCpuMs.toFixed(
        2,
      )}, queryCountsPerStep=${JSON.stringify(queryCounts)}`,
    );

    assert.equal(done, true);
    assert.ok(totalPlayers >= 115);
    assert.ok(maxQueries <= 50);
  });
});

