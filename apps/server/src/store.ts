import { Redis } from "@upstash/redis";
import {
  archiveUniverseKey,
  bindHighscoreSource,
  createUniverse,
  ensureUniverseShape,
  migrateOrResetUniverse,
  UNIVERSE_SCHEMA_VERSION,
  type UniverseState,
} from "@starhold/game";
import type { KvGetOptions, KvSetOptions, KvStore, StorageMode } from "./kv.js";
import { addCpu, currentMethod, currentScope } from "./request-context.js";
import {
  migrateChunk,
  migrationDone,
  rewindMigration,
  withRowUniverse,
  type UniverseWork,
} from "./row-store.js";
import {
  assembleUniverse,
  emptyStamps,
  sliceStamps,
  splitUniverse,
  stampsEqual,
  type PlayerSlice,
  type SliceStamps,
} from "./universe-docs.js";

export type { UniverseWork };

bindHighscoreSource(() => {
  const scope = currentScope();
  if (!scope?.rowSave) return undefined;
  if (scope.highscores === undefined) return undefined;
  return scope.highscores;
});

/**
 * Universe persistence.
 * - Local / CI: in-memory (process lifetime).
 * - Vercel: Upstash Redis / Vercel KV REST.
 * - Workers: D1 injected per request (see worker/index.ts). Not Workers KV.
 *
 * Schema: one JSON document at STARHOLD_UNIVERSE_KEY
 * (default `starhold:universe:v3` for Round 2).
 * Lock key: `${key}:lock` (NX + short TTL) for critical sections.
 * Version key: `${key}:ver` lets a warm isolate skip JSON.parse.
 *
 * Schema 2→3 migrates additively (levels/queues backfill). Older / missing
 * schema archives the blob and writes a fresh universe — never remap
 * 1×9×8 coords in place.
 */

export type { StorageMode } from "./kv.js";

interface UniverseCache {
  key: string;
  version: string;
  universe: UniverseState;
  slices: SliceStamps;
  /** True when this copy was loaded from the single legacy JSON document. */
  legacyBlob: boolean;
}

let memoryUniverse: UniverseState | null = null;
let universeCache: UniverseCache | null = null;
let redis: Redis | null | undefined;
let redisKvStore: KvStore | null = null;
let resolvedMode: StorageMode | undefined;

/** Distributed lock TTL. Short enough that a stuck request stops blocking logins. */
export const UNIVERSE_LOCK_MS = 2_500;

export class StaleUniverseError extends Error {
  constructor() {
    super("Universe changed — retrying.");
    this.name = "StaleUniverseError";
  }
}

type UniverseFault = "busy" | "read" | "both" | null;
let universeFault: UniverseFault = null;

/** Test hook. Production never sets this. */
export function setUniverseFaultForTests(next: UniverseFault): void {
  universeFault = next;
}

export function isUniverseBusy(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Universe busy");
}

function universeName(): string {
  return process.env.STARHOLD_UNIVERSE_NAME ?? "Alpha Drift";
}

function universeSpeed(): number {
  return Number(process.env.STARHOLD_UNIVERSE_SPEED ?? 8);
}

function universeKey(): string {
  return (
    process.env.STARHOLD_UNIVERSE_KEY ??
    `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`
  );
}

function versionKey(): string {
  return `${universeKey()}:ver`;
}

function lockKey(): string {
  return `${universeKey()}:lock`;
}

function workersRuntime(): boolean {
  return process.env.STARHOLD_RUNTIME === "workers";
}

/** Pure env resolver — prefer UPSTASH_*, else Vercel integration KV_*. */
export function redisCredentials(
  env: NodeJS.ProcessEnv = process.env,
): {
  url: string;
  token: string;
  mode: "upstash" | "kv";
} | null {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken, mode: "upstash" };
  }

  const kvUrl = env.KV_REST_API_URL?.trim();
  const kvToken = env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken, mode: "kv" };
  }

  return null;
}

