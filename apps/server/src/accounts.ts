/**
 * Account / session / password auth persistence.
 * Uses Upstash/KV when configured, D1 on Workers, otherwise process-local Maps.
 * Vercel passwords stay Node scrypt. Workers use WebCrypto PBKDF2 (10k).
 * Imported Vercel accounts have no password hash: the old pepper is gone,
 * so the player sets a new PBKDF2 password with a one-time claim code.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CLAIM_CODE_TTL_SEC,
  claimCodeKey,
  claimMailConfigured,
  hashClaimCode,
  isValidClaimCode,
  newClaimCode,
  normalizeClaimCode,
  sendClaimCode,
  type ClaimCodeRecord,
} from "./claim-code.js";
import type { KvStore } from "./kv.js";
import { hashPbkdf2, verifyPbkdf2 } from "./password.js";
import { hashScrypt, verifyScrypt } from "./password-scrypt.js";
import { getKvClient } from "./store.js";

export const SESSION_COOKIE = "starhold_session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const AUTH_RATE_TTL_SEC = 15 * 60; // 15 minutes
export const AUTH_RATE_MAX = 10;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const PASSWORD_RESET_MESSAGE =
  "This account needs a new password. Enter the claim code you were given.";

export interface AccountRecord {
  id: string;
  email: string;
  /**
   * `scrypt$…` on Vercel, `pbkdf2$…` on Workers.
   * Empty when an import dropped the old hash (`needsPasswordReset`).
   * Pepper is applied before the KDF.
   */
  passwordHash: string;
  /**
   * Older Vercel rows may still carry this. Import drops it: it was
   * peppered with the unrecoverable Vercel secret.
   */
  passwordHashPbkdf2?: string;
  /** Set on import. Login is refused until a claim code sets a new password. */
  needsPasswordReset?: boolean;
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
const memClaimCodes = new Map<string, ClaimCodeRecord>();

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

/**
 * Rate-limit auth attempts. Keyed by action + email + optional IP.
 * Returns remaining wait seconds when blocked, else null.
 */
export async function checkAuthRateLimit(
  action: "signup" | "login" | "claim",
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
  if (account?.needsPasswordReset) {
    return { ok: false, error: PASSWORD_RESET_MESSAGE, status: 401 };
  }
  // Workers never verifies scrypt. A leftover hash cannot be checked
  // without the Vercel pepper, so the player must use a claim code.
  if (
    account &&
    isWorkersRuntime() &&
    account.passwordHash.startsWith("scrypt$")
  ) {
    return { ok: false, error: PASSWORD_RESET_MESSAGE, status: 401 };
  }
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

async function saveClaimCode(record: ClaimCodeRecord): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memClaimCodes.set(record.accountId, record);
    return;
  }
  await kvSet(client, claimCodeKey(record.accountId), record, CLAIM_CODE_TTL_SEC);
}

async function loadClaimCode(accountId: string): Promise<ClaimCodeRecord | null> {
  const client = getKvClient();
  if (!client) return memClaimCodes.get(accountId) ?? null;
  return kvGet<ClaimCodeRecord>(client, claimCodeKey(accountId));
}

async function deleteClaimCode(accountId: string): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memClaimCodes.delete(accountId);
    return;
  }
  await kvDel(client, claimCodeKey(accountId));
}

export async function issueClaimCode(
  accountId: string,
  now = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const code = newClaimCode();
  const expiresAt = now + CLAIM_CODE_TTL_SEC * 1000;
  await saveClaimCode({
    accountId,
    codeHash: hashClaimCode(code, sessionSecret()),
    expiresAt,
  });
  return { code, expiresAt };
}

/** True only when the code matches, is unexpired, and had not been used. */
export async function consumeClaimCode(
  accountId: string,
  code: string,
  now = Date.now(),
): Promise<boolean> {
  const provided = hashClaimCode(normalizeClaimCode(code), sessionSecret());
  const record = await loadClaimCode(accountId);
  if (record && record.expiresAt <= now) {
    await deleteClaimCode(accountId);
  }
  const live = record && record.expiresAt > now ? record : null;
  const expected = live?.codeHash ?? "0".repeat(64);
  if (!live || !safeEqual(provided, expected)) return false;
  await deleteClaimCode(accountId);
  return true;
}

/**
 * Email a fresh code when mail is configured and this account must reset.
 * Does not rotate a code when mail is off — that file is the only copy.
 * Always safe to call for an unknown email: it sends nothing.
 */
export async function requestClaimCode(
  email: string,
  now = Date.now(),
): Promise<void> {
  if (!claimMailConfigured()) return;
  const account = await getAccountByEmail(normalizeEmail(email));
  if (!account?.needsPasswordReset) return;
  const issued = await issueClaimCode(account.id, now);
  const sent = await sendClaimCode(account.email, issued.code);
  if (!sent) await deleteClaimCode(account.id);
}

export async function setAccountPassword(
  account: AccountRecord,
  password: string,
  now = Date.now(),
): Promise<AccountRecord> {
  account.passwordHash = await hashPassword(password);
  account.needsPasswordReset = false;
  delete account.passwordHashPbkdf2;
  account.lastLoginAt = now;
  await saveAccount(account);
  return account;
}

export async function claimNewPassword(
  email: string,
  code: string,
  password: string,
  now = Date.now(),
): Promise<
  | { ok: true; account: AccountRecord }
  | { ok: false; error: string; status: 400 | 401 }
> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Valid email required.", status: 400 };
  }
  if (!isValidPassword(password)) {
    return {
      ok: false,
      error: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`,
      status: 400,
    };
  }
  const normalizedCode = normalizeClaimCode(code);
  if (!isValidClaimCode(normalizedCode)) {
    return { ok: false, error: "That claim code is not valid.", status: 401 };
  }
  const account = await getAccountByEmail(normalized);
  if (!account?.needsPasswordReset) {
    return { ok: false, error: "That claim code is not valid.", status: 401 };
  }
  const match = await consumeClaimCode(account.id, normalizedCode, now);
  if (!match) {
    return { ok: false, error: "That claim code is not valid.", status: 401 };
  }
  await setAccountPassword(account, password, now);
  return { ok: true, account };
}

/** Test / local e2e helper: drop the password and issue one claim code. */
export async function preparePasswordClaim(
  email: string,
  now = Date.now(),
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const account = await getAccountByEmail(normalizeEmail(email));
  if (!account) return { ok: false, error: "Account not found." };
  account.needsPasswordReset = true;
  account.passwordHash = "";
  delete account.passwordHashPbkdf2;
  await saveAccount(account);
  const issued = await issueClaimCode(account.id, now);
  return { ok: true, code: issued.code };
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
  memClaimCodes.clear();
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
