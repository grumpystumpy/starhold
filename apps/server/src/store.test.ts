import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, UNIVERSE_SCHEMA_VERSION } from "@starhold/game";
import { runWithScope } from "./request-context.js";
import {
  LOCAL_LOCK_MAX_WAIT_MS,
  redisCredentials,
  UNIVERSE_LOCK_MS,
  resetMemoryUniverse,
  withUniverse,
  withUniverseRead,
} from "./store.js";
import type { KvStore } from "./kv.js";

describe("redisCredentials env fallback", () => {
  it("prefers UPSTASH_REDIS_REST_* when both pairs exist", () => {
    const creds = redisCredentials({
      UPSTASH_REDIS_REST_URL: "https://upstash.example",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token",
      KV_REST_API_URL: "https://kv.example",
      KV_REST_API_TOKEN: "kv-token",
    });
    assert.deepEqual(creds, {
      url: "https://upstash.example",
      token: "upstash-token",
      mode: "upstash",
    });
  });

  it("falls back to KV_REST_API_* (Vercel Upstash integration)", () => {
    const creds = redisCredentials({
      KV_REST_API_URL: "https://kv.example",
      KV_REST_API_TOKEN: "kv-token",
    });
    assert.deepEqual(creds, {
      url: "https://kv.example",
      token: "kv-token",
      mode: "kv",
    });
  });

  it("returns null without either pair", () => {
    assert.equal(redisCredentials({}), null);
    assert.equal(
      redisCredentials({ KV_REST_API_URL: "https://only-url.example" }),
      null,
    );
  });
});

describe("universe lock", () => {
  it("holds the lock for 2–3 seconds", () => {
    assert.ok(UNIVERSE_LOCK_MS >= 2_000);
    assert.ok(UNIVERSE_LOCK_MS <= 3_000);
    assert.equal(UNIVERSE_LOCK_MS, 2_500);
    assert.equal(LOCAL_LOCK_MAX_WAIT_MS, 2_000);
  });

  it("drops a stuck read tail and reloads the cached universe after two seconds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    resetMemoryUniverse();
    const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
    const initial = createUniverse("Initial", 8, 8, { lazySeed: true });
    const replacement = createUniverse("Replacement", 8, 8, { lazySeed: true });
    let version = "1";
    let saved = initial;
    const store: KvStore = {
      async get<T>(requested: string): Promise<T | null> {
        if (requested === `${key}:ver`) return version as T;
        if (requested === key) return saved as T;
        return null;
      },
      async set() {
        return "OK";
      },
      async del() {},
    };
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const stuckRead = runWithScope(
      { kv: store, mode: "upstash", method: "GET", cpuMs: 0 },
      () =>
        withUniverseRead(async () => {
          firstEntered();
          return firstHold;
        }),
    );
    // The callback begins only after the initial document has been cached.
    await entered;
    version = "2";
    saved = replacement;
    const nextRead = runWithScope(
      { kv: store, mode: "upstash", method: "GET", cpuMs: 0 },
      () => withUniverseRead((universe) => universe.name),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.runAll();
    assert.equal(await nextRead, "Replacement");
    releaseFirst();
    await stuckRead;
    resetMemoryUniverse();
  });

  it("keeps normal back-to-back reads in order without waiting for the cap", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    resetMemoryUniverse();
    const order: number[] = [];
    await withUniverseRead(() => {
      order.push(1);
    });
    await withUniverseRead(() => {
      order.push(2);
    });
    assert.deepEqual(order, [1, 2]);
    resetMemoryUniverse();
  });

  it("lets a read proceed after a write tail is abandoned", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    resetMemoryUniverse();
    let releaseWrite!: () => void;
    const killedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const write = withUniverse(async () => killedWrite);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const read = withUniverseRead(() => "read completed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.runAll();
    assert.equal(await read, "read completed");
    releaseWrite();
    await write;
    resetMemoryUniverse();
  });
});
