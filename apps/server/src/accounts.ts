/**
 * Account / session / magic-link persistence.
 * Uses Upstash/KV when configured; otherwise process-local Maps (local + CI).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { getKvClient } from "./store.js";

export const SESSION_COOKIE = "starhold_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const MAGIC_TTL_SEC = 15 * 60; // 15 minutes

export interface AccountRecord {
  id: string;
  email: string;
  playerId: string | null;
  createdAt: number;
  lastLoginAt: number;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export interface MagicRecord {
  email: string;
  createdAt: number;
  expiresAt: number;
  claimPlayerId?: string;
}

const memAccounts = new Map<string, AccountRecord>();
const memEmailIndex = new Map<string, string>();
const memSessions = new Map<string, SessionRecord>();
const memMagic = new Map<string, MagicRecord>();

function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    "starhold-dev-session-secret-not-for-prod"
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Practical v1 check — not full RFC.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function hashToken(token: string): string {
  return createHash("sha256")
    .update(`${sessionSecret()}:${token}`)
    .digest("hex");
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function accountKey(id: string): string {
  return `starhold:account:${id}`;
}
function emailKey(email: string): string {
  return `starhold:email:${email}`;
}
function sessionKey(id: string): string {
  return `starhold:session:${id}`;
}
function magicKey(hash: string): string {
  return `starhold:magic:${hash}`;
}

async function kvGet<T>(
  client: Redis | null,
  key: string,
): Promise<T | null> {
  if (!client) return null;
  const data = await client.get<T>(key);
  return data ?? null;
}

async function kvSet(
  client: Redis | null,
  key: string,
  value: unknown,
  exSec?: number,
): Promise<void> {
  if (!client) return;
  if (exSec != null) {
    await client.set(key, value, { ex: exSec });
  } else {
    await client.set(key, value);
  }
}

async function kvDel(client: Redis | null, key: string): Promise<void> {
  if (!client) return;
  await client.del(key);
}

export async function getAccountById(
  accountId: string,
): Promise<AccountRecord | null> {
  const client = getKvClient();
  if (!client) return memAccounts.get(accountId) ?? null;
  return kvGet<AccountRecord>(client, accountKey(accountId));
}

export async function getAccountByEmail(
  email: string,
): Promise<AccountRecord | null> {
  const normalized = normalizeEmail(email);
  const client = getKvClient();
  if (!client) {
    const id = memEmailIndex.get(normalized);
    return id ? (memAccounts.get(id) ?? null) : null;
  }
  const id = await kvGet<string>(client, emailKey(normalized));
  if (!id) return null;
  return kvGet<AccountRecord>(client, accountKey(id));
}

export async function upsertAccountForEmail(
  email: string,
  now = Date.now(),
): Promise<AccountRecord> {
  const normalized = normalizeEmail(email);
  const existing = await getAccountByEmail(normalized);
  if (existing) {
    existing.lastLoginAt = now;
    await saveAccount(existing);
    return existing;
  }
  const account: AccountRecord = {
    id: `acct_${now.toString(36)}_${randomBytes(4).toString("hex")}`,
    email: normalized,
    playerId: null,
    createdAt: now,
    lastLoginAt: now,
  };
  await saveAccount(account);
  return account;
}

async function saveAccount(account: AccountRecord): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memAccounts.set(account.id, account);
    memEmailIndex.set(account.email, account.id);
    return;
  }
  await kvSet(client, accountKey(account.id), account);
  await kvSet(client, emailKey(account.email), account.id);
}

export async function setAccountPlayerId(
  accountId: string,
  playerId: string | null,
): Promise<AccountRecord | null> {
  const account = await getAccountById(accountId);
  if (!account) return null;
  account.playerId = playerId;
  account.lastLoginAt = Date.now();
  await saveAccount(account);
  return account;
}

export async function createMagicLink(opts: {
  email: string;
  claimPlayerId?: string;
  now?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const now = opts.now ?? Date.now();
  const token = newToken(32);
  const hash = hashToken(token);
  const expiresAt = now + MAGIC_TTL_SEC * 1000;
  const record: MagicRecord = {
    email: normalizeEmail(opts.email),
    createdAt: now,
    expiresAt,
    claimPlayerId: opts.claimPlayerId?.trim() || undefined,
  };
  const client = getKvClient();
  if (!client) {
    memMagic.set(hash, record);
  } else {
    await kvSet(client, magicKey(hash), record, MAGIC_TTL_SEC);
  }
  return { token, expiresAt };
}

export async function consumeMagicToken(
  token: string,
  now = Date.now(),
): Promise<MagicRecord | null> {
  const hash = hashToken(token);
  const client = getKvClient();
  let record: MagicRecord | null;
  if (!client) {
    record = memMagic.get(hash) ?? null;
    if (record) memMagic.delete(hash);
  } else {
    record = await kvGet<MagicRecord>(client, magicKey(hash));
    if (record) await kvDel(client, magicKey(hash));
  }
  if (!record) return null;
  if (record.expiresAt < now) return null;
  return record;
}

export async function createSession(
  accountId: string,
  now = Date.now(),
): Promise<SessionRecord> {
  const id = newToken(32);
  const record: SessionRecord = {
    id,
    accountId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SEC * 1000,
  };
  const client = getKvClient();
  if (!client) {
    memSessions.set(id, record);
  } else {
    await kvSet(client, sessionKey(id), record, SESSION_TTL_SEC);
  }
  return record;
}

export async function getSession(
  sessionId: string,
  now = Date.now(),
): Promise<SessionRecord | null> {
  if (!sessionId) return null;
  const client = getKvClient();
  let record: SessionRecord | null;
  if (!client) {
    record = memSessions.get(sessionId) ?? null;
  } else {
    record = await kvGet<SessionRecord>(client, sessionKey(sessionId));
  }
  if (!record) return null;
  if (record.expiresAt < now) {
    await deleteSession(sessionId);
    return null;
  }
  return record;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memSessions.delete(sessionId);
    return;
  }
  await kvDel(client, sessionKey(sessionId));
}

/** Test helper — wipe in-memory account tables. */
export function resetMemoryAccounts(): void {
  memAccounts.clear();
  memEmailIndex.clear();
  memSessions.clear();
  memMagic.clear();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function appBaseUrl(reqUrl?: string): string {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  if (reqUrl) {
    try {
      const u = new URL(reqUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  return "http://localhost:3001";
}
