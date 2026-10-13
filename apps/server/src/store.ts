import {
  createUniverse,
  ensureUniverseShape,
  type UniverseState,
} from "@starhold/game";
import { Redis } from "@upstash/redis";

/**
 * Universe persistence.
 * - Local / CI: in-memory (process lifetime).
 * - Vercel: Upstash Redis via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 *
 * Schema: one JSON document at STARHOLD_UNIVERSE_KEY (default `starhold:universe:v1`).
 * Lock key: `${key}:lock` (NX + short TTL) for critical sections.
 */

const UNIVERSE_NAME = process.env.STARHOLD_UNIVERSE_NAME ?? "Alpha Drift";
const UNIVERSE_SPEED = Number(process.env.STARHOLD_UNIVERSE_SPEED ?? 8);
const REDIS_KEY = process.env.STARHOLD_UNIVERSE_KEY ?? "starhold:universe:v1";
const LOCK_KEY = `${REDIS_KEY}:lock`;

let memoryUniverse: UniverseState | null = null;
let redis: Redis | null | undefined;

function hasUpstashEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  if (!hasUpstashEnv()) {
    redis = null;
    return null;
  }
  redis = Redis.fromEnv();
  return redis;
}

export function storageMode(): "upstash" | "memory" {
  return hasUpstashEnv() ? "upstash" : "memory";
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
  const data = await client.get<UniverseState>(REDIS_KEY);
  if (data && typeof data === "object" && data.id) {
    ensureUniverseShape(data);
    return data;
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
