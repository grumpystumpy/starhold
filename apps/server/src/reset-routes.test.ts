import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import {
  AUTH_RATE_MAX,
  authenticateEmailPassword,
  getAccountByEmail,
  getSession,
  resetMemoryAccounts,
  updateAccount,
} from "./accounts.js";
import { lastMockEmail, resetMockMailbox } from "./email.js";
import { RESET_REQUEST_BODY, resetPasswordResetIndex } from "./reset-routes.js";
import { resetMemoryUniverse } from "./store.js";

const GENERIC = RESET_REQUEST_BODY;

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/starhold_session=[^;]+/);
  assert.ok(match, `session cookie missing: ${raw}`);
  return match![0];
}

function tokenFrom(text: string): string {
  const match = text.match(/[?&]reset=([^&\s]+)/);
  assert.ok(match, `reset link missing: ${text}`);
  return decodeURIComponent(match![1]!);
}

async function signup(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return cookieFrom(res);
}

async function requestReset(app: ReturnType<typeof createApp>, email: string) {
  return app.request("/api/auth/reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function confirmReset(
  app: ReturnType<typeof createApp>,
  token: string,
  newPassword: string,
) {
  return app.request("/api/auth/reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
}

describe("email password reset", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    resetMockMailbox();
    resetPasswordResetIndex();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_PASSWORD_KDF;
    delete process.env.EMAIL_MOCK;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.PUBLIC_URL;
  });

  it("stays disabled when no provider is configured", async () => {
    const app = createApp();
    const listed = await app.request("/api/auth/providers");
    const providers = (await listed.json()) as { emailReset?: boolean };
    assert.equal(providers.emailReset, false);
    await signup(app, "off@starhold.test", "hunter2xx");
    const res = await requestReset(app, "off@starhold.test");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), GENERIC);
    const account = await getAccountByEmail("off@starhold.test");
    assert.equal(account?.resetTokenHash, undefined);
    assert.equal(lastMockEmail(), null);
    const mock = await app.request("/api/auth/reset/mock");
    assert.equal(mock.status, 404);
    const confirm = await confirmReset(app, "no-token", "new-secret");
    assert.equal(confirm.status, 404);
  });

  it("refuses the mock transport on Workers unless e2e is set", async () => {
    process.env.EMAIL_MOCK = "1";
    process.env.STARHOLD_RUNTIME = "workers";
    const app = createApp();
    const hidden = await app.request("/api/auth/providers");
    assert.equal(((await hidden.json()) as { emailReset: boolean }).emailReset, false);
    process.env.STARHOLD_E2E = "1";
    const shown = await app.request("/api/auth/providers");
    assert.equal(((await shown.json()) as { emailReset: boolean }).emailReset, true);
  });

  it("returns the same body for known and unknown emails", async () => {
    process.env.EMAIL_MOCK = "1";
    process.env.PUBLIC_URL = "https://starhold.stumpysgarage.workers.dev";
    const app = createApp();
    await signup(app, "known@starhold.test", "hunter2xx");
    const known = await requestReset(app, "known@starhold.test");
    const unknown = await requestReset(app, "missing@starhold.test");
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), GENERIC);
    assert.deepEqual(await unknown.json(), GENERIC);
    const mail = lastMockEmail();
    assert.equal(mail?.to, "known@starhold.test");
    assert.match(mail?.text ?? "", /https:\/\/starhold\.stumpysgarage\.workers\.dev\/\?reset=/);
    const account = await getAccountByEmail("known@starhold.test");
    assert.equal(typeof account?.resetTokenHash, "string");
    assert.ok((account?.resetTokenExpiresAt ?? 0) > Date.now());
  });

  it("expires, works once, and bumps the epoch so old sessions die", async () => {
    process.env.EMAIL_MOCK = "1";
    const app = createApp();
    const cookie = await signup(app, "reset@starhold.test", "hunter2xx");
    const other = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@starhold.test", password: "hunter2xx" }),
    });
    const otherCookie = cookieFrom(other);
    const sessionId = otherCookie.split("=")[1] ?? "";
    assert.ok(await getSession(sessionId));

    const first = await requestReset(app, "reset@starhold.test");
    assert.equal(first.status, 200);
    const expiredToken = tokenFrom(lastMockEmail()?.text ?? "");
    const account = await getAccountByEmail("reset@starhold.test");
    assert.ok(account);
    await updateAccount(account.id, (row) => {
      row.resetTokenExpiresAt = Date.now() - 1_000;
    });
    const expired = await confirmReset(app, expiredToken, "new-secret");
    assert.equal(expired.status, 400);
    assert.equal((await authenticateEmailPassword("reset@starhold.test", "hunter2xx")).ok, true);

    const again = await requestReset(app, "reset@starhold.test");
    assert.equal(again.status, 200);
    const token = tokenFrom(lastMockEmail()?.text ?? "");
    const ok = await confirmReset(app, token, "new-secret");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const replay = await confirmReset(app, token, "another-secret");
    assert.equal(replay.status, 400);

    const stale = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(stale.status, 401);
    const otherStale = await app.request("/api/auth/me", { headers: { Cookie: otherCookie } });
    assert.equal(otherStale.status, 401);
    assert.equal(await getSession(sessionId), null);
    assert.equal((await authenticateEmailPassword("reset@starhold.test", "hunter2xx")).ok, false);
    assert.equal((await authenticateEmailPassword("reset@starhold.test", "new-secret")).ok, true);
    const fresh = await getAccountByEmail("reset@starhold.test");
    assert.equal(fresh?.resetTokenHash, undefined);
    assert.ok((fresh?.sessionEpoch ?? 0) >= 1);
  });

  it("rate-limits reset requests per email", async () => {
    process.env.EMAIL_MOCK = "1";
    const app = createApp();
    await signup(app, "limit@starhold.test", "hunter2xx");
    for (let i = 0; i < AUTH_RATE_MAX; i++) {
      const res = await requestReset(app, "limit@starhold.test");
      assert.equal(res.status, 200);
    }
    const blocked = await requestReset(app, "limit@starhold.test");
    assert.equal(blocked.status, 429);
  });

  it("posts the reset link through Resend when that provider is set", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Starhold <reset@example.com>";
    process.env.PUBLIC_URL = "https://starhold.stumpysgarage.workers.dev";
    const original = globalThis.fetch;
    let captured: { url: string; auth: string; body: { from?: string; to?: string[]; text?: string } } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      captured = {
        url: String(url),
        auth: headers?.Authorization ?? "",
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const app = createApp();
      await signup(app, "resend@starhold.test", "hunter2xx");
      const res = await requestReset(app, "resend@starhold.test");
      assert.equal(res.status, 200);
      assert.equal(captured?.url, "https://api.resend.com/emails");
      assert.equal(captured?.auth, "Bearer re_test_key");
      assert.equal(captured?.body.from, "Starhold <reset@example.com>");
      assert.deepEqual(captured?.body.to, ["resend@starhold.test"]);
      assert.match(captured?.body.text ?? "", /starhold\.stumpysgarage\.workers\.dev\/\?reset=/);
      assert.equal(lastMockEmail(), null);
    } finally {
      globalThis.fetch = original;
    }
  });
});
