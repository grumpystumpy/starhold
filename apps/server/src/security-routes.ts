import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  accountHasPassword,
  checkAuthRateLimit,
  clientIp,
  createSession,
  deleteSession,
  getAccountByEmail,
  getAccountById,
  getSession,
  hashPassword,
  hashToken,
  isValidPassword,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  requireSessionSecret,
  updateAccount,
  verifyPassword,
  type AccountRecord,
} from "./accounts.js";
import { readSessionId, setSessionCookie } from "./cookies.js";

const RECOVER_ERROR = "Invalid email or recovery code.";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function canonicalRecoveryCode(raw: string): string | null {
  const compact = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function newRecoveryCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! & 31];
    if (i === 3) out += "-";
  }
  return out;
}

function publicAccount(account: AccountRecord) {
  return {
    id: account.id,
    email: account.email,
    playerId: account.playerId,
  };
}

async function sessionAccount(c: Context): Promise<{
  sessionId: string;
  account: AccountRecord;
} | null> {
  const sessionId = readSessionId(c);
  if (!sessionId) return null;
  const session = await getSession(sessionId);
  if (!session) return null;
  const account = await getAccountById(session.accountId);
  if (!account) return null;
  return { sessionId, account };
}

async function reissue(c: Context, accountId: string): Promise<void> {
  const session = await createSession(accountId);
  setSessionCookie(c, session.id);
}

export function mountSecurityRoutes(app: Hono): void {
  app.get("/api/account/security", async (c) => {
    const ctx = await sessionAccount(c);
    if (!ctx) return c.json({ error: "Sign in required." }, 401);
    const { account } = ctx;
    return c.json({
      email: account.email,
      hasPassword: accountHasPassword(account),
      recoveryCodesRemaining: account.recoveryCodeHashes?.length ?? 0,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
    });
  });

  app.post("/api/account/password", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    const ctx = await sessionAccount(c);
    if (!ctx) return c.json({ error: "Sign in required." }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      current?: string;
      next?: string;
    };
    const current = body.current ?? "";
    const next = body.next ?? "";
    const rate = await checkAuthRateLimit(
      "password",
      ctx.account.email,
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many password attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }
    if (!isValidPassword(next)) {
      return c.json(
        { error: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` },
        400,
      );
    }
    const match = await verifyPassword(current, ctx.account.passwordHash);
    if (!match) return c.json({ error: "Current password is incorrect." }, 403);

    const passwordHash = await hashPassword(next);
    const updated = await updateAccount(ctx.account.id, (account) => {
      account.passwordHash = passwordHash;
      account.sessionEpoch = (account.sessionEpoch ?? 0) + 1;
      account.lastLoginAt = Date.now();
    });
    if (!updated) return c.json({ error: "Sign in required." }, 401);
    await deleteSession(ctx.sessionId);
    await reissue(c, updated.id);
    return c.json({ ok: true });
  });

  app.post("/api/account/sessions/revoke-others", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    const ctx = await sessionAccount(c);
    if (!ctx) return c.json({ error: "Sign in required." }, 401);
    const updated = await updateAccount(ctx.account.id, (account) => {
      account.sessionEpoch = (account.sessionEpoch ?? 0) + 1;
    });
    if (!updated) return c.json({ error: "Sign in required." }, 401);
    await deleteSession(ctx.sessionId);
    await reissue(c, updated.id);
    return c.json({ ok: true });
  });

  app.post("/api/account/recovery-codes", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    const ctx = await sessionAccount(c);
    if (!ctx) return c.json({ error: "Sign in required." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { current?: string };
    const current = body.current ?? "";
    const match = await verifyPassword(current, ctx.account.passwordHash);
    if (!match) return c.json({ error: "Current password is incorrect." }, 403);

    const codes: string[] = [];
    const seen = new Set<string>();
    while (codes.length < 10) {
      const code = newRecoveryCode();
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
    const hashes = codes.map((code) => hashToken(code));
    const updated = await updateAccount(ctx.account.id, (account) => {
      account.recoveryCodeHashes = hashes;
    });
    if (!updated) return c.json({ error: "Sign in required." }, 401);
    return c.json({
      ok: true,
      codes,
      recoveryCodesRemaining: hashes.length,
    });
  });

  app.post("/api/auth/recover", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
      next?: string;
    };
    const email = normalizeEmail(body.email ?? "");
    const next = body.next ?? "";
    const rate = await checkAuthRateLimit(
      "recover",
      email || "unknown",
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many recovery attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }
    if (!isValidPassword(next)) {
      return c.json(
        { error: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` },
        400,
      );
    }
    const canonical = canonicalRecoveryCode(body.code ?? "");
    const account = email ? await getAccountByEmail(email) : null;
    const codeHash = canonical ? hashToken(canonical) : "";
    const hashes = account?.recoveryCodeHashes ?? [];
    const index = codeHash ? hashes.indexOf(codeHash) : -1;
    if (!account || index < 0) {
      return c.json({ error: RECOVER_ERROR }, 401);
    }
    const passwordHash = await hashPassword(next);
    const remaining = hashes.filter((_, i) => i !== index);
    const updated = await updateAccount(account.id, (row) => {
      row.passwordHash = passwordHash;
      row.recoveryCodeHashes = remaining;
      row.sessionEpoch = (row.sessionEpoch ?? 0) + 1;
      row.lastLoginAt = Date.now();
      delete row.needsPasswordReset;
    });
    if (!updated) return c.json({ error: RECOVER_ERROR }, 401);
    const session = await createSession(updated.id);
    setSessionCookie(c, session.id);
    return c.json({ ok: true, account: publicAccount(updated) });
  });
}
