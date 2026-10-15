import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { preparePasswordClaim, resetMemoryAccounts } from "./accounts.js";
import { memoryUniverseLoaded, resetMemoryUniverse } from "./store.js";

describe("health", () => {
  beforeEach(() => {
    resetMemoryUniverse();
  });

  it("does not load or tick the universe", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const body = (await res.json()) as {
      ok: boolean;
      storage: string;
      auth: { passwordAuth: boolean };
    };
    assert.equal(body.ok, true);
    assert.equal(body.storage, "memory");
    assert.equal(body.auth.passwordAuth, true);
    assert.equal(memoryUniverseLoaded(), false);
  });
});

describe("auth email+password routes (memory)", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.CLAIM_MAIL_URL;
    delete process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_RUNTIME;
  });

  it("signup sets session cookie and auth/me resumes player after join", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "commander@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(signup.status, 200);
    const setCookie = signup.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("starhold_session="));
    const cookie = setCookie.split(";")[0]!;
    const signupBody = (await signup.json()) as {
      account: { email: string; playerId: string | null };
    };
    assert.equal(signupBody.account.email, "commander@example.com");
    assert.equal(signupBody.account.playerId, null);

    const me1 = await app.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    const meBody1 = (await me1.json()) as {
      account: { email: string; playerId: string | null };
      view: null;
    };
    assert.equal(meBody1.account.email, "commander@example.com");
    assert.equal(meBody1.account.playerId, null);

    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "CookiePilot" }),
    });
    assert.equal(join.status, 200);
    const view = (await join.json()) as { player: { id: string; name: string } };
    assert.equal(view.player.name, "CookiePilot");

    const me2 = await app.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    const meBody2 = (await me2.json()) as {
      account: { playerId: string | null };
      view: { player: { id: string } } | null;
    };
    assert.equal(meBody2.account.playerId, view.player.id);
    assert.equal(meBody2.view?.player.id, view.player.id);

    // Login again with password resumes the same commander via cookie.
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "commander@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(login.status, 200);
    const loginCookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const loginBody = (await login.json()) as {
      account: { playerId: string | null };
      view: { player: { id: string } } | null;
    };
    assert.equal(loginBody.account.playerId, view.player.id);
    assert.equal(loginBody.view?.player.id, view.player.id);

    const me3 = await app.request("/api/auth/me", {
      headers: { Cookie: loginCookie },
    });
    const meBody3 = (await me3.json()) as {
      view: { player: { id: string } } | null;
    };
    assert.equal(meBody3.view?.player.id, view.player.id);
  });

  it("rejects bad password and duplicate signup", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@example.com",
        password: "password1",
      }),
    });
    assert.equal(signup.status, 200);

    const again = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@example.com",
        password: "password2",
      }),
    });
    assert.equal(again.status, 409);

    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@example.com",
        password: "wrongpass",
      }),
    });
    assert.equal(bad.status, 401);
  });

  it("claims anonymous playerId on signup", async () => {
    const app = createApp();
    const guest = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "GuestClaim" }),
    });
    const guestView = (await guest.json()) as { player: { id: string } };

    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "claim@example.com",
        password: "claimpass",
        claimPlayerId: guestView.player.id,
      }),
    });
    assert.equal(signup.status, 200);
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    const body = (await me.json()) as {
      account: { playerId: string | null };
      view: { player: { id: string; accountId?: string | null } } | null;
    };
    assert.equal(body.account.playerId, guestView.player.id);
    assert.equal(body.view?.player.id, guestView.player.id);
    assert.ok(body.view?.player.accountId);
  });

  it("sets a new password from a claim code without echoing the code", async () => {
    const app = createApp();
    const hidden = await app.request("/api/e2e/prepare-password-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.com" }),
    });
    assert.equal(hidden.status, 404);

    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset@example.com",
        password: "old-password",
      }),
    });
    assert.equal(signup.status, 200);

    const prepared = await preparePasswordClaim("reset@example.com");
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const ask = await app.request("/api/auth/claim-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.com" }),
    });
    assert.equal(ask.status, 200);
    const askBody = (await ask.json()) as { message?: string; code?: string };
    assert.equal(askBody.code, undefined);
    assert.match(askBody.message ?? "", /claim code you were given/);

    const oldLogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset@example.com",
        password: "old-password",
      }),
    });
    assert.equal(oldLogin.status, 401);

    const set = await app.request("/api/auth/claim-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset@example.com",
        code: prepared.code,
        password: "new-password",
      }),
    });
    assert.equal(set.status, 200);
    const cookie = (set.headers.get("set-cookie") ?? "").split(";")[0]!;
    assert.ok(cookie.includes("starhold_session="));
    const me = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    const meBody = (await me.json()) as { account: { email: string } | null };
    assert.equal(meBody.account?.email, "reset@example.com");

    const reused = await app.request("/api/auth/claim-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset@example.com",
        code: prepared.code,
        password: "another-password",
      }),
    });
    assert.equal(reused.status, 401);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset@example.com",
        password: "new-password",
      }),
    });
    assert.equal(login.status, 200);
  });

  it("requires SESSION_SECRET on Vercel", async () => {
    process.env.VERCEL = "1";
    delete process.env.SESSION_SECRET;
    const app = createApp();
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "prod@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes("SESSION_SECRET"));
  });
});
