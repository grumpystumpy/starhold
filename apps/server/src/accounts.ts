/**
 * Account / session / password auth persistence.
 * Uses Upstash/KV when configured; otherwise process-local Maps (local + CI).
 * Passwords: Node crypto.scrypt (serverless-safe, no native addon).
 */

import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import type { Redis } from "@upstash/redis";
import { getKvClient } from "./store.js";

export const SESSION_COOKIE = "starhold_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const AUTH_RATE_TTL_SEC = 15 * 60; // 15 minutes
export const AUTH_RATE_MAX = 10;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** scrypt params — ~16–40ms on typical serverless CPU; no native deps. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password,
      salt,
      keylen,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived as Buffer);
      },
    );
  });
}

export interface AccountRecord {
  id: string;
  email: string;
  /** scrypt$salt$hash (pepper applied before scrypt). */
  passwordHash: string;
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

const memAccounts = new Map<string, AccountRecord>();
const memEmailIndex = new Map<string, string>();
const memSessions = new Map<string, SessionRecord>();
const memRate = new Map<string, { count: number; expiresAt: number }>();

/**
 * Pepper / signing secret.
 * Local/CI: fixed dev fallback.
 * Vercel production: require SESSION_SECRET (see requireSessionSecret).
 */
export function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    "starhold-dev-session-secret-not-for-prod"
  );
}

export function sessionSecretConfigured(): boolean {
  return Boolean(process.env.SESSION_SECRET?.trim());
}

/** True when running on Vercel — SESSION_SECRET required for auth writes. */
export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * On Vercel, refuse auth mutations without SESSION_SECRET so password peppers
 * and cookie integrity are not silently weak.
 */
export function requireSessionSecret(): string | null {
  if (isVercelRuntime() && !sessionSecretConfigured()) {
    return "SESSION_SECRET is required in production. Set it in Vercel → Environment Variables (openssl rand -base64 32), then redeploy.";
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Practical v1 check — not full RFC.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function isValidPassword(password: string): boolean {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX
  );
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
function rateKey(bucket: string): string {
  return `starhold:ratelimit:auth:${bucket}`;
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

function pepperPassword(password: string): string {
  return `${sessionSecret()}:${password}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(
    pepperPassword(password),
    salt,
    SCRYPT_KEYLEN,
  );
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64url");
  const expected = Buffer.from(parts[2]!, "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scryptAsync(
    pepperPassword(password),
    salt,
    expected.length,
  );
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Rate-limit auth attempts (signup/login). Keyed by action + email + optional IP.
 * Returns remaining wait seconds when blocked, else null.
 */
export async function checkAuthRateLimit(
  action: "signup" | "login",
  email: string,
  ip?: string | null,
): Promise<{ limited: boolean; retryAfterSec: number }> {
  const bucket = hashToken(
    `${action}:${normalizeEmail(email)}:${(ip ?? "").trim() || "unknown"}`,
  );
  const now = Date.now();
  const client = getKvClient();
  const key = rateKey(bucket);

  if (!client) {
    const cur = memRate.get(bucket);
    if (!cur || cur.expiresAt < now) {
      memRate.set(bucket, {
        count: 1,
        expiresAt: now + AUTH_RATE_TTL_SEC * 1000,
      });
      return { limited: false, retryAfterSec: 0 };
    }
    cur.count += 1;
    if (cur.count > AUTH_RATE_MAX) {
      return {
        limited: true,
        retryAfterSec: Math.max(1, Math.ceil((cur.expiresAt - now) / 1000)),
      };
    }
    return { limited: false, retryAfterSec: 0 };
  }

  type RateRec = { count: number; expiresAt: number };
  let rec = await kvGet<RateRec>(client, key);
  if (!rec || rec.expiresAt < now) {
    rec = { count: 1, expiresAt: now + AUTH_RATE_TTL_SEC * 1000 };
    await kvSet(client, key, rec, AUTH_RATE_TTL_SEC);
    return { limited: false, retryAfterSec: 0 };
  }
  rec.count += 1;
  const ttlSec = Math.max(1, Math.ceil((rec.expiresAt - now) / 1000));
  await kvSet(client, key, rec, ttlSec);
  if (rec.count > AUTH_RATE_MAX) {
    return { limited: true, retryAfterSec: ttlSec };
  }
  return { limited: false, retryAfterSec: 0 };
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

export async function createAccountWithPassword(
  email: string,
  password: string,
  now = Date.now(),
): Promise<{ ok: true; account: AccountRecord } | { ok: false; error: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Valid email required." };
  }
  if (!isValidPassword(password)) {
    return {
      ok: false,
      error: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`,
    };
  }
  const existing = await getAccountByEmail(normalized);
  if (existing) {
    return { ok: false, error: "An account with that email already exists." };
  }
  const passwordHash = await hashPassword(password);
  const account: AccountRecord = {
    id: `acct_${now.toString(36)}_${randomBytes(4).toString("hex")}`,
    email: normalized,
    passwordHash,
    playerId: null,
    createdAt: now,
    lastLoginAt: now,
  };
  await saveAccount(account);
  return { ok: true, account };
}

export async function authenticateEmailPassword(
  email: string,
  password: string,
  now = Date.now(),
): Promise<
  | { ok: true; account: AccountRecord }
  | { ok: false; error: string; status: 400 | 401 }
> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized) || !password) {
    return { ok: false, error: "Email and password required.", status: 400 };
  }
  const account = await getAccountByEmail(normalized);
  // Constant-ish failure path: still run a dummy verify when missing.
  if (!account?.passwordHash) {
    await hashPassword(password).catch(() => undefined);
    return { ok: false, error: "Invalid email or password.", status: 401 };
  }
  const match = await verifyPassword(password, account.passwordHash);
  if (!match) {
    return { ok: false, error: "Invalid email or password.", status: 401 };
  }
  account.lastLoginAt = now;
  await saveAccount(account);
  return { ok: true, account };
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
  memRate.clear();
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

export function clientIp(headers: {
  get(name: string): string | null | undefined;
}): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}
