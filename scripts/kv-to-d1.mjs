/**
 * One-time Upstash / Vercel KV → D1 copy. Not run by CI or deploy.
 *
 *   node --import tsx scripts/kv-to-d1.mjs export kv-export.json
 *   node --import tsx scripts/kv-to-d1.mjs import kv-export.json kv-import.sql
 *
 * Export reads KV_REST_API_* or UPSTASH_REDIS_REST_*. The JSON file contains
 * password hashes — do not commit it. Import writes SQL for
 * `wrangler d1 execute starhold --file=kv-import.sql`.
 */
import { writeFile, readFile } from "node:fs/promises";
import {
  chunkKey,
  splitChunkText,
} from "../apps/server/src/d1-codec.ts";

function creds() {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ""
  ).replace(/\/$/, "");
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) {
    throw new Error(
      "Set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).",
    );
  }
  return { url, token };
}

async function upstash(path, body) {
  const { url, token } = creds();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${path} failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.result;
}

async function scanKeys() {
  const keys = [];
  let cursor = "0";
  do {
    const result = await upstash(`/scan/${cursor}`, [
      "MATCH",
      "starhold:*",
      "COUNT",
      "200",
    ]);
    cursor = String(result[0]);
    keys.push(...result[1]);
  } while (cursor !== "0");
  return keys;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(key, value, expiresAt) {
  const exp = expiresAt == null ? "NULL" : String(expiresAt);
  return `INSERT INTO kv (key, value, expires_at) VALUES (${sqlString(key)}, ${sqlString(value)}, ${exp}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at;`;
}

async function exportKv(outPath) {
  const keys = await scanKeys();
  const rows = [];
  for (const key of keys) {
    const value = await upstash(`/get/${encodeURIComponent(key)}`);
    let ttl = await upstash(`/ttl/${encodeURIComponent(key)}`);
    ttl = Number(ttl);
    rows.push({
      key,
      value,
      ttlSec: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
    });
  }
  const payload = { exportedAt: new Date().toISOString(), keys: rows };
  await writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${rows.length} keys to ${outPath}`);
}

async function importSql(inPath, outPath) {
  const payload = JSON.parse(await readFile(inPath, "utf8"));
  const lines = ["BEGIN TRANSACTION;"];
  const now = Date.now();
  for (const row of payload.keys ?? []) {
    const text = JSON.stringify(row.value);
    const expires =
      row.ttlSec != null ? now + Number(row.ttlSec) * 1000 : null;
    const chunked = splitChunkText(text);
    if (!chunked) {
      lines.push(insertSql(row.key, text, expires));
      continue;
    }
    lines.push(insertSql(row.key, chunked.manifest, expires));
    chunked.parts.forEach((part, index) => {
      lines.push(insertSql(chunkKey(row.key, index), part, null));
    });
  }
  lines.push("COMMIT;");
  await writeFile(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}. Apply with wrangler d1 execute when you are ready.`);
}

const [command, input, output] = process.argv.slice(2);
if (command === "export") {
  await exportKv(input || "kv-export.json");
} else if (command === "import") {
  await importSql(input || "kv-export.json", output || "kv-import.sql");
} else {
  console.error("Usage: export [kv-export.json] | import [kv-export.json] [kv-import.sql]");
  process.exit(1);
}
