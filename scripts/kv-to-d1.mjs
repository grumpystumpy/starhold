/**
 * One-time Vercel KV → D1 copy. Read-only against KV. Does not apply SQL.
 *
 *   node --import tsx scripts/kv-to-d1.mjs export --dry-run
 *   node --import tsx scripts/kv-to-d1.mjs export kv-export.json
 *   node --import tsx scripts/kv-to-d1.mjs import --dry-run kv-export.json
 *   node --import tsx scripts/kv-to-d1.mjs import kv-export.json kv-import.sql
 *   npx wrangler d1 execute starhold --remote --file=kv-import.sql
 *
 * Export reads KV_REST_API_URL and KV_REST_API_TOKEN (SCAN/GET/TTL only).
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are accepted as aliases.
 * Set SESSION_SECRET to the new Workers secret before a real import so
 * claim-code hashes match the Worker. Do not commit the JSON, SQL, or
 * claim-codes.txt. Do not run this against production until the cut-over
 * checklist in docs/cloudflare.md says to.
 */
import { readFile, writeFile } from "node:fs/promises";
import { sessionSecret, sessionSecretConfigured } from "../apps/server/src/accounts.ts";
import {
  buildImportClaimCodes,
  claimCodeKey,
  claimMailConfigured,
  formatClaimCodeFile,
} from "../apps/server/src/claim-code.ts";
import { chunkKey, splitChunkText } from "../apps/server/src/d1-codec.ts";
import {
  formatTransferCounts,
  planImportRows,
  summarizeExport,
} from "../apps/server/src/transfer-plan.ts";

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
      "Set KV_REST_API_URL and KV_REST_API_TOKEN (read-only). UPSTASH_REDIS_REST_* also works.",
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
    throw new Error(`KV ${path} failed: ${res.status} ${await res.text()}`);
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

function replaceSql(key, value, expiresAt) {
  const exp = expiresAt == null ? "NULL" : String(expiresAt);
  return [
    `DELETE FROM kv WHERE key = ${sqlString(key)} OR key GLOB ${sqlString(`${key}#*`)} ;`,
    `INSERT INTO kv (key, value, expires_at) VALUES (${sqlString(key)}, ${sqlString(value)}, ${exp});`,
  ];
}

async function readKv() {
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
  return rows;
}

function writeClaimCodeFile() {
  return !claimMailConfigured();
}

function printCounts(rows) {
  console.log(
    formatTransferCounts(
      summarizeExport(rows, { claimCodeRows: writeClaimCodeFile() }),
    ),
  );
  console.log(
    "Sessions are counted above and are not copied. Imported password hashes are dropped.",
  );
}

async function exportKv(outPath, dryRun) {
  const rows = await readKv();
  printCounts(rows);
  if (dryRun) {
    console.log("Dry run: read KV only, wrote no file.");
    return;
  }
  const payload = { exportedAt: new Date().toISOString(), keys: rows };
  await writeFile(outPath, JSON.stringify(payload));
  console.log(`Wrote ${rows.length} keys to ${outPath}`);
}

function attachClaimCodes(planned, now) {
  if (!writeClaimCodeFile()) {
    return { planned, file: null, count: 0 };
  }
  if (!sessionSecretConfigured()) {
    throw new Error(
      "Set SESSION_SECRET to the new Workers secret before import. Claim codes are hashed with it. Generate one with: openssl rand -base64 32",
    );
  }
  const accounts = [];
  for (const row of planned) {
    if (!row.key.startsWith("starhold:account:")) continue;
    const account = row.value;
    if (!account?.needsPasswordReset || !account.id || !account.email) continue;
    accounts.push({ id: account.id, email: account.email });
  }
  const codes = buildImportClaimCodes(accounts, sessionSecret(), now);
  for (const code of codes) {
    planned.push({
      key: claimCodeKey(code.accountId),
      value: code.record,
      expiresAt: code.expiresAt,
    });
  }
  return { planned, file: formatClaimCodeFile(codes, now), count: codes.length };
}

function sqlForPlanned(planned) {
  const lines = [
    "BEGIN TRANSACTION;",
    "DELETE FROM kv WHERE key GLOB 'starhold:universe:*';",
    "DELETE FROM kv WHERE key GLOB 'starhold:session:*';",
    "DELETE FROM kv WHERE key GLOB 'starhold:scrypt-attempt:*';",
  ];
  for (const row of planned) {
    const text = JSON.stringify(row.value);
    const chunked = splitChunkText(text);
    if (!chunked) {
      lines.push(...replaceSql(row.key, text, row.expiresAt));
      continue;
    }
    lines.push(...replaceSql(row.key, chunked.manifest, row.expiresAt));
    chunked.parts.forEach((part, index) => {
      lines.push(...replaceSql(chunkKey(row.key, index), part, null));
    });
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

async function importSql(inPath, outPath, dryRun) {
  const payload = JSON.parse(await readFile(inPath, "utf8"));
  const rows = payload.keys ?? [];
  printCounts(rows);
  if (dryRun) {
    console.log("Dry run: counted the export file, wrote no SQL and did not touch D1.");
    if (writeClaimCodeFile()) {
      console.log("A real import would write claim-codes.txt. This dry run does not.");
    } else {
      console.log("CLAIM_MAIL_URL is set. Claim codes are emailed on request. No code file.");
    }
    return;
  }
  const now = Date.now();
  const attached = attachClaimCodes(planImportRows(rows, now), now);
  const sql = sqlForPlanned(attached.planned);
  await writeFile(outPath, sql);
  if (attached.file) {
    await writeFile("claim-codes.txt", attached.file, { mode: 0o600 });
    console.log(
      `Wrote ${attached.count} claim codes to claim-codes.txt. Hand them out privately. Do not commit this file. Each code expires in 30 minutes.`,
    );
  } else {
    console.log("CLAIM_MAIL_URL is set. No claim-code file written.");
  }
  console.log(
    `Wrote ${outPath}. Review it, then apply with: npx wrangler d1 execute starhold --remote --file=${outPath}`,
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((arg) => arg !== "--dry-run");
const [command, input, output] = positional;

if (command === "export") {
  await exportKv(input || "kv-export.json", dryRun);
} else if (command === "import") {
  await importSql(input || "kv-export.json", output || "kv-import.sql", dryRun);
} else {
  console.error(
    "Usage: export [--dry-run] [kv-export.json] | import [--dry-run] [kv-export.json] [kv-import.sql]",
  );
  process.exit(1);
}
