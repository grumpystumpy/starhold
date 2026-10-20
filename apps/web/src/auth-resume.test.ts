import "./test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinScreenHtml, reconnectScreenHtml } from "./ui/render-chrome-join";
import {
  reconnectDelayMs,
  resumeDecision,
  shouldClearSavedPlayer,
} from "./auth-resume";

const { doLogin } = await import("./main-actions-session");
const { clearFlash, session, setPaintImpl } = await import("./session");

describe("logout only on 401", () => {
  it("clears a saved commander only for a real 401", () => {
    assert.equal(resumeDecision(401, false), "logout");
    assert.equal(resumeDecision(401, true), "logout");
    assert.equal(shouldClearSavedPlayer(401), true);

    assert.equal(resumeDecision(503, true), "retry");
    assert.equal(resumeDecision(502, false), "retry");
    assert.equal(resumeDecision(0, true), "retry");
    assert.equal(shouldClearSavedPlayer(503), false);
    assert.equal(shouldClearSavedPlayer(0), false);

    assert.equal(resumeDecision(200, false), "guest");
    assert.equal(resumeDecision(200, true), "ready");
    assert.equal(shouldClearSavedPlayer(200), false);
  });

  it("backs off reconnects and then caps", () => {
    assert.equal(reconnectDelayMs(0), 1_000);
    assert.equal(reconnectDelayMs(1), 2_000);
    assert.equal(reconnectDelayMs(2), 4_000);
    assert.equal(reconnectDelayMs(8), 15_000);
  });
});

describe("login submit", () => {
  it("disables the login button while a login is in flight", () => {
    const idle = joinScreenHtml({
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
    });
    assert.match(idle, /data-testid="auth-login-btn"/);
    assert.doesNotMatch(idle, /data-testid="auth-login-btn"[^>]*disabled/);

    const busy = joinScreenHtml({
      error: null,
      notice: "Reconnecting…",
      busy: true,
      joinDraft: "",
    });
    assert.match(busy, /data-testid="auth-login-btn"[^>]*disabled/);
    assert.match(busy, /data-testid="auth-signup-btn"[^>]*disabled/);
    assert.match(busy, /Reconnecting…/);
  });
});

describe("server error screen", () => {
  it("a 5xx resume does not show the join form", () => {
    const html = reconnectScreenHtml({
      error: null,
      notice: "Reconnecting…",
    });
    assert.match(html, /data-testid="reconnect"/);
    assert.match(html, /Reconnecting/);
    assert.match(html, /Couldn't sign in — try again/);
    assert.doesNotMatch(html, /your commander is still saved/);
    assert.doesNotMatch(html, /data-testid="join-form"/);
    assert.doesNotMatch(html, /data-testid="auth-form"/);
    assert.doesNotMatch(html, /id="join-form"/);
  });

  it("shows only the new copy after a 5xx while resuming a saved commander", async () => {
    const originalFetch = globalThis.fetch;
    const originalWindowSetTimeout = window.setTimeout;
    let fetches = 0;
    globalThis.fetch = async (input) => {
      fetches += 1;
      if (String(input) === "/api/auth/login") {
        return new Response(
          JSON.stringify({
            ok: true,
            account: {
              id: "account-1",
              email: "pilot@example.test",
              playerId: "player-1",
            },
            view: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(input).startsWith("/api/state")) {
        return new Response("<html>Service unavailable</html>", {
          status: 503,
        });
      }
      throw new Error(`unexpected ${String(input)}`);
    };
    window.setTimeout = (() => 1) as typeof window.setTimeout;
    setPaintImpl(() => {});

    try {
      await doLogin("pilot@example.test", "password");
      assert.equal(fetches, 2);
      assert.equal(
        session.notice,
        "Reconnecting… your commander is still saved",
      );
      const html = reconnectScreenHtml({
        error: session.error,
        notice: session.notice,
      });
      assert.doesNotMatch(html, /your commander is still saved/);
      assert.match(html, /Couldn't sign in — try again/);
    } finally {
      globalThis.fetch = originalFetch;
      clearFlash();
      window.setTimeout = originalWindowSetTimeout;
    }
  });
});
