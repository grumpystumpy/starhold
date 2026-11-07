/**
 * Optional Google / Discord sign-in. Account rows stay AccountRecord.
 * Links live in their own keys so accounts.ts is not edited.
 *
 * Password login rejects the `oauth$none` marker without a code change:
 * authenticateEmailPassword only accepts hashes that verifyPassword understands
 * (`pbkdf2$` / `scrypt$`). Anything else, including `oauth$none`, returns
 * "Invalid email or password."
 */
import { randomBytes } from "node:crypto";
import {
  createAccountWithPassword,
  getAccountByEmail,
  getAccountById,
  hashToken,
  isValidEmail,
  isWorkersRuntime,
  newToken,
  normalizeEmail,
  type AccountRecord,
} from "./accounts.js";
import { getKvClient } from "./store.js";

export const OAUTH_PASSWORD_MARKER = "oauth$none";
export const OAUTH_STATE_TTL_SEC = 10 * 60;

export type OAuthProviderId = "google" | "discord" | "mock";

export interface OAuthLink {
  provider: OAuthProviderId;
  subject: string;
  email: string;
  linkedAt: number;
}

export interface OAuthProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
}

interface OAuthState {
  provider: OAuthProviderId;
  verifier: string;
  createdAt: number;
  accountId: string | null;
  email?: string;
  sub?: string;
}

const PROVIDERS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    userinfo: "https://discord.com/api/users/@me",
    scope: "identify email",
    idEnv: "DISCORD_CLIENT_ID",
    secretEnv: "DISCORD_CLIENT_SECRET",
  },
} as const;

const mem = new Map<string, { value: unknown; expiresAt: number | null }>();

export function resetOAuthMemory(): void {
  mem.clear();
}

/** Test helper. Memory-mode states only (unit tests do not use KV). */
export function expireOAuthStatesForTests(now = Date.now()): void {
  for (const [key, row] of mem) {
    if (key.startsWith("oauth:state:")) row.expiresAt = now - 1;
  }
}

export function mockAllowed(): boolean {
  if (process.env.OAUTH_MOCK !== "1") return false;
  if (isWorkersRuntime() && process.env.STARHOLD_E2E !== "1") return false;
  return true;
}

export function configuredProviders(): OAuthProviderId[] {
  const list: OAuthProviderId[] = [];
  for (const id of ["google", "discord"] as const) {
    const def = PROVIDERS[id];
    if (process.env[def.idEnv]?.trim() && process.env[def.secretEnv]?.trim()) {
      list.push(id);
    }
  }
  if (mockAllowed()) list.push("mock");
  return list;
}

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return value === "google" || value === "discord" || value === "mock";
}

export function providerConfigured(provider: string): provider is OAuthProviderId {
  return isOAuthProvider(provider) && configuredProviders().includes(provider);
}

