import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinScreenHtml, reconnectScreenHtml } from "./ui/render-chrome-join";
import {
  reconnectDelayMs,
  resumeDecision,
  shouldClearSavedPlayer,
} from "./auth-resume";

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
    assert.doesNotMatch(html, /data-testid="join-form"/);
    assert.doesNotMatch(html, /data-testid="auth-form"/);
    assert.doesNotMatch(html, /id="join-form"/);
  });
});
