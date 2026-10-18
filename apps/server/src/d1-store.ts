import { chunkKey, chunkPartCount, splitChunkText } from "./d1-codec.js";
import type { KvListRow, KvSetOptions, KvStore } from "./kv.js";
import { addCpu } from "./request-context.js";

export interface D1RunResult {
  meta?: { changes?: number };
}

export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResult>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<D1RunResult[]>;
}

interface KvRow {
  value: string;
  expires_at: number | null;
}

function timedParse(text: string): unknown {
  const started = performance.now();
  try {
    return JSON.parse(text) as unknown;
  } finally {
    addCpu(performance.now() - started);
  }
}

function timedStringify(value: unknown): string {
  const started = performance.now();
  try {
    return JSON.stringify(value);
  } finally {
    addCpu(performance.now() - started);
  }
}

export function createD1Store(db: D1Like, now: () => number = Date.now): KvStore {
  /** Parsed-row cache for this store. Workers build one store per request. */
  const rowCache = new Map<string, KvRow | null>();
  const listCache = new Map<string, KvListRow[]>();

  function cacheable(key: string): boolean {
    return !key.endsWith(":lock");
  }

  function forget(key?: string): void {
    listCache.clear();
    if (!key) {
      rowCache.clear();
      return;
    }
    rowCache.delete(key);
    const partPrefix = `${key}#`;
    for (const cached of rowCache.keys()) {
      if (cached.startsWith(partPrefix)) rowCache.delete(cached);
    }
  }

  async function readRow(key: string, fresh = false): Promise<KvRow | null> {
    if (!fresh && cacheable(key) && rowCache.has(key)) {
      const cached = rowCache.get(key) ?? null;
      if (cached && cached.expires_at != null && cached.expires_at <= now()) {
        forget(key);
        await delKey(key);
        return null;
      }
      return cached;
    }
    const row = await db
      .prepare("SELECT value, expires_at FROM kv WHERE key = ?")
      .bind(key)
      .first<KvRow>();
    if (!row) {
      if (cacheable(key)) rowCache.set(key, null);
      return null;
    }
    if (row.expires_at != null && row.expires_at <= now()) {
      forget(key);
      await delKey(key);
      return null;
    }
    if (cacheable(key)) rowCache.set(key, row);
    return row;
  }

  async function delKey(key: string): Promise<void> {
    forget(key);
    await db
      .prepare("DELETE FROM kv WHERE key = ? OR key GLOB ?")
      .bind(key, `${key}#*`)
      .run();
  }

  function rememberWritten(
    key: string,
    stored: string,
    expires: number | null,
  ): void {
    listCache.clear();
    if (!cacheable(key)) return;
    rowCache.set(key, { value: stored, expires_at: expires });
  }

  return {
    async get<T>(key: string, opts?: { fresh?: boolean }): Promise<T | null> {
      const row = await readRow(key, opts?.fresh === true);
      if (!row) return null;
      const parts = chunkPartCount(row.value);
      let text = row.value;
      if (parts != null) {
        const chunks: string[] = [];
        for (let i = 0; i < parts; i++) {
          const part = await readRow(chunkKey(key, i));
          if (!part) return null;
          chunks.push(part.value);
        }
        text = chunks.join("");
      }
      return timedParse(text) as T;
    },

    async set(
      key: string,
      value: unknown,
      opts?: KvSetOptions,
    ): Promise<"OK" | null> {
      const text = timedStringify(value);
      const expires =
        opts?.px != null
          ? now() + opts.px
          : opts?.exSec != null
            ? now() + opts.exSec * 1000
            : null;

      if (opts?.nx) {
        const results = await db.batch([
          db
            .prepare(
              "DELETE FROM kv WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?",
            )
            .bind(key, now()),
          db
            .prepare(
              "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
            )
            .bind(key, text, expires),
        ]);
        const changes = results[1]?.meta?.changes ?? 0;
        if (changes > 0) rememberWritten(key, text, expires);
        return changes > 0 ? "OK" : null;
      }

      const chunked = splitChunkText(text);
      const statements: D1Stmt[] = [
        db
          .prepare("DELETE FROM kv WHERE key = ? OR key GLOB ?")
          .bind(key, `${key}#*`),
      ];
      if (!chunked) {
        statements.push(
          db
            .prepare(
              "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)",
            )
            .bind(key, text, expires),
        );
      } else {
        statements.push(
          db
            .prepare(
              "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)",
            )
            .bind(key, chunked.manifest, expires),
        );
        chunked.parts.forEach((part, index) => {
          statements.push(
            db
              .prepare(
                "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)",
              )
              .bind(chunkKey(key, index), part, null),
          );
        });
      }
      await db.batch(statements);
      if (!chunked) {
        rememberWritten(key, text, expires);
      } else {
        listCache.clear();
        if (cacheable(key)) {
          rowCache.set(key, { value: chunked.manifest, expires_at: expires });
          chunked.parts.forEach((part, index) => {
            rowCache.set(chunkKey(key, index), { value: part, expires_at: null });
          });
        }
      }
      return "OK";
    },

    del(key: string): Promise<void> {
      return delKey(key);
    },

    async list(prefix: string): Promise<KvListRow[]> {
      const cached = listCache.get(prefix);
      if (cached) return cached;
      const selected = await db
        .prepare(
          "SELECT key, value FROM kv WHERE key GLOB ? AND (expires_at IS NULL OR expires_at > ?)",
        )
        .bind(`${prefix}*`, now())
        .all<{ key: string; value: string }>();
      const raw = new Map<string, string>();
      for (const row of selected.results) raw.set(row.key, row.value);
      const out: KvListRow[] = [];
      for (const [key, value] of raw) {
        if (key.includes("#")) continue;
        const parts = chunkPartCount(value);
        let text = value;
        if (parts != null) {
          const chunks: string[] = [];
          let complete = true;
          for (let i = 0; i < parts; i++) {
            const part = raw.get(chunkKey(key, i));
            if (part == null) {
              complete = false;
              break;
            }
            chunks.push(part);
          }
          if (!complete) continue;
          text = chunks.join("");
        }
        out.push({ key, value: timedParse(text) });
      }
      listCache.set(prefix, out);
      return out;
    },
  };
}