function redisAsKv(client: Redis): KvStore {
  return {
    async get<T>(key: string, _opts?: KvGetOptions): Promise<T | null> {
      const data = await client.get<T>(key);
      return data ?? null;
    },
    async set(
      key: string,
      value: unknown,
      opts?: KvSetOptions,
    ): Promise<"OK" | null> {
      let result: unknown;
      if (opts?.nx && opts.px != null) {
        result = await client.set(key, value, { nx: true, px: opts.px });
      } else if (opts?.nx && opts.exSec != null) {
        result = await client.set(key, value, { nx: true, ex: opts.exSec });
      } else if (opts?.nx) {
        result = await client.set(key, value, { nx: true });
      } else if (opts?.px != null) {
        result = await client.set(key, value, { px: opts.px });
      } else if (opts?.exSec != null) {
        result = await client.set(key, value, { ex: opts.exSec });
      } else {
        result = await client.set(key, value);
      }
      return result === "OK" ? "OK" : null;
    },
    async del(key: string): Promise<void> {
      await client.del(key);
    },
  };
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const creds = redisCredentials(process.env);
  if (!creds) {
    redis = null;
    redisKvStore = null;
    resolvedMode = "memory";
    return null;
  }
  resolvedMode = creds.mode;
  redis = new Redis({ url: creds.url, token: creds.token });
  redisKvStore = redisAsKv(redis);
  return redis;
}

/** Shared client for accounts + universe. Null means the in-memory tables. */
export function getKvClient(): KvStore | null {
  const scope = currentScope();
  if (scope) return scope.kv;
  getRedis();
  return redisKvStore;
}

export function storageMode(): StorageMode {
  const scope = currentScope();
  if (scope?.mode) return scope.mode;
  if (resolvedMode) return resolvedMode;
  const creds = redisCredentials(process.env);
  return creds?.mode ?? "memory";
}

function freshUniverse(): UniverseState {
  return createUniverse(
    universeName(),
    universeSpeed(),
    undefined,
    workersRuntime() ? { lazySeed: true } : undefined,
  );
}

function remember(
  universe: UniverseState,
  version: string,
  slices: SliceStamps,
  legacyBlob: boolean,
): void {
  universeCache = {
    key: universeKey(),
    version,
    universe,
    slices,
    legacyBlob,
  };
}

function quietRead(): boolean {
  const method = currentMethod();
  return method === "GET" || method === "HEAD";
}

async function loadUniverse(client: KvStore | null): Promise<UniverseState> {
  if (!client) {
    if (!memoryUniverse) memoryUniverse = freshUniverse();
    ensureUniverseShape(memoryUniverse);
    return memoryUniverse;
  }

  const key = universeKey();
  const version = await client.get<string>(versionKey());
  if (
    version &&
    universeCache &&
    universeCache.key === key &&
    universeCache.version === version
  ) {
    ensureUniverseShape(universeCache.universe);
    return universeCache.universe;
  }

  if (client.list && storageMode() === "d1") {
    const fromRows = await loadD1Rows(client, key, version);
    if (fromRows) return fromRows;
  }

  let data = await client.get<UniverseState>(key);
  if (!data || typeof data !== "object" || !data.id) {
    const legacy = await client.get<UniverseState>("starhold:universe:v1");
    if (legacy && typeof legacy === "object" && legacy.id) {
      data = legacy;
    }
  }

  if (data && typeof data === "object" && data.id) {
    const migrated = migrateOrResetUniverse(data, {
      name: universeName(),
      speed: universeSpeed(),
    });
    if (migrated.didReset && migrated.archived) {
      const archiveKey = archiveUniverseKey(migrated.archived.id, Date.now());
      await client.set(archiveKey, migrated.archived);
      await client.set(key, migrated.universe);
      await client.del("starhold:universe:v1").catch(() => undefined);
      const next = String(Date.now());
      await client.set(versionKey(), next);
      remember(migrated.universe, next, sliceStamps(migrated.universe), true);
      return migrated.universe;
    }
    ensureUniverseShape(migrated.universe);
    const next = version ?? String(Date.now());
    if (!version) await client.set(versionKey(), next);
    remember(migrated.universe, next, sliceStamps(migrated.universe), true);
    return migrated.universe;
  }

  const created = freshUniverse();
  ensureUniverseShape(created);
  await client.set(key, created);
  const next = String(Date.now());
  await client.set(versionKey(), next);
  remember(created, next, sliceStamps(created), true);
  return created;
}