export function oauthRedirectUri(base: string, provider: string): string {
  return `${base.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function storeGet<T>(key: string, now = Date.now()): Promise<T | null> {
  const client = getKvClient();
  if (!client) {
    const row = mem.get(key);
    if (!row) return null;
    if (row.expiresAt != null && row.expiresAt <= now) {
      mem.delete(key);
      return null;
    }
    return row.value as T;
  }
  const data = await client.get<T>(key);
  return data ?? null;
}

async function storeSet(
  key: string,
  value: unknown,
  ttlSec?: number,
  now = Date.now(),
): Promise<void> {
  const client = getKvClient();
  if (!client) {
    mem.set(key, {
      value,
      expiresAt: ttlSec != null ? now + ttlSec * 1000 : null,
    });
    return;
  }
  if (ttlSec != null) await client.set(key, value, { exSec: ttlSec });
  else await client.set(key, value);
}

async function storeDel(key: string): Promise<void> {
  const client = getKvClient();
  if (!client) {
    mem.delete(key);
    return;
  }
  await client.del(key);
}

function stateKey(state: string): string {
  return `oauth:state:${hashToken(state)}`;
}

function linkKey(provider: string, subject: string): string {
  return `oauth:link:${provider}:${subject}`;
}

function accountLinksKey(accountId: string): string {
  return `oauth:acct:${accountId}`;
}

export async function beginOAuthState(input: {
  provider: OAuthProviderId;
  accountId: string | null;
  email?: string;
  sub?: string;
  now?: number;
}): Promise<{ state: string; verifier: string; challenge: string }> {
  const now = input.now ?? Date.now();
  const state = newToken(32);
  const verifier = newToken(32);
  const record: OAuthState = {
    provider: input.provider,
    verifier,
    createdAt: now,
    accountId: input.accountId,
  };
  if (input.email) record.email = input.email;
  if (input.sub) record.sub = input.sub;
  await storeSet(stateKey(state), record, OAUTH_STATE_TTL_SEC, now);
  return { state, verifier, challenge: await pkceS256(verifier) };
}

/** Read and delete. A second call, or a state older than 10 minutes, is null. */
export async function consumeOAuthState(
  state: string,
  now = Date.now(),
): Promise<OAuthState | null> {
  if (!state || state.length > 512) return null;
  const key = stateKey(state);
  const row = await storeGet<OAuthState>(key, now);
  await storeDel(key);
  if (!row || row.createdAt + OAUTH_STATE_TTL_SEC * 1000 <= now) return null;
  return row;
}

export function authorizeUrl(input: {
  provider: "google" | "discord";
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const def = PROVIDERS[input.provider];
  const clientId = process.env[def.idEnv]?.trim() ?? "";
  const url = new URL(def.authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function fetchOAuthProfile(
  provider: "google" | "discord",
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const def = PROVIDERS[provider];
  const clientId = process.env[def.idEnv]?.trim() ?? "";
  const clientSecret = process.env[def.secretEnv]?.trim() ?? "";
  const tokenRes = await fetch(def.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) throw new Error("OAuth token exchange failed.");
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("OAuth token exchange failed.");
  const infoRes = await fetch(def.userinfo, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  if (!infoRes.ok) throw new Error("OAuth userinfo failed.");
  const info = (await infoRes.json()) as Record<string, unknown>;
  if (provider === "google") {
    return {
      subject: typeof info.sub === "string" ? info.sub : "",
      email: typeof info.email === "string" ? info.email : "",
      emailVerified: info.email_verified === true,
    };
  }
  return {
    subject: typeof info.id === "string" ? info.id : "",
    email: typeof info.email === "string" ? info.email : "",
    emailVerified: info.verified === true && typeof info.email === "string",
  };
}

function validSubject(subject: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(subject);
}

export function passwordSignInAvailable(account: AccountRecord): boolean {
  if (account.needsPasswordReset) return false;
  return (
    account.passwordHash.startsWith("pbkdf2$") ||
    account.passwordHash.startsWith("scrypt$")
  );
}

/**
 * Password-less account. Memory mode has no public account writer, so this
 * creates through the password helper and immediately replaces the hash on
 * the stored object (same reference). KV mode writes `oauth$none` directly.
 */
export async function createOAuthOnlyAccount(
  email: string,
  now = Date.now(),
): Promise<{ ok: true; account: AccountRecord } | { ok: false; error: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "A verified email is required." };
  }
  if (!getKvClient()) {
    const created = await createAccountWithPassword(normalized, newToken(18), now);
    if (!created.ok) return created;
    created.account.passwordHash = OAUTH_PASSWORD_MARKER;
    return created;
  }
  const existing = await getAccountByEmail(normalized);
  if (existing) {
    return { ok: false, error: "An account with that email already exists." };
  }
  const account: AccountRecord = {
    id: `acct_${now.toString(36)}_${randomBytes(4).toString("hex")}`,
    email: normalized,
    passwordHash: OAUTH_PASSWORD_MARKER,
    playerId: null,
    createdAt: now,
    lastLoginAt: now,
  };
  await storeSet(`starhold:account:${account.id}`, account);
  await storeSet(`starhold:email:${account.email}`, account.id);
  return { ok: true, account };
}

export async function linkedAccountId(
  provider: OAuthProviderId,
  subject: string,
): Promise<string | null> {
  const id = await storeGet<string>(linkKey(provider, subject));
  return id ?? null;
}

export async function linksForAccount(accountId: string): Promise<OAuthLink[]> {
  return (await storeGet<OAuthLink[]>(accountLinksKey(accountId))) ?? [];
}

async function writeLinks(accountId: string, links: OAuthLink[]): Promise<void> {
  await storeSet(accountLinksKey(accountId), links);
}

export async function attachOAuthLink(
  account: AccountRecord,
  provider: OAuthProviderId,
  subject: string,
  email: string,
  now = Date.now(),
): Promise<void> {
  const links = await linksForAccount(account.id);
  const next = links.filter((link) => link.provider !== provider);
  next.push({
    provider,
    subject,
    email: normalizeEmail(email),
    linkedAt: now,
  });
  await storeSet(linkKey(provider, subject), account.id);
  await writeLinks(account.id, next);
}

export async function resolveOAuthLogin(input: {
  provider: OAuthProviderId;
  profile: OAuthProfile;
  signedInAccountId: string | null;
  now?: number;
}): Promise<
  | { ok: true; account: AccountRecord }
  | { ok: false; status: 400 | 401 | 409; error: string }
> {
  const now = input.now ?? Date.now();
  const email = normalizeEmail(input.profile.email ?? "");
  const subject = input.profile.subject.trim();
  if (!input.profile.emailVerified || !isValidEmail(email)) {
    return { ok: false, status: 400, error: "A verified email is required." };
  }
  if (!validSubject(subject)) {
    return { ok: false, status: 400, error: "OAuth subject is invalid." };
  }

  const existingId = await linkedAccountId(input.provider, subject);
  if (existingId) {
    if (input.signedInAccountId && existingId !== input.signedInAccountId) {
      return {
        ok: false,
        status: 409,
        error: "That provider account is already linked to another commander.",
      };
    }
    const linked = await getAccountById(existingId);
    if (linked) return { ok: true, account: linked };
    await storeDel(linkKey(input.provider, subject));
  }

  if (input.signedInAccountId) {
    const sessionAccount = await getAccountById(input.signedInAccountId);
    if (!sessionAccount) {
      return { ok: false, status: 401, error: "Sign in required." };
    }
    const already = await linksForAccount(sessionAccount.id);
    if (already.some((link) => link.provider === input.provider)) {
      return {
        ok: false,
        status: 409,
        error: "That provider is already linked.",
      };
    }
    await attachOAuthLink(sessionAccount, input.provider, subject, email, now);
    return { ok: true, account: sessionAccount };
  }

  const emailOwner = await getAccountByEmail(email);
  if (emailOwner) {
    return {
      ok: false,
      status: 409,
      error:
        "An account with that email already exists. Sign in with your password to link it.",
    };
  }

  const created = await createOAuthOnlyAccount(email, now);
  if (!created.ok) return { ok: false, status: 409, error: created.error };
  await attachOAuthLink(created.account, input.provider, subject, email, now);
  return { ok: true, account: created.account };
}

export async function unlinkOAuthProvider(
  accountId: string,
  provider: OAuthProviderId,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const account = await getAccountById(accountId);
  if (!account) return { ok: false, status: 404, error: "Account not found." };
  const links = await linksForAccount(accountId);
  const link = links.find((item) => item.provider === provider);
  if (!link) return { ok: false, status: 404, error: "Provider is not linked." };
  const remaining = links.filter((item) => item.provider !== provider);
  if (!passwordSignInAvailable(account) && remaining.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Cannot unlink the only sign-in method.",
    };
  }
  await storeDel(linkKey(provider, link.subject));
  await writeLinks(accountId, remaining);
  return { ok: true };
}
