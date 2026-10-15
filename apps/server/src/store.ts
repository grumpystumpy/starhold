import { Redis } from "@upstash/redis";
import {
  archiveUniverseKey,
  createUniverse,
  ensureUniverseShape,
  migrateOrResetUniverse,
  UNIVERSE_SCHEMA_VERSION,
  type UniverseState,
} from "@starhold/game";
import type { KvSetOptions, KvStore, StorageMode } from "./kv.js";
import { structuralStamp } from "./persist-stamp.js";
import { addCpu, currentMethod, currentScope } from "./request-context.js";

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
  stamp: string;
}

let memoryUniverse: UniverseState | null = null;
let universeCache: UniverseCache | null = null;
let redis: Redis | null | undefined;
let redisKvStore: KvStore | null = null;
let resolvedMode: StorageMode | undefined;

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
    async get<T>(key: string): Promise<T | null> {
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
  stamp: string,
): void {
  universeCache = {
    key: universeKey(),
    version,
    universe,
    stamp,
  };
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
      remember(migrated.universe, next, structuralStamp(migrated.universe));
      return migrated.universe;
    }
    ensureUniverseShape(migrated.universe);
    const stamp = structuralStamp(migrated.universe);
    const next = version ?? String(Date.now());
    if (!version) await client.set(versionKey(), next);
    remember(migrated.universe, next, stamp);
    return migrated.universe;
  }

  const created = freshUniverse();
  ensureUniverseShape(created);
  await client.set(key, created);
  const next = String(Date.now());
  await client.set(versionKey(), next);
  remember(created, next, structuralStamp(created));
  return created;
}

async function saveUniverse(
  client: KvStore,
  state: UniverseState,
  beforeStamp: string,
): Promise<void> {
  const stamp = structuralStamp(state);
  const method = currentMethod();
  const quietRead = method === "GET" || method === "HEAD";
  if (quietRead && stamp === beforeStamp) {
    if (universeCache?.universe === state) universeCache.stamp = stamp;
    return;
  }
  await client.set(universeKey(), state);
  const version = String(Date.now());
  await client.set(versionKey(), version);
  remember(state, version, stamp);
}

async function acquireLock(client: KvStore): Promise<boolean> {
  const result = await client.set(lockKey(), String(Date.now()), {
    nx: true,
    px: 8_000,
  });
  return result === "OK";
}

async function releaseLock(client: KvStore): Promise<void> {
  await client.del(lockKey());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run work against the shared universe, persisting afterward when using Redis or D1.
 * Read-only callers should still use this so tick-on-read advances consistently.
 * On Workers, a GET whose structural stamp did not change skips the write.
 */
export async function withUniverse<T>(
  fn: (universe: UniverseState) => T | Promise<T>,
): Promise<T> {
  const client = getKvClient();
  if (!client) {
    const universe = await loadUniverse(null);
    const started = performance.now();
    try {
      return await fn(universe);
    } finally {
      addCpu(performance.now() - started);
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if (await acquireLock(client)) {
      try {
        const universe = await loadUniverse(client);
        const before = universeCache?.stamp ?? structuralStamp(universe);
        const started = performance.now();
        let result: T;
        try {
          result = await fn(universe);
        } finally {
          addCpu(performance.now() - started);
        }
        await saveUniverse(client, universe, before);
        return result;
      } finally {
        await releaseLock(client);
      }
    }
    await sleep(40 + attempt * 40);
  }
  throw new Error("Universe busy — retry in a moment.");
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
