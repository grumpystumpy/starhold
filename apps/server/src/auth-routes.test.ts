import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("auth magic-link routes (memory)", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
  });

  it("request-link returns devMagicUrl without Resend", async () => {
    delete process.env.RESEND_API_KEY;
    const app = createApp();
    const res = await app.request("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pilot@example.com" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      emailed: boolean;
      devMagicUrl?: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.emailed, false);
    assert.ok(body.devMagicUrl?.includes("/api/auth/verify?token="));
  });

  it("verify sets session cookie and auth/me resumes player after join", async () => {
    delete process.env.RESEND_API_KEY;
    const app = createApp();
    const linkRes = await app.request("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "commander@example.com" }),
    });
    const link = (await linkRes.json()) as { devMagicUrl: string };
    const verify = await app.request(link.devMagicUrl);
    assert.ok([302, 303].includes(verify.status));
    const setCookie = verify.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("starhold_session="));
    const cookie = setCookie.split(";")[0]!;

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
  });

  it("claims anonymous playerId onto the account", async () => {
    delete process.env.RESEND_API_KEY;
    const app = createApp();
    const guest = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "GuestClaim" }),
    });
    const guestView = (await guest.json()) as { player: { id: string } };

    const linkRes = await app.request("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "claim@example.com",
        claimPlayerId: guestView.player.id,
      }),
    });
    const link = (await linkRes.json()) as { devMagicUrl: string };
    const verify = await app.request(link.devMagicUrl);
    const cookie = (verify.headers.get("set-cookie") ?? "").split(";")[0]!;

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
});
