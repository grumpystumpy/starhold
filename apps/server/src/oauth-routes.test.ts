import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import {
  authenticateEmailPassword,
  getAccountByEmail,
  resetMemoryAccounts,
} from "./accounts.js";
import {
  OAUTH_PASSWORD_MARKER,
  expireOAuthStatesForTests,
  resetOAuthMemory,
} from "./oauth.js";
import { resetMemoryUniverse } from "./store.js";

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/starhold_session=[^;]+/);
  assert.ok(match, `session cookie missing: ${raw}`);
  return match![0];
}

async function follow(app: ReturnType<typeof createApp>, res: Response): Promise<Response> {
  const loc = res.headers.get("location");
  assert.ok(loc, "redirect location missing");
  return app.request(loc!);
}

async function mockSignIn(
  app: ReturnType<typeof createApp>,
  email: string,
  sub: string,
  cookie?: string,
): Promise<Response> {
  const start = await app.request(
    `/api/auth/oauth/mock/start?email=${encodeURIComponent(email)}&sub=${encodeURIComponent(sub)}`,
    { headers: cookie ? { Cookie: cookie } : {} },
  );
  assert.equal(start.status, 302);
  const authorize = await follow(app, start);
  assert.equal(authorize.status, 302);
  assert.match(authorize.headers.get("location") ?? "", /\/api\/auth\/oauth\/mock\/callback/);
  return follow(app, authorize);
}

