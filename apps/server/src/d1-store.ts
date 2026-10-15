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
  async function readRow(key: string): Promise<KvRow | null> {
    const row = await db
      .prepare("SELECT value, expires_at FROM kv WHERE key = ?")
      .bind(key)
      .first<KvRow>();
    if (!row) return null;
    if (row.expires_at != null && row.expires_at <= now()) {
      await delKey(key);
      return null;
    }
    return row;
  }

  async function delKey(key: string): Promise<void> {
    await db
      .prepare("DELETE FROM kv WHERE key = ? OR key GLOB ?")
      .bind(key, `${key}#*`)
      .run();
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      const row = await readRow(key);
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
      return "OK";
    },

    del(key: string): Promise<void> {
      return delKey(key);
    },

    async list(prefix: string): Promise<KvListRow[]> {
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
      return out;
    },
  };
}
