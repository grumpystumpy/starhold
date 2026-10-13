import {
  archiveUniverseKey,
  createUniverse,
  ensureUniverseShape,
  migrateOrResetUniverse,
  UNIVERSE_SCHEMA_VERSION,
  type UniverseState,
} from "@starhold/game";
import { Redis } from "@upstash/redis";

/**
 * Universe persistence.
 * - Local / CI: in-memory (process lifetime).
 * - Vercel: Upstash Redis / Vercel KV REST:
 *     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *     OR KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Upstash integration)
 *
 * Schema: one JSON document at STARHOLD_UNIVERSE_KEY
 * (default `starhold:universe:v2` for contract map).
 * Lock key: `${key}:lock` (NX + short TTL) for critical sections.
 *
 * Incompatible schema (missing / < UNIVERSE_SCHEMA_VERSION): archive old blob,
 * write a fresh universe — never remap 1×9×8 coords in place.
 */

const UNIVERSE_NAME = process.env.STARHOLD_UNIVERSE_NAME ?? "Alpha Drift";
const UNIVERSE_SPEED = Number(process.env.STARHOLD_UNIVERSE_SPEED ?? 8);
const REDIS_KEY =
  process.env.STARHOLD_UNIVERSE_KEY ??
  `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
const LOCK_KEY = `${REDIS_KEY}:lock`;

export type StorageMode = "upstash" | "kv" | "memory";

let memoryUniverse: UniverseState | null = null;
let redis: Redis | null | undefined;
let resolvedMode: StorageMode | undefined;

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

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const creds = redisCredentials(process.env);
  if (!creds) {
    redis = null;
    resolvedMode = "memory";
    return null;
  }
  resolvedMode = creds.mode;
  redis = new Redis({ url: creds.url, token: creds.token });
  return redis;
}

export function storageMode(): StorageMode {
  if (resolvedMode) return resolvedMode;
  const creds = redisCredentials(process.env);
  return creds?.mode ?? "memory";
}

function freshUniverse(): UniverseState {
  return createUniverse(UNIVERSE_NAME, UNIVERSE_SPEED);
}

async function loadUniverse(client: Redis | null): Promise<UniverseState> {
  if (!client) {
    if (!memoryUniverse) memoryUniverse = freshUniverse();
    ensureUniverseShape(memoryUniverse);
    return memoryUniverse;
  }

  // Prefer versioned key; also probe legacy v1 key once for archive/reset.
  let data = await client.get<UniverseState>(REDIS_KEY);
  if (!data || typeof data !== "object" || !data.id) {
    const legacy = await client.get<UniverseState>("starhold:universe:v1");
    if (legacy && typeof legacy === "object" && legacy.id) {
      data = legacy;
    }
  }

  if (data && typeof data === "object" && data.id) {
    const migrated = migrateOrResetUniverse(data, {
      name: UNIVERSE_NAME,
      speed: UNIVERSE_SPEED,
    });
    if (migrated.didReset && migrated.archived) {
      const archiveKey = archiveUniverseKey(
        migrated.archived.id,
        Date.now(),
      );
      await client.set(archiveKey, migrated.archived);
      await client.set(REDIS_KEY, migrated.universe);
      // Drop legacy key so partial deploys do not re-read prototype map.
      await client.del("starhold:universe:v1").catch(() => undefined);
      return migrated.universe;
    }
    ensureUniverseShape(migrated.universe);
    return migrated.universe;
  }

  const created = freshUniverse();
  ensureUniverseShape(created);
  await client.set(REDIS_KEY, created);
  return created;
}

async function saveUniverse(
  client: Redis | null,
  state: UniverseState,
): Promise<void> {
  if (!client) {
    memoryUniverse = state;
    return;
  }
  await client.set(REDIS_KEY, state);
}

async function acquireLock(client: Redis): Promise<boolean> {
  const result = await client.set(LOCK_KEY, String(Date.now()), {
    nx: true,
    px: 8_000,
  });
  return result === "OK";
}

async function releaseLock(client: Redis): Promise<void> {
  await client.del(LOCK_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run work against the shared universe, persisting afterward when using Redis.
 * Read-only callers should still use this so tick-on-read advances consistently.
 */
export async function withUniverse<T>(
  fn: (universe: UniverseState) => T | Promise<T>,
): Promise<T> {
  const client = getRedis();
  if (!client) {
    const universe = await loadUniverse(null);
    return await fn(universe);
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if (await acquireLock(client)) {
      try {
        const universe = await loadUniverse(client);
        const result = await fn(universe);
        await saveUniverse(client, universe);
        return result;
      } finally {
        await releaseLock(client);
      }
    }
    await sleep(40 + attempt * 40);
  }
  throw new Error("Universe busy — retry in a moment.");
}

/** Test helper: wipe in-memory universe (no-op for Redis). */
export function resetMemoryUniverse(): void {
  memoryUniverse = null;
}
