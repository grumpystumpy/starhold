/**
 * Pure planning for the one-time Vercel KV → D1 transfer.
 * The script in `scripts/kv-to-d1.mjs` reads KV and writes SQL. This module
 * only counts and splits rows so a dry run does not need Cloudflare.
 */
import type { UniverseState } from "@starhold/game";
import {
  isUniverseDocumentKey,
  splitUniverse,
} from "./universe-docs.js";

export interface KvExportRow {
  key: string;
  value: unknown;
  ttlSec: number | null;
}

export interface TransferCounts {
  keys: number;
  accounts: number;
  players: number;
  planets: number;
  fleets: number;
  messages: number;
  alliances: number;
  scryptHashes: number;
  pbkdf2Hashes: number;
  /** Imported accounts whose password hash is dropped. */
  needsPasswordReset: number;
  sessions: number;
  d1Rows: number;
}

export function importedAccountNeedsPasswordReset(account: {
  passwordHash?: string;
  passwordHashPbkdf2?: string;
  needsPasswordReset?: boolean;
}): boolean {
  if (account.needsPasswordReset) return true;
  const hash = account.passwordHash ?? "";
  if (hash.startsWith("scrypt$") || hash.startsWith("pbkdf2$")) return true;
  return (account.passwordHashPbkdf2 ?? "").startsWith("pbkdf2$");
}

/** Drop peppered hashes. The Vercel SESSION_SECRET cannot verify them. */
export function importedAccountValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const account = { ...(value as Record<string, unknown>) };
  if (
    !importedAccountNeedsPasswordReset(
      account as {
        passwordHash?: string;
        passwordHashPbkdf2?: string;
        needsPasswordReset?: boolean;
      },
    )
  ) {
    return value;
  }
  delete account.passwordHashPbkdf2;
  account.passwordHash = "";
  account.needsPasswordReset = true;
  return account;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * An account already claimed on Workers: the reset flag is off and a
 * password hash is stored. Re-import leaves that row in place.
 */
function claimedAccountGuard(accountKey: string): string {
  return [
    `key = ${sqlLiteral(accountKey)}`,
    "IFNULL(json_extract(value, '$.needsPasswordReset'), 0) = 0",
    "length(IFNULL(json_extract(value, '$.passwordHash'), '')) > 0",
  ].join(" AND ");
}

/** Replace an account row unless Workers already has a password for it. */
export function upsertPreservingClaimedAccount(
  key: string,
  valueJson: string,
  expiresAt: number | null,
): string[] {
  const exp = expiresAt == null ? "NULL" : String(expiresAt);
  const guard = claimedAccountGuard(key);
  const keyMatch = `(key = ${sqlLiteral(key)} OR key GLOB ${sqlLiteral(`${key}#*`)})`;
  return [
    `DELETE FROM kv WHERE ${keyMatch} AND NOT (${guard});`,
    `INSERT INTO kv (key, value, expires_at) SELECT ${sqlLiteral(key)}, ${sqlLiteral(valueJson)}, ${exp} WHERE NOT EXISTS (SELECT 1 FROM kv WHERE ${guard});`,
  ];
}

/** Write a handed-out claim code only while that account still needs a password. */
export function upsertClaimCodeUnlessClaimed(
  accountKey: string,
  claimKey: string,
  valueJson: string,
  expiresAt: number | null,
): string[] {
  const exp = expiresAt == null ? "NULL" : String(expiresAt);
  const pending = [
    "EXISTS (SELECT 1 FROM kv AS account",
    `WHERE account.key = ${sqlLiteral(accountKey)}`,
    "AND IFNULL(json_extract(account.value, '$.needsPasswordReset'), 0) = 1)",
  ].join(" ");
  const keyMatch = `(key = ${sqlLiteral(claimKey)} OR key GLOB ${sqlLiteral(`${claimKey}#*`)})`;
  return [
    `DELETE FROM kv WHERE ${keyMatch} AND ${pending};`,
    `INSERT INTO kv (key, value, expires_at) SELECT ${sqlLiteral(claimKey)}, ${sqlLiteral(valueJson)}, ${exp} WHERE ${pending};`,
  ];
}

export interface PlannedRow {
  key: string;
  value: unknown;
  expiresAt: number | null;
}

function asUniverse(value: unknown): UniverseState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as UniverseState;
  if (typeof row.id !== "string" || !row.players || typeof row.players !== "object") {
    return null;
  }
  return row;
}

