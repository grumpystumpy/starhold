import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import {
  AUTH_RATE_MAX,
  authenticateEmailPassword,
  createAccountWithPassword,
  createSession,
  getAccountByEmail,
  getSession,
  hashToken,
  resetMemoryAccounts,
} from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/starhold_session=[^;]+/);
  assert.ok(match, `session cookie missing: ${raw}`);
  return match![0];
}

async function signup(
  app: ReturnType<typeof createApp>,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return cookieFrom(res);
}

describe("account security", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.STARHOLD_PASSWORD_KDF;
  });

  it("rejects a wrong current password and rotates the password and other sessions", async () => {
    const app = createApp();
    const cookie = await signup(app, "sec@starhold.test", "hunter2xx");
    const other = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sec@starhold.test", password: "hunter2xx" }),
    });
    assert.equal(other.status, 200);
    const otherCookie = cookieFrom(other);

    const bad = await app.request("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ current: "wrong-pass", next: "new-secret" }),
    });
    assert.equal(bad.status, 403);

    const changed = await app.request("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ current: "hunter2xx", next: "new-secret" }),
    });
    assert.equal(changed.status, 200);
    const current = cookieFrom(changed);

    const oldLogin = await authenticateEmailPassword("sec@starhold.test", "hunter2xx");
    assert.equal(oldLogin.ok, false);
    const newLogin = await authenticateEmailPassword("sec@starhold.test", "new-secret");
    assert.equal(newLogin.ok, true);

    const stale = await app.request("/api/auth/me", { headers: { Cookie: otherCookie } });
    assert.equal(stale.status, 401);
    const mine = await app.request("/api/auth/me", { headers: { Cookie: current } });
    assert.equal(mine.status, 200);
    const mineBody = (await mine.json()) as { account: { email: string } | null };
    assert.equal(mineBody.account?.email, "sec@starhold.test");
  });

  it("signs out every session except the one that asked", async () => {
    const app = createApp();
    const cookie = await signup(app, "revoke@starhold.test", "hunter2xx");
    const other = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "revoke@starhold.test", password: "hunter2xx" }),
    });
    const otherCookie = cookieFrom(other);
    const revoked = await app.request("/api/account/sessions/revoke-others", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(revoked.status, 200);
    const kept = cookieFrom(revoked);
    assert.equal((await app.request("/api/auth/me", { headers: { Cookie: otherCookie } })).status, 401);
    const me = await app.request("/api/auth/me", { headers: { Cookie: kept } });
    assert.equal(me.status, 200);
  });

  it("stores recovery codes hashed, single-use, and drops them on regenerate", async () => {
    const app = createApp();
    const cookie = await signup(app, "codes@starhold.test", "hunter2xx");
    const minted = await app.request("/api/account/recovery-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ current: "hunter2xx" }),
    });
    assert.equal(minted.status, 200);
    const mintedBody = (await minted.json()) as { codes: string[]; recoveryCodesRemaining: number };
    assert.equal(mintedBody.codes.length, 10);
    assert.equal(mintedBody.recoveryCodesRemaining, 10);
    for (const code of mintedBody.codes) {
      assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
    const stored = await getAccountByEmail("codes@starhold.test");
    assert.equal(stored?.recoveryCodeHashes?.length, 10);
    for (const code of mintedBody.codes) {
      assert.equal(stored?.recoveryCodeHashes?.includes(code), false);
      assert.equal(stored?.recoveryCodeHashes?.includes(hashToken(code)), true);
    }

    const status = await app.request("/api/account/security", { headers: { Cookie: cookie } });
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      email: string;
      hasPassword: boolean;
      recoveryCodesRemaining: number;
    };
    assert.equal(statusBody.email, "codes@starhold.test");
    assert.equal(statusBody.hasPassword, true);
    assert.equal(statusBody.recoveryCodesRemaining, 10);

    const first = mintedBody.codes[0]!;
    const used = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "codes@starhold.test", code: first.toLowerCase(), next: "after-code" }),
    });
    assert.equal(used.status, 200);
    assert.ok(cookieFrom(used).includes("starhold_session="));
    const again = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "codes@starhold.test", code: first, next: "another-one" }),
    });
    assert.equal(again.status, 401);
    const againBody = (await again.json()) as { error: string };
    assert.equal(againBody.error, "Invalid email or recovery code.");

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "codes@starhold.test", password: "after-code" }),
    });
    const fresh = cookieFrom(login);
    const reminted = await app.request("/api/account/recovery-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fresh },
      body: JSON.stringify({ current: "after-code" }),
    });
    const remintedBody = (await reminted.json()) as { codes: string[] };
    assert.equal(reminted.status, 200);
    const staleCode = mintedBody.codes[1]!;
    const stale = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "codes@starhold.test", code: staleCode, next: "nope-nope" }),
    });
    assert.equal(stale.status, 401);
    const freshCode = remintedBody.codes[0]!;
    const ok = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "codes@starhold.test", code: freshCode, next: "brand-new1" }),
    });
    assert.equal(ok.status, 200);
    const signedIn = await authenticateEmailPassword("codes@starhold.test", "brand-new1");
    assert.equal(signedIn.ok, true);
  });

  it("clears needsPasswordReset and uses one error for unknown email or code", async () => {
    const app = createApp();
    const cookie = await signup(app, "reset@starhold.test", "hunter2xx");
    const minted = await app.request("/api/account/recovery-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ current: "hunter2xx" }),
    });
    const code = ((await minted.json()) as { codes: string[] }).codes[0]!;
    const account = await getAccountByEmail("reset@starhold.test");
    assert.ok(account);
    account!.passwordHash = "";
    account!.needsPasswordReset = true;

    const missing = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@starhold.test", code: "ABCD-EFGH", next: "replacement" }),
    });
    const bad = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@starhold.test", code: "ZZZZ-ZZZZ", next: "replacement" }),
    });
    assert.equal(missing.status, 401);
    assert.equal(bad.status, 401);
    const missingBody = (await missing.json()) as { error: string };
    const badBody = (await bad.json()) as { error: string };
    assert.equal(missingBody.error, badBody.error);

    const recovered = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@starhold.test", code, next: "replacement" }),
    });
    assert.equal(recovered.status, 200);
    const after = await getAccountByEmail("reset@starhold.test");
    assert.equal(after?.needsPasswordReset, undefined);
    const login = await authenticateEmailPassword("reset@starhold.test", "replacement");
    assert.equal(login.ok, true);
  });

  it("rate-limits recovery attempts", async () => {
    const app = createApp();
    for (let i = 0; i < AUTH_RATE_MAX; i++) {
      const res = await app.request("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "rate@starhold.test",
          code: "ABCD-EFGH",
          next: "longenough",
        }),
      });
      assert.equal(res.status, 401);
    }
    const blocked = await app.request("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rate@starhold.test",
        code: "ABCD-EFGH",
        next: "longenough",
      }),
    });
    assert.equal(blocked.status, 429);
  });

  it("authenticates a legacy account and session that have no epoch fields", async () => {
    const created = await createAccountWithPassword("legacy@starhold.test", "hunter2xx");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    delete created.account.sessionEpoch;
    delete created.account.recoveryCodeHashes;
    const session = await createSession(created.account.id);
    delete session.epoch;
    const found = await getSession(session.id);
    assert.equal(found?.accountId, created.account.id);
    assert.equal(found?.epoch, undefined);
    const login = await authenticateEmailPassword("legacy@starhold.test", "hunter2xx");
    assert.equal(login.ok, true);

    const app = createApp();
    const me = await app.request("/api/auth/me", {
      headers: { Cookie: `starhold_session=${encodeURIComponent(session.id)}` },
    });
    assert.equal(me.status, 200);
    const body = (await me.json()) as { account: { email: string } | null };
    assert.equal(body.account?.email, "legacy@starhold.test");
  });
});