async function loadD1Rows(
  client: KvStore,
  key: string,
  version: string | null,
): Promise<UniverseState | null> {
  if (!client.list) return null;
  const rows = await client.list(`${key}:`);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const world = byKey.get(`${key}:world`);
  if (!world || typeof world !== "object" || !("id" in world)) return null;
  const slices: PlayerSlice[] = [];
  for (const [rowKey, value] of byKey) {
    if (!rowKey.startsWith(`${key}:player:`)) continue;
    if (value && typeof value === "object" && "player" in value) {
      slices.push(value as PlayerSlice);
    }
  }
  const universe = assembleUniverse(
    world as UniverseState,
    byKey.get(`${key}:asteroids`) as UniverseState["asteroids"],
    byKey.get(`${key}:pirates`) as UniverseState["pirateBases"],
    byKey.get(`${key}:aliens`) as UniverseState["alienBases"],
    slices,
  );
  const migrated = migrateOrResetUniverse(universe, {
    name: universeName(),
    speed: universeSpeed(),
  });
  ensureUniverseShape(migrated.universe);
  const next = version ?? String(Date.now());
  if (!version) await client.set(versionKey(), next);
  remember(migrated.universe, next, sliceStamps(migrated.universe), false);
  return migrated.universe;
}

async function writeChangedSlices(
  client: KvStore,
  state: UniverseState,
  before: SliceStamps,
  after: SliceStamps,
  legacyBlob: boolean,
): Promise<void> {
  const parts = splitUniverse(state);
  const base = universeKey();
  const writeAll = legacyBlob;
  if (writeAll || before.world !== after.world) {
    await client.set(`${base}:world`, parts.world);
  }
  if (writeAll || before.asteroids !== after.asteroids) {
    await client.set(`${base}:asteroids`, parts.asteroids);
  }
  if (writeAll || before.pirates !== after.pirates) {
    await client.set(`${base}:pirates`, parts.pirates);
  }
  if (writeAll || before.aliens !== after.aliens) {
    await client.set(`${base}:aliens`, parts.aliens);
  }
  const ids = new Set([
    ...Object.keys(before.players),
    ...Object.keys(after.players),
  ]);
  for (const id of ids) {
    const next = after.players[id];
    const prev = before.players[id];
    if (!next) {
      if (prev) await client.del(`${base}:player:${id}`);
      continue;
    }
    if (writeAll || prev !== next) {
      await client.set(`${base}:player:${id}`, parts.players[id]);
    }
  }
  if (writeAll) await client.del(base);
}

async function saveUniverse(
  client: KvStore,
  state: UniverseState,
  before: SliceStamps,
  expectedVersion: string | null,
  versionChecked = false,
): Promise<void> {
  // The quiet-read path already compared the version under the lock.
  if (!versionChecked) {
    const current = await client.get<string>(versionKey(), { fresh: true });
    if (current !== expectedVersion) {
      universeCache = null;
      throw new StaleUniverseError();
    }
  }
  const after = sliceStamps(state);
  if (stampsEqual(before, after)) {
    if (universeCache?.universe === state) universeCache.slices = after;
    return;
  }
  if (storageMode() === "d1") {
    await writeChangedSlices(
      client,
      state,
      before,
      after,
      universeCache?.legacyBlob === true,
    );
    const version = String(Date.now());
    await client.set(versionKey(), version);
    remember(state, version, after, false);
    return;
  }
  await client.set(universeKey(), state);
  const version = String(Date.now());
  await client.set(versionKey(), version);
  remember(state, version, after, true);
}

async function acquireLock(client: KvStore): Promise<boolean> {
  const result = await client.set(lockKey(), String(Date.now()), {
    nx: true,
    px: UNIVERSE_LOCK_MS,
  });
  return result === "OK";
}

async function releaseLock(client: KvStore): Promise<void> {
  await client.del(lockKey());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runUniverse<T>(
  universe: UniverseState,
  fn: (universe: UniverseState) => T | Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await fn(universe);
  } finally {
    addCpu(performance.now() - started);
  }
}