function countMessages(universe: UniverseState): number {
  let n = 0;
  for (const player of Object.values(universe.players)) {
    n += player.eventLog?.length ?? 0;
  }
  n += Object.keys(universe.reports ?? {}).length;
  n += Object.keys(universe.spyReports ?? {}).length;
  n += Object.keys(universe.expeditionReports ?? {}).length;
  return n;
}

export function summarizeExport(
  rows: KvExportRow[],
  opts?: { claimCodeRows?: boolean },
): TransferCounts {
  const counts: TransferCounts = {
    keys: rows.length,
    accounts: 0,
    players: 0,
    planets: 0,
    fleets: 0,
    messages: 0,
    alliances: 0,
    scryptHashes: 0,
    pbkdf2Hashes: 0,
    needsPasswordReset: 0,
    sessions: 0,
    d1Rows: 0,
  };
  for (const row of rows) {
    if (row.key.startsWith("starhold:account:")) {
      counts.accounts += 1;
      const account = row.value as {
        passwordHash?: string;
        passwordHashPbkdf2?: string;
        needsPasswordReset?: boolean;
      };
      if (account?.passwordHash?.startsWith("scrypt$")) counts.scryptHashes += 1;
      if (
        account?.passwordHash?.startsWith("pbkdf2$") ||
        account?.passwordHashPbkdf2?.startsWith("pbkdf2$")
      ) {
        counts.pbkdf2Hashes += 1;
      }
      if (account && importedAccountNeedsPasswordReset(account)) {
        counts.needsPasswordReset += 1;
      }
    } else if (row.key.startsWith("starhold:session:")) {
      counts.sessions += 1;
    } else if (isUniverseDocumentKey(row.key)) {
      const universe = asUniverse(row.value);
      if (!universe) continue;
      counts.players += Object.keys(universe.players).length;
      counts.planets += Object.keys(universe.planets ?? {}).length;
      counts.fleets += Object.keys(universe.fleets ?? {}).length;
      counts.messages += countMessages(universe);
      counts.alliances += Object.keys(universe.alliances ?? {}).length;
    }
  }
  counts.d1Rows = planImportRows(rows, 0).length;
  if (opts?.claimCodeRows) counts.d1Rows += counts.needsPasswordReset;
  return counts;
}

/** Rows to upsert. Universe blobs become world, asteroid, pirate, alien, and player rows. */
export function planImportRows(rows: KvExportRow[], now: number): PlannedRow[] {
  const planned: PlannedRow[] = [];
  for (const row of rows) {
    if (row.key.endsWith(":lock") || row.key.endsWith(":ver")) continue;
    // Vercel sessions were minted under the old secret. Do not copy them.
    if (row.key.startsWith("starhold:session:")) continue;
    if (row.key.startsWith("starhold:scrypt-attempt:")) continue;
    const expiresAt =
      row.ttlSec != null && row.ttlSec > 0 ? now + row.ttlSec * 1000 : null;
    if (row.key.startsWith("starhold:account:")) {
      planned.push({
        key: row.key,
        value: importedAccountValue(row.value),
        expiresAt,
      });
      continue;
    }
    if (isUniverseDocumentKey(row.key)) {
      const universe = asUniverse(row.value);
      if (!universe) continue;
      const parts = splitUniverse(universe);
      planned.push({ key: `${row.key}:world`, value: parts.world, expiresAt: null });
      planned.push({
        key: `${row.key}:asteroids`,
        value: parts.asteroids,
        expiresAt: null,
      });
      planned.push({ key: `${row.key}:pirates`, value: parts.pirates, expiresAt: null });
      planned.push({ key: `${row.key}:aliens`, value: parts.aliens, expiresAt: null });
      for (const [id, slice] of Object.entries(parts.players)) {
        planned.push({
          key: `${row.key}:player:${id}`,
          value: slice,
          expiresAt: null,
        });
      }
      continue;
    }
    planned.push({ key: row.key, value: row.value, expiresAt });
  }
  return planned;
}

export function formatTransferCounts(counts: TransferCounts): string {
  return [
    `keys ${counts.keys}`,
    `accounts ${counts.accounts}`,
    `players ${counts.players}`,
    `planets ${counts.planets}`,
    `fleets ${counts.fleets}`,
    `messages ${counts.messages}`,
    `alliances ${counts.alliances}`,
    `scrypt ${counts.scryptHashes}`,
    `pbkdf2 ${counts.pbkdf2Hashes}`,
    `needsPasswordReset ${counts.needsPasswordReset}`,
    `sessions ${counts.sessions}`,
    `d1Rows ${counts.d1Rows}`,
  ].join("\n");
}
