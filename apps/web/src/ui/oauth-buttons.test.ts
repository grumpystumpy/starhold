import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  joinScreenHtml,
  loadOAuthProviders,
  oauthButtonsHtml,
  resetOAuthProvidersCacheForTests,
} from "./render-chrome-join";

const base = {
  error: null,
  notice: null,
  busy: false,
  joinDraft: "",
};

describe("oauth buttons", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetOAuthProvidersCacheForTests();
  });

  it("hides buttons when no providers are configured", () => {
    assert.equal(oauthButtonsHtml([]), "");
    const html = joinScreenHtml({ ...base, oauthProviders: [] });
    assert.match(html, /data-testid="auth-form"/);
    assert.match(html, /data-testid="auth-login-btn"/);
    assert.match(html, /data-testid="auth-signup-btn"/);
    assert.doesNotMatch(html, /data-testid="oauth-/);
  });

  it("shows one button per configured provider", () => {
    const html = oauthButtonsHtml(["google", "discord", "mock", "nope"]);
    assert.match(html, /data-testid="oauth-google"/);
    assert.match(html, /href="\/api\/auth\/oauth\/google\/start"/);
    assert.match(html, /data-testid="oauth-discord"/);
    assert.match(html, /href="\/api\/auth\/oauth\/discord\/start"/);
    assert.match(html, /data-testid="oauth-mock"/);
    assert.doesNotMatch(html, /oauth-nope/);

    const discordOnly = joinScreenHtml({ ...base, oauthProviders: ["discord"] });
    assert.match(discordOnly, /data-testid="oauth-discord"/);
    assert.doesNotMatch(discordOnly, /data-testid="oauth-google"/);
    assert.match(discordOnly, /data-testid="auth-form"/);

    const signedIn = joinScreenHtml({
      ...base,
      accountEmail: "pilot@starhold.test",
      oauthProviders: ["google", "discord"],
    });
    assert.doesNotMatch(signedIn, /data-testid="oauth-/);
    assert.doesNotMatch(signedIn, /data-testid="auth-form"/);
  });

  it("fetches providers once and hides buttons when the request fails", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ providers: ["mock"], passwordAuth: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const first = await loadOAuthProviders();
    const second = await loadOAuthProviders();
    assert.deepEqual(first, ["mock"]);
    assert.deepEqual(second, ["mock"]);
    assert.equal(calls, 1);

    resetOAuthProvidersCacheForTests();
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const hidden = await loadOAuthProviders();
    assert.deepEqual(hidden, []);
    const html = joinScreenHtml({ ...base, oauthProviders: hidden });
    assert.doesNotMatch(html, /data-testid="oauth-/);
  });
});