/** Serializes requests in this isolate so two polls cannot tick the same object. */
let localTail: Promise<void> = Promise.resolve();

function withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = localTail.then(fn, fn);
  localTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Run work against the shared universe, persisting afterward when using Redis or D1.
 * A GET/HEAD whose only changes are accrued resources (and `lastTickAt`) skips
 * the lock and the save. Those stocks are recomputed from the clocks on the
 * next cold load. D1 then writes the changed player or world rows, not the
 * whole universe. Vercel still stores one JSON document when something
 * structural did change.
 *
 * A save whose version key moved since the load is rejected and the handler
 * runs again on a fresh snapshot. The stale object is never written.
 */
async function withUniverseBody<T>(
  fn: (universe: UniverseState) => T | Promise<T>,
): Promise<T> {
  if (universeFault === "busy" || universeFault === "both") {
    throw new Error("Universe busy — retry in a moment.");
  }
  const client = getKvClient();
  if (!client) {
    const universe = await loadUniverse(null);
    return runUniverse(universe, fn);
  }

  if (quietRead()) {
    const universe = await loadUniverse(client);
    const version = universeCache?.version ?? null;
    if (universeCache?.universe === universe) {
      universeCache.slices = sliceStamps(universe);
    }
    const before = universeCache?.slices ?? sliceStamps(universe);
    const result = await runUniverse(universe, fn);
    const after = sliceStamps(universe);
    if (stampsEqual(before, after)) {
      if (universeCache) universeCache.slices = after;
      return result;
    }
    if (await acquireLock(client)) {
      try {
        const current = await client.get<string>(versionKey(), { fresh: true });
        if (current === version) {
          await saveUniverse(client, universe, before, version, true);
          return result;
        }
      } catch (err) {
        if (!(err instanceof StaleUniverseError)) throw err;
      } finally {
        await releaseLock(client);
      }
    }
    universeCache = null;
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if (await acquireLock(client)) {
      try {
        const universe = await loadUniverse(client);
        if (universeCache?.universe === universe) {
          universeCache.slices = sliceStamps(universe);
        }
        const before = universeCache?.slices ?? emptyStamps();
        const expected = universeCache?.version ?? null;
        const result = await runUniverse(universe, fn);
        await saveUniverse(client, universe, before, expected);
        return result;
      } catch (err) {
        if (err instanceof StaleUniverseError) {
          universeCache = null;
          continue;
        }
        throw err;
      } finally {
        await releaseLock(client);
      }
    }
    await sleep(40 + attempt * 40);
  }
  throw new Error("Universe busy — retry in a moment.");
}

/**
 * Cheap "did anything structural change?" check for a D1 read.
 * A full slice hash of a seeded universe is slower than the Workers CPU
 * budget, so a quiet poll must not pay it. This misses resource stocks,
 * `lastTickAt`, `lastAiSimAt`, and view-only `remainingSeconds`. It does
 * cover builds, research, fleets, reports, pirate/alien clocks, the alien
 * daily seed, planet positions, debris, asteroids, occupations, alliances,
 * ACS groups, and the seed cursor.
 */
