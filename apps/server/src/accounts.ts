/**
 * Account / session / password auth persistence.
 * Uses Upstash/KV when configured, D1 on Workers, otherwise process-local Maps.
 * Vercel passwords stay Node scrypt. Workers use WebCrypto PBKDF2 (10k).
 * An imported scrypt hash is verified once (sliced on Workers) and replaced
 * with PBKDF2 so later logins stay inside the free-plan CPU cap.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { KvStore } from "./kv.js";
import { hashPbkdf2, verifyPbkdf2 } from "./password.js";
import { hashScrypt, verifyScrypt } from "./password-scrypt.js";
import { currentScope } from "./request-context.js";
import { getKvClient } from "./store.js";

export const SESSION_COOKIE = "starhold_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const AUTH_RATE_TTL_SEC = 15 * 60; // 15 minutes
export const AUTH_RATE_MAX = 10;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export interface AccountRecord {
  id: string;
  email: string;
  /**
   * `scrypt$…` on Vercel, `pbkdf2$…` on Workers.
   * Pepper is applied before the KDF.
   */
  passwordHash: string;
  /**
   * PBKDF2 copy. Stamped on a successful Vercel login, or written when
   * Workers verifies an imported scrypt hash and replaces `passwordHash`.
   * Additive — old rows load.
   */
  passwordHashPbkdf2?: string;
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

export function isWorkersRuntime(): boolean {
  return process.env.STARHOLD_RUNTIME === "workers";
}

function usePbkdf2(): boolean {
  const kdf = process.env.STARHOLD_PASSWORD_KDF?.trim();
  if (kdf === "pbkdf2") return true;
  if (kdf === "scrypt") return false;
  return isWorkersRuntime();
}

/**
 * On Vercel and Workers, refuse auth mutations without SESSION_SECRET so
 * password peppers and cookie integrity are not silently weak.
 */
export function requireSessionSecret(): string | null {
  if (!sessionSecretConfigured() && isWorkersRuntime()) {
    return "SESSION_SECRET is required. Set it with `wrangler secret put SESSION_SECRET` (local: `.dev.vars`).";
  }
  if (!sessionSecretConfigured() && isVercelRuntime()) {
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
  client: KvStore | null,
  key: string,
): Promise<T | null> {
  if (!client) return null;
  const data = await client.get<T>(key);
  return data ?? null;
}

async function kvSet(
  client: KvStore | null,
  key: string,
  value: unknown,
  exSec?: number,
): Promise<void> {
  if (!client) return;
  if (exSec != null) {
    await client.set(key, value, { exSec });
  } else {
    await client.set(key, value);
  }
}

async function kvDel(client: KvStore | null, key: string): Promise<void> {
  if (!client) return;
  await client.del(key);
}

function pepperPassword(password: string): string {
  return `${sessionSecret()}:${password}`;
}

export async function hashPassword(password: string): Promise<string> {
  const peppered = pepperPassword(password);
  if (usePbkdf2()) return hashPbkdf2(peppered);
  return hashScrypt(peppered);
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const peppered = pepperPassword(password);
  if (encoded.startsWith("pbkdf2$")) return verifyPbkdf2(peppered, encoded);
  if (encoded.startsWith("scrypt$")) return verifyScrypt(peppered, encoded);
  return false;
}

const memScryptAttempts = new Map<string, { email: string; expiresAt: number }>();

function scryptAttemptKey(id: string): string {
  return `starhold:scrypt-attempt:${id}`;
}

/** Remember a sliced scrypt login so continuations are not rate-limited. */
export async function noteScryptAttempt(id: string, email: string): Promise<void> {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const client = getKvClient();
  if (!client) {
    memScryptAttempts.set(id, { email, expiresAt });
    return;
  }
  await kvSet(client, scryptAttemptKey(id), { email }, 10 * 60);
}

export async function isScryptAttempt(id: string): Promise<boolean> {
  const client = getKvClient();
  if (!client) {
    const row = memScryptAttempts.get(id);
    return Boolean(row && row.expiresAt > Date.now());
  }
  const row = await kvGet<{ email: string }>(client, scryptAttemptKey(id));
  return Boolean(row);
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
  attemptId?: string,
): Promise<
  | { ok: true; account: AccountRecord }
  | { ok: false; error: string; status: 400 | 401 }
  | { ok: false; pending: true; attemptId: string; status: 202; error: "" }
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
  const importedScrypt =
    isWorkersRuntime() &&
    account.passwordHash.startsWith("scrypt$") &&
    !account.passwordHashPbkdf2;
  if (importedScrypt) {
    const migrator = currentScope()?.migrateScrypt;
    let match = false;
    if (migrator) {
      const step = await migrator({
        attemptId,
        password: pepperPassword(password),
        encoded: account.passwordHash,
      });
      if (!step.done) {
        await noteScryptAttempt(step.attemptId, normalized);
        return {
          ok: false,
          pending: true,
          attemptId: step.attemptId,
          status: 202,
          error: "",
        };
      }
      match = step.match;
    } else {
      match = await verifyScrypt(pepperPassword(password), account.passwordHash);
    }
    if (!match) {
      return { ok: false, error: "Invalid email or password.", status: 401 };
    }
    const pbkdf2 = await hashPbkdf2(pepperPassword(password));
    account.passwordHash = pbkdf2;
    account.passwordHashPbkdf2 = pbkdf2;
    account.lastLoginAt = now;
    await saveAccount(account);
    return { ok: true, account };
  }
  const encoded =
    isWorkersRuntime() && account.passwordHashPbkdf2
      ? account.passwordHashPbkdf2
      : account.passwordHash;
  const match = await verifyPassword(password, encoded);
  if (!match) {
    return { ok: false, error: "Invalid email or password.", status: 401 };
  }
  account.lastLoginAt = now;
  if (!isWorkersRuntime() && !account.passwordHashPbkdf2) {
    account.passwordHashPbkdf2 = await hashPbkdf2(pepperPassword(password));
  }
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
  memScryptAttempts.clear();
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
