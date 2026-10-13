import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redisCredentials } from "./store.js";

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
