import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  activePirateBases,
  createPirateBase,
  createUniverse,
  joinUniverse,
  PIRATE_TARGET_BASE_COUNT,
  tickPirates,
  UNIVERSE_SCHEMA_VERSION,
  type UniverseState,
} from "@starhold/game";
import { continueUniverseSeed } from "../../../packages/game/src/world-seed.ts";
import { installDeterministicInputs } from "../../../packages/game/src/test-determinism.ts";
import { createD1Store, type D1Like } from "./d1-store.js";
import { runWithScope } from "./request-context.js";
import { loadWorkingSet, migrateAll, migrationDone } from "./row-store.js";
import { resetMemoryUniverse, withUniverse } from "./store.js";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../package.json"));
const { getPlatformProxy } = require("wrangler") as {
  getPlatformProxy: (opts: {
    persist: boolean;
    remoteBindings: boolean;
    configPath: string;
  }) => Promise<{ env: { DB: D1Like }; dispose: () => Promise<void> }>;
};

const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../wrangler.toml");

async function openD1(): Promise<{ db: D1Like; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy({
    persist: false,
    remoteBindings: false,
    configPath,
  });
  const db = proxy.env.DB;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )`,
    )
    .bind()
    .run();
  return { db, dispose: () => proxy.dispose() };
}

describe("real local D1", () => {
  it("saves 1, 5, 6, 20, and 50 changed rows", async () => {
    const { db, dispose } = await openD1();
    try {
      resetMemoryUniverse();
      const now = 1_700_000_000_000;
      const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
      if (source.seedCursor) source.seedCursor.done = true;
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) ids.push(joinUniverse(source, `Pilot${i}`, now + i).player.id);
      await migrateAll(db, source);
      const store = createD1Store(db);
      for (const count of [1, 5, 6, 20, 50]) {
        const changed = ids.slice(0, count);
        const mark = 1_000 + count;
        await runWithScope(
          { kv: store, db, mode: "d1", method: "POST", cpuMs: 0 },
          () =>
            withUniverse((universe) => {
              for (const id of changed) universe.players[id]!.starshards = mark;
            }, { playerIds: changed }),
        );
        for (const id of changed) {
          const row = await db
            .prepare("SELECT doc FROM save_players WHERE id = ?")
            .bind(id)
            .first<{ doc: string }>();
          const doc = JSON.parse(row?.doc ?? "{}") as { starshards?: number };
          assert.equal(doc.starshards, mark, `${count} rows, ${id}`);
        }
        console.log(`d1 save ok rows=${count}`);
      }
    } finally {
      resetMemoryUniverse();
      await dispose();
    }
  });

  it("finishes migration while writes and seeding keep landing", async () => {
    const { db, dispose } = await openD1();
    try {
      resetMemoryUniverse();
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
            withUniverse((universe: UniverseState) => {
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
      console.log(`d1 migration under writes requests=${requests} done=${done}`);
      assert.equal(done, true);
      assert.ok(requests < bound);
      const loaded = await loadWorkingSet(db, { full: true });
      const writes = Math.floor((requests - 1) / 3) + 1;
      assert.equal(loaded.universe.players[player.id]?.starshards, writes);
      assert.equal(loaded.universe.asteroids?.["proof-0"]?.metal, 70);
    } finally {
      resetMemoryUniverse();
      await dispose();
    }
  });

  it("respawns destroyed pirates through a page load", async () => {
    const { db, dispose } = await openD1();
    let restoreInputs: (() => void) | undefined;
    try {
      restoreInputs = installDeterministicInputs(0x50495241, 1_700_000_000_000);
      resetMemoryUniverse();
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const source = createUniverse("Alpha Drift", 8, 8, { lazySeed: true });
      if (source.seedCursor) source.seedCursor.done = true;
      source.miniPlanetIds = ["already-seeded"];
      const { player } = joinUniverse(source, "OldHand", now);
      source.pirateBases = {};
      const destroyedIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const base = createPirateBase(source.seed ?? source.id, 1, i + 1, 8, now - 40 * day, 0);
        base.destroyedAt = now - 40 * day;
        source.pirateBases[base.id] = base;
        destroyedIds.push(base.id);
      }
      const home = source.planets[player.homePlanetId]!;
      const blocked = { galaxy: 3, system: 12, slot: 4 };
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
            tickPirates(universe, now);
          }, { playerIds: [player.id] }),
      );
      const loaded = await loadWorkingSet(db, { full: true });
      const living = activePirateBases(loaded.universe);
      console.log(`d1 pirate page-load living=${living.length}`);
      assert.ok(living.length >= PIRATE_TARGET_BASE_COUNT, `living ${living.length}`);
      for (const id of destroyedIds) {
        const base = loaded.universe.pirateBases?.[id];
        assert.ok(
          base === undefined || (base.destroyedAt === null && (base.lastFreeSpawnAt ?? 0) >= now),
          `destroyed pirate ${id} was not removed or freshly respawned`,
        );
      }
      assert.equal(
        living.some((base) => base.coords.galaxy === blocked.galaxy && base.coords.system === blocked.system && base.coords.slot === blocked.slot),
        false,
      );
    } finally {
      restoreInputs?.();
      resetMemoryUniverse();
      await dispose();
    }
  });
});
