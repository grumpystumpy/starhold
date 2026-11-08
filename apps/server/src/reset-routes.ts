import type { Hono } from "hono";
import {
  checkAuthRateLimit,
  clientIp,
  getAccountByEmail,
  getAccountById,
  hashPassword,
  hashToken,
  isValidEmail,
  isValidPassword,
  newToken,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  requireSessionSecret,
  updateAccount,
} from "./accounts.js";
import {
  emailResetEnabled,
  lastMockEmail,
  mockEmailAllowed,
  RESET_TOKEN_TTL_MS,
  sendPasswordResetEmail,
} from "./email.js";
import { getKvClient } from "./store.js";

export const RESET_REQUEST_BODY = {
  ok: true as const,
  message: "If that email has an account, a reset link is on its way.",
};

const RESET_INVALID = "Reset link is invalid or expired.";

const memResetIndex = new Map<string, string>();

function resetIndexKey(hash: string): string {
  return `starhold:reset:${hash}`;
}

export function resetPasswordResetIndex(): void {
  memResetIndex.clear();
}

async function putResetIndex(hash: string, accountId: string): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memResetIndex.set(hash, accountId);
    return;
  }
  await client.set(resetIndexKey(hash), accountId, {
    exSec: Math.ceil(RESET_TOKEN_TTL_MS / 1000),
  });
}

async function takeResetIndex(hash: string): Promise<string | null> {
  const client = getKvClient();
  if (!client) return memResetIndex.get(hash) ?? null;
  return client.get<string>(resetIndexKey(hash));
}

async function deleteResetIndex(hash: string): Promise<void> {
  const client = getKvClient();
  if (!client) {
    memResetIndex.delete(hash);
    return;
  }
  await client.del(resetIndexKey(hash));
}

/** Mount email reset next to the other auth routes. Off until a provider is set. */
export function mountResetRoutes(app: Hono): void {
  app.post("/api/auth/reset/request", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const email = normalizeEmail(body.email ?? "");
    const rate = await checkAuthRateLimit(
      "reset",
      email || "unknown",
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many reset attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }

    if (!emailResetEnabled() || !isValidEmail(email)) {
      return c.json(RESET_REQUEST_BODY);
    }

    const account = await getAccountByEmail(email);
    if (!account) return c.json(RESET_REQUEST_BODY);

    const token = newToken(32);
    const hash = hashToken(token);
    const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
    if (account.resetTokenHash) await deleteResetIndex(account.resetTokenHash);
    const updated = await updateAccount(account.id, (row) => {
      row.resetTokenHash = hash;
      row.resetTokenExpiresAt = expiresAt;
    });
    if (!updated) return c.json(RESET_REQUEST_BODY);
    await putResetIndex(hash, account.id);
    try {
      await sendPasswordResetEmail(account.email, token);
    } catch (err) {
      console.error("[starhold-email]", err);
    }
    return c.json(RESET_REQUEST_BODY);
  });

  app.post("/api/auth/reset/confirm", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    if (!emailResetEnabled()) {
      return c.json({ error: "Email reset is not configured." }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      newPassword?: string;
    };
    const token = body.token?.trim() ?? "";
    const newPassword = body.newPassword ?? "";
    const rate = await checkAuthRateLimit(
      "reset",
      "confirm",
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many reset attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }
    if (!isValidPassword(newPassword)) {
      return c.json(
        { error: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` },
        400,
      );
    }
    if (!token) return c.json({ error: RESET_INVALID }, 400);

    const hash = hashToken(token);
    const accountId = await takeResetIndex(hash);
    const account = accountId ? await getAccountById(accountId) : null;
    const expired =
      !account ||
      account.resetTokenHash !== hash ||
      (account.resetTokenExpiresAt ?? 0) <= Date.now();
    if (!account || expired) {
      if (hash) await deleteResetIndex(hash);
      return c.json({ error: RESET_INVALID }, 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await updateAccount(account.id, (row) => {
      row.passwordHash = passwordHash;
      row.sessionEpoch = (row.sessionEpoch ?? 0) + 1;
      row.lastLoginAt = Date.now();
      delete row.resetTokenHash;
      delete row.resetTokenExpiresAt;
      delete row.needsPasswordReset;
    });
    await deleteResetIndex(hash);
    if (!updated) return c.json({ error: RESET_INVALID }, 400);
    return c.json({ ok: true });
  });

  app.get("/api/auth/reset/mock", (c) => {
    if (!mockEmailAllowed()) return c.json({ error: "Not found" }, 404);
    const message = lastMockEmail();
    if (!message) return c.json({ error: "Not found" }, 404);
    return c.json(message);
  });
}
