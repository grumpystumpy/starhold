import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { getAccountByEmail, resetMemoryAccounts } from "./accounts.js";
import { memoryUniverseLoaded, resetMemoryUniverse, setUniverseFaultForTests } from "./store.js";

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
    setUniverseFaultForTests(null);
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

  it("removes claim-code routes and directs reset accounts to an admin", async () => {
    const app = createApp();
    for (const path of ["/api/auth/claim-code", "/api/auth/claim-password"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "reset@example.com", code: "ABC123", password: "new-password" }),
      });
      assert.equal(res.status, 404);
    }

    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.com", password: "old-password" }),
    });
    assert.equal(signup.status, 200);
    // Simulate an older imported record while keeping the optional field readable.
    const account = await getAccountByEmail("reset@example.com");
    assert.ok(account);
    account.needsPasswordReset = true;
    account.passwordHash = "";

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.com", password: "old-password" }),
    });
    assert.equal(login.status, 401);
    const loginBody = await login.json() as { error: string };
    assert.match(loginBody.error, /ask an admin.*reset your password/i);
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

  it("auth/me is 200 with account null when no cookie and 401 when the session is dead", async () => {
    const app = createApp();
    const none = await app.request("/api/auth/me");
    assert.equal(none.status, 200);
    const noneBody = (await none.json()) as { account: null };
    assert.equal(noneBody.account, null);

    const dead = await app.request("/api/auth/me", {
      headers: { Cookie: "starhold_session=not-a-real-session" },
    });
    assert.equal(dead.status, 401);
    const deadBody = (await dead.json()) as { account: null };
    assert.equal(deadBody.account, null);
  });

  it("login with a busy universe still returns the commander view", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "busy@example.com",
        password: "hunter2xx",
      }),
    });
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "BusyPilot" }),
    });
    assert.equal(join.status, 200);
    const joined = (await join.json()) as { player: { id: string } };

    setUniverseFaultForTests("busy");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "busy@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(login.status, 200);
    const body = (await login.json()) as {
      ok?: boolean;
      view: { player: { id: string } } | null;
    };
    assert.equal(body.ok, true);
    assert.equal(body.view?.player.id, joined.player.id);
  });

  it("login returns 503 instead of a swallowed null view when the snapshot cannot be read", async () => {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "noread@example.com",
        password: "hunter2xx",
      }),
    });
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "NoRead" }),
    });
    assert.equal(join.status, 200);

    setUniverseFaultForTests("both");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "noread@example.com",
        password: "hunter2xx",
      }),
    });
    assert.equal(login.status, 503);
    const body = (await login.json()) as {
      ok?: boolean;
      error?: string;
      view: null;
      retry?: boolean;
    };
    assert.notEqual(body.ok, true);
    assert.equal(body.view, null);
    assert.equal(body.retry, true);
    assert.match(body.error ?? "", /Universe busy/);
    assert.doesNotMatch(body.error ?? "", /expected pattern|SyntaxError/i);
  });
});
