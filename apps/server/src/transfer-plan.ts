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
  sessions: number;
  d1Rows: number;
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

export function summarizeExport(rows: KvExportRow[]): TransferCounts {
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
    sessions: 0,
    d1Rows: 0,
  };
  for (const row of rows) {
    if (row.key.startsWith("starhold:account:")) {
      counts.accounts += 1;
      const account = row.value as { passwordHash?: string; passwordHashPbkdf2?: string };
      if (account?.passwordHash?.startsWith("scrypt$")) counts.scryptHashes += 1;
      if (
        account?.passwordHash?.startsWith("pbkdf2$") ||
        account?.passwordHashPbkdf2?.startsWith("pbkdf2$")
      ) {
        counts.pbkdf2Hashes += 1;
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
  return counts;
}

/** Rows to upsert. Universe blobs become world, asteroid, pirate, alien, and player rows. */
export function planImportRows(rows: KvExportRow[], now: number): PlannedRow[] {
  const planned: PlannedRow[] = [];
  for (const row of rows) {
    if (row.key.endsWith(":lock") || row.key.endsWith(":ver")) continue;
    const expiresAt =
      row.ttlSec != null && row.ttlSec > 0 ? now + row.ttlSec * 1000 : null;
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
    `sessions ${counts.sessions}`,
    `d1Rows ${counts.d1Rows}`,
  ].join("\n");
}