describe("oauth routes", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    resetOAuthMemory();
    delete process.env.OAUTH_MOCK;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_PASSWORD_KDF;
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.APP_URL;
  });

  it("lists no providers when OAuth env is unset", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/providers");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { providers: string[]; passwordAuth: boolean };
    assert.deepEqual(body.providers, []);
    assert.equal(body.passwordAuth, true);
  });

  it("returns 404 when a provider is not configured", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/oauth/google/start");
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "provider not configured");
  });

  it("refuses the mock provider on Workers unless e2e is set", async () => {
    process.env.OAUTH_MOCK = "1";
    process.env.STARHOLD_RUNTIME = "workers";
    const app = createApp();
    const hidden = await app.request("/api/auth/providers");
    const hiddenBody = (await hidden.json()) as { providers: string[] };
    assert.deepEqual(hiddenBody.providers, []);
    const start = await app.request("/api/auth/oauth/mock/start");
    assert.equal(start.status, 404);

    process.env.STARHOLD_E2E = "1";
    const shown = await app.request("/api/auth/providers");
    const shownBody = (await shown.json()) as { providers: string[] };
    assert.deepEqual(shownBody.providers, ["mock"]);
  });

  it("sends Google to the authorize URL with a S256 challenge", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    const app = createApp();
    const listed = await app.request("/api/auth/providers");
    const listedBody = (await listed.json()) as { providers: string[] };
    assert.deepEqual(listedBody.providers, ["google"]);
    const start = await app.request("/api/auth/oauth/google/start");
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get("location") ?? "http://invalid");
    assert.equal(loc.origin, "https://accounts.google.com");
    assert.equal(loc.pathname, "/o/oauth2/v2/auth");
    assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
    assert.ok(loc.searchParams.get("code_challenge"));
    assert.equal(loc.searchParams.get("client_id"), "google-client");
    assert.match(loc.searchParams.get("redirect_uri") ?? "", /\/api\/auth\/oauth\/google\/callback$/);
  });

  it("uses OAuth state once and rejects an expired state", async () => {
    process.env.OAUTH_MOCK = "1";
    const app = createApp();
    const start = await app.request(
      "/api/auth/oauth/mock/start?email=once@starhold.test&sub=sub-once",
    );
    assert.equal(start.status, 302);
    const authorize = await follow(app, start);
    const callbackUrl = new URL(authorize.headers.get("location") ?? "http://invalid");
    const path = `${callbackUrl.pathname}${callbackUrl.search}`;
    const first = await app.request(path);
    assert.equal(first.status, 302);
    const second = await app.request(path);
    assert.equal(second.status, 400);
    const secondBody = (await second.json()) as { error: string };
    assert.match(secondBody.error, /expired or already used/);

    const startAgain = await app.request(
      "/api/auth/oauth/mock/start?email=expire@starhold.test&sub=sub-expire",
    );
    const authorizeAgain = await follow(app, startAgain);
    const expiredUrl = new URL(authorizeAgain.headers.get("location") ?? "http://invalid");
    expireOAuthStatesForTests();
    const expired = await app.request(`${expiredUrl.pathname}${expiredUrl.search}`);
    assert.equal(expired.status, 400);
    const body = (await expired.json()) as { error: string };
    assert.match(body.error, /expired or already used/);
    assert.equal(expired.headers.get("set-cookie"), null);
  });

  it("creates an account on mock sign-in and reuses the link", async () => {
    process.env.OAUTH_MOCK = "1";
    const app = createApp();
    const first = await mockSignIn(app, "Pilot@Starhold.test", "sub-reuse");
    assert.equal(first.status, 302);
    assert.match(first.headers.get("location") ?? "", /\/$/);
    const cookie = cookieFrom(first);
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { account: { id: string; email: string } };
    assert.equal(meBody.account.email, "pilot@starhold.test");

    const stored = await getAccountByEmail("pilot@starhold.test");
    assert.equal(stored?.passwordHash, OAUTH_PASSWORD_MARKER);
    const password = await authenticateEmailPassword("pilot@starhold.test", "not-the-password");
    assert.equal(password.ok, false);

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);

    const second = await mockSignIn(app, "pilot@starhold.test", "sub-reuse");
    assert.equal(second.status, 302);
    const me2 = await app.request("/api/auth/me", { headers: { Cookie: cookieFrom(second) } });
    const me2Body = (await me2.json()) as { account: { id: string } };
    assert.equal(me2Body.account.id, meBody.account.id);
  });

  it("refuses to take over a password account when signed out", async () => {
    process.env.OAUTH_MOCK = "1";
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@starhold.test", password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);

    const callback = await mockSignIn(app, "ada@starhold.test", "sub-takeover");
    assert.equal(callback.status, 409);
    const body = (await callback.json()) as { error: string };
    assert.match(body.error, /already exists/);
    assert.equal(callback.headers.get("set-cookie"), null);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@starhold.test", password: "hunter2xx" }),
    });
    assert.equal(login.status, 200);
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookieFrom(login) } });
    const meBody = (await me.json()) as { account: { email: string } };
    assert.equal(meBody.account.email, "ada@starhold.test");
  });

  it("links a provider for the signed-in account and unlinks it", async () => {
    process.env.OAUTH_MOCK = "1";
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "link@starhold.test", password: "hunter2xx" }),
    });
    const cookie = cookieFrom(signup);
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    const accountId = ((await me.json()) as { account: { id: string } }).account.id;

    const callback = await mockSignIn(app, "link@starhold.test", "sub-link", cookie);
    assert.equal(callback.status, 302);
    const linkedCookie = cookieFrom(callback);
    const linked = await app.request("/api/auth/me", { headers: { Cookie: linkedCookie } });
    const linkedBody = (await linked.json()) as { account: { id: string } };
    assert.equal(linkedBody.account.id, accountId);

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: linkedCookie },
    });
    assert.equal(logout.status, 200);
    const reused = await mockSignIn(app, "link@starhold.test", "sub-link");
    assert.equal(reused.status, 302);
    const reusedMe = await app.request("/api/auth/me", {
      headers: { Cookie: cookieFrom(reused) },
    });
    const reusedBody = (await reusedMe.json()) as { account: { id: string } };
    assert.equal(reusedBody.account.id, accountId);

    const unlink = await app.request("/api/auth/oauth/mock/unlink", {
      method: "POST",
      headers: { Cookie: cookieFrom(reused) },
    });
    assert.equal(unlink.status, 200);

    const again = await mockSignIn(app, "other@starhold.test", "sub-link");
    assert.equal(again.status, 302);
    const againMe = await app.request("/api/auth/me", {
      headers: { Cookie: cookieFrom(again) },
    });
    const againBody = (await againMe.json()) as { account: { id: string } };
    assert.notEqual(againBody.account.id, accountId);
  });

  it("refuses to unlink the only sign-in method", async () => {
    process.env.OAUTH_MOCK = "1";
    const app = createApp();
    const callback = await mockSignIn(app, "only@starhold.test", "sub-only");
    const cookie = cookieFrom(callback);
    const anon = await app.request("/api/auth/oauth/mock/unlink", { method: "POST" });
    assert.equal(anon.status, 401);
    const unlink = await app.request("/api/auth/oauth/mock/unlink", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(unlink.status, 409);
    const body = (await unlink.json()) as { error: string };
    assert.match(body.error, /only sign-in method/);
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
  });

  it("keeps password signup, login, and me unchanged", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pass@starhold.test", password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);
    const signupBody = (await signup.json()) as {
      ok: boolean;
      account: { email: string; playerId: string | null };
      view: null;
    };
    assert.equal(signupBody.ok, true);
    assert.equal(signupBody.account.email, "pass@starhold.test");
    assert.equal(signupBody.account.playerId, null);
    assert.equal(signupBody.view, null);
    const cookie = cookieFrom(signup);

    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { account: { email: string } | null };
    assert.equal(meBody.account?.email, "pass@starhold.test");

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pass@starhold.test", password: "hunter2xx" }),
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { ok: boolean; account: { email: string } };
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.account.email, "pass@starhold.test");
  });
});