function structuralHint(universe: UniverseState): string {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  const mix = (n: number) => {
    h1 = Math.imul(h1 ^ (n | 0), 16777619);
    h2 = Math.imul(h2 ^ ((n * 13) | 0), 2246822519);
  };
  const mixStr = (text: string) => {
    mix(text.length);
    for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
  };
  mixStr(universe.alienDailyFindDay ?? "");
  mix(universe.alienDailyFindSeed ?? 0);
  mix(universe.alienFoundCountToday ?? 0);
  mix(Object.keys(universe.seasons ?? {}).length);
  const fleets = Object.values(universe.fleets ?? {});
  mix(fleets.length);
  for (const fleet of fleets) {
    mixStr(fleet.id);
    mixStr(fleet.mission);
    mixStr(fleet.phase);
    mix(fleet.arrivesAt);
    mixStr(fleet.reportId ?? "");
    let ships = 0;
    for (const count of Object.values(fleet.ships ?? {})) ships += count || 0;
    mix(ships);
  }
  mix(Object.keys(universe.reports ?? {}).length);
  mix(Object.keys(universe.spyReports ?? {}).length);
  mix(Object.keys(universe.expeditionReports ?? {}).length);
  for (const player of Object.values(universe.players)) {
    mixStr(player.id);
    mix(player.eventLog?.length ?? 0);
    mix(player.starshards ?? 0);
    mix(player.highscoreStarshardsClaimed ? 1 : 0);
    mixStr(player.season?.seasonId ?? "");
    mix(player.season?.combat ?? 0);
    mix(player.season?.economy ?? 0);
    mix(player.season?.pirateKills ?? 0);
    const officers = player.officers ?? [];
    mix(officers.length);
    for (const officer of officers) mix(officer.expiresAt ?? 0);
    const researchQueue = player.researchQueue ?? [];
    mix(researchQueue.length);
    const front = researchQueue[0];
    if (front) {
      mixStr(front.researchId);
      mix(front.targetLevel);
      mix(front.completesAt);
    }
    for (const [id, level] of Object.entries(player.research ?? {})) {
      if (typeof level === "number") {
        mixStr(id);
        mix(level);
      }
    }
  }
  for (const planet of Object.values(universe.planets)) {
    mix(planet.coords?.galaxy ?? 0);
    mix(planet.coords?.system ?? 0);
    mix(planet.coords?.slot ?? 0);
    mix(planet.lastDriftAt ?? 0);
    if (!planet.ownerPlayerId) continue;
    mixStr(planet.id);
    for (const [id, level] of Object.entries(planet.buildings ?? {})) {
      mixStr(id);
      mix(level ?? 0);
    }
    for (const [id, count] of Object.entries(planet.ships ?? {})) {
      mixStr(id);
      mix(count ?? 0);
    }
    let defenses = 0;
    for (const count of Object.values(planet.defenses ?? {})) defenses += count || 0;
    mix(defenses);
    const buildQueue = planet.buildQueue ?? [];
    mix(buildQueue.length);
    const build = buildQueue[0];
    if (build) {
      mixStr(build.buildingId);
      mix(build.targetLevel);
      mix(build.completesAt);
    }
    mix(planet.shipQueue?.length ?? 0);
    const ship = planet.shipQueue?.[0];
    if (ship) {
      mixStr(ship.shipId ?? "");
      mix(ship.completesAt);
    }
    mix(planet.defenseQueue?.length ?? 0);
    const defense = planet.defenseQueue?.[0];
    if (defense) {
      mixStr(defense.defenseId ?? "");
      mix(defense.completesAt);
    }
  }
  const pirates = Object.values(universe.pirateBases ?? {});
  mix(pirates.length);
  for (const base of pirates) {
    mixStr(base.id);
    mix(base.level ?? 0);
    mix(base.nextRaidAt ?? 0);
    mix(base.destroyedAt ?? 0);
    mix(base.lastGrewAt ?? 0);
  }
  const aliens = Object.values(universe.alienBases ?? {});
  mix(aliens.length);
  for (const base of aliens) {
    mixStr(base.id);
    mix(base.level ?? 0);
    mix(base.nextRaidAt ?? 0);
    mix(base.destroyedAt ?? 0);
    mix(base.lastGrewAt ?? 0);
  }
  mix(Object.keys(universe.debris ?? {}).length);
  mix(Object.keys(universe.asteroids ?? {}).length);
  mix(Object.keys(universe.occupations ?? {}).length);
  mix(Object.keys(universe.alliances ?? {}).length);
  const acs = Object.values(universe.acsGroups ?? {});
  mix(acs.length);
  for (const group of acs) {
    mixStr(group.id);
    mixStr(group.status);
  }
  const cursor = universe.seedCursor;
  if (cursor) {
    mix(cursor.at ?? 0);
    mix(cursor.pirates ?? 0);
    mix(cursor.rankAt ?? 0);
    mix(cursor.done ? 1 : 0);
  } else {
    mix(0);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

/**
 * Snapshot read for `/api/state` and `/api/auth/me`.
 * Never waits on the universe lock. A read may try the lock once when a
 * poll finishes a build, fleet, or report.
 *
 * Memory (and the single Redis document) ticks the stored universe. A polled
 * fleet has to stay there or the return leg never finishes.
 *
 * D1 ticks the cached snapshot. A resource-only tick stays in memory and does
 * not hash the universe. A structural change (build, research, fleet, report,
 * debris, asteroid, occupation, alliance, ACS group, or seed cursor) is saved
 * the way a quiet read saves: one lock attempt, no wait, and the rows that
 * actually differ. If the lock is busy or the version moved, the cache is
 * dropped so that in-memory tick cannot become the base of a partial write.
 *
 * After the row migration, the same rule applies per player, planet, fleet,
 * and message. Those reads lock only the named players, and they do not wait.
 */
export async function withUniverseRead<T>(
  fn: (universe: UniverseState) => T | Promise<T>,
  work?: UniverseWork,
): Promise<T> {
  if (await rowSaveReady()) {
    const scope = currentScope();
    return withRowUniverse(scope!.db!, getKvClient(), fn, work, false);
  }
  return withLocalLock(async () => {
    if (universeFault === "read" || universeFault === "both") {
      throw new Error("Universe busy — retry in a moment.");
    }
    const client = getKvClient();
    const universe = await loadUniverse(client);
    if (!client || storageMode() !== "d1") {
      return runUniverse(universe, fn);
    }
    const version = universeCache?.version ?? null;
    const beforeHint = structuralHint(universe);
    const before =
      universeCache?.universe === universe
        ? universeCache.slices
        : sliceStamps(universe);
    const result = await runUniverse(universe, fn);
    if (structuralHint(universe) === beforeHint) {
      return result;
    }
    if (await acquireLock(client)) {
      try {
        const current = await client.get<string>(versionKey(), { fresh: true });
        if (current === version) {
          const after = sliceStamps(universe);
          if (!stampsEqual(before, after)) {
            await saveUniverse(client, universe, before, version, true);
          } else if (universeCache?.universe === universe) {
            universeCache.slices = after;
          }
          return result;
        }
      } catch (err) {
        universeCache = null;
        if (!(err instanceof StaleUniverseError)) throw err;
      } finally {
        await releaseLock(client);
      }
    }
    universeCache = null;
    return result;
  });
}

export async function withUniverse<T>(
  fn: (universe: UniverseState) => T | Promise<T>,
  work?: UniverseWork,
): Promise<T> {
  if (await rowSaveReady()) {
    const scope = currentScope();
    return withRowUniverse(scope!.db!, getKvClient(), fn, work, true);
  }
  return withLocalLock(() => withUniverseBody(fn));
}

/**
 * One migration slice per request. Until it finishes, callers stay on the
 * legacy document. A failed slice is logged and the old save keeps serving.
 */
async function rowSaveReady(): Promise<boolean> {
  const scope = currentScope();
  const db = scope?.db;
  if (!db || storageMode() !== "d1") return false;
  if (process.env.STARHOLD_ROW_SAVE === "legacy") return false;
  if (universeFault === "read" || universeFault === "both" || universeFault === "busy") {
    return false;
  }
  try {
    if (await migrationDone(db)) return true;
    const client = getKvClient();
    if (!client) return false;
    const legacy = await loadUniverse(client);
    const version = (await client.get<string>(versionKey())) ?? "";
    const step = await migrateChunk(db, legacy, undefined, undefined, version);
    if (step.done) {
      const after = (await client.get<string>(versionKey())) ?? "";
      if (after !== version) {
        await rewindMigration(db, after);
        const fresh = await loadUniverse(client);
        await migrateChunk(db, fresh, undefined, undefined, after);
      }
    }
    return migrationDone(db);
  } catch (err) {
    console.error("[starhold] row migration failed; still on the old save", err);
    return false;
  }
}

/** Test helper: wipe in-memory universe (no-op for the Redis document). */
export function resetMemoryUniverse(): void {
  memoryUniverse = null;
  universeCache = null;
}

/** Test helper: true after a memory-mode load created the universe. */
export function memoryUniverseLoaded(): boolean {
  return memoryUniverse !== null;
}
