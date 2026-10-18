/**
 * Key-value surface shared by Vercel KV (Upstash Redis) and Cloudflare D1.
 * Workers KV is intentionally not an implementation: its free tier allows
 * 1,000 writes a day, which a universe save would burn through.
 */

export interface KvGetOptions {
  /** Bypass a per-request read cache. Required for the save version check. */
  fresh?: boolean;
}

export interface KvSetOptions {
  /** Expire after this many seconds. */
  exSec?: number;
  /** Expire after this many milliseconds (lock TTL). */
  px?: number;
  /** Insert only when the key is absent. */
  nx?: boolean;
}

export interface KvListRow {
  key: string;
  value: unknown;
}

export interface KvStore {
  get<T>(key: string, opts?: KvGetOptions): Promise<T | null>;
  /** `"OK"` when the write landed. `null` when `nx` lost the race. */
  set(key: string, value: unknown, opts?: KvSetOptions): Promise<"OK" | null>;
  del(key: string): Promise<void>;
  /**
   * Keys that start with `prefix`. Chunk part rows are folded back into
   * their parent. D1 implements this; the Redis adapter does not.
   */
  list?(prefix: string): Promise<KvListRow[]>;
}

export type StorageMode = "upstash" | "kv" | "memory" | "d1";
