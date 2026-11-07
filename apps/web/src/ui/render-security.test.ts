import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_PAGES } from "./nav";
import { joinScreenHtml } from "./render-chrome-join";
import {
  accountNavHtml,
  recoverFormHtml,
  securityPageHtml,
  type SecurityPanelStatus,
} from "./render-security";

const status: SecurityPanelStatus = {
  email: "pilot@starhold.test",
  hasPassword: true,
  recoveryCodesRemaining: 3,
  createdAt: Date.UTC(2026, 0, 2, 3, 4),
  lastLoginAt: Date.UTC(2026, 0, 3, 5, 6),
};

describe("security page", () => {
  it("keeps security out of the game nav and shows it only when signed in", () => {
    assert.equal((NAV_PAGES as readonly string[]).includes("security"), false);
    assert.equal(accountNavHtml(false, false, "/security"), "");
    const link = accountNavHtml(true, true, "/security?playerId=p1");
    assert.match(link, /data-testid="nav-security"/);
    assert.match(link, /data-account-nav="security"/);
    assert.match(link, /class="nav-link active"/);
  });

  it("renders the password form, revoke control, and remaining codes", () => {
    const html = securityPageHtml(status, null, false);
    assert.match(html, /data-testid="security-password-form"/);
    assert.match(html, /data-testid="security-revoke-others"/);
    assert.match(html, /Sign out other devices/);
    assert.match(html, /data-testid="security-recovery-generate"/);
    assert.match(html, /data-testid="security-recovery-remaining"/);
    assert.match(html, /Recovery codes left: 3/);
    assert.match(html, /pilot@starhold\.test/);
    assert.doesNotMatch(html, /data-testid="security-recovery-codes"/);
  });

  it("shows generated codes once with a copy hint", () => {
    const html = securityPageHtml(status, ["ABCD-EFGH", "IJKL-MNOP"], false);
    assert.match(html, /data-testid="security-recovery-codes"/);
    assert.match(html, /Copy these now\. They will not be shown again\./);
    assert.match(html, /ABCD-EFGH/);
    assert.match(html, /IJKL-MNOP/);
  });

  it("puts a forgot-password link and recover form on the join screen", () => {
    const recover = recoverFormHtml();
    assert.match(recover, /data-testid="recover-form"/);
    assert.match(recover, /data-testid="recover-email"/);
    assert.match(recover, /data-testid="recover-code"/);
    assert.match(recover, /data-testid="recover-password"/);
    assert.match(recover, /hidden/);

    const guest = joinScreenHtml({
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
    });
    assert.match(guest, /data-testid="auth-form"/);
    assert.match(guest, /data-testid="auth-forgot-link"/);
    assert.match(guest, /Forgot password\?/);
    assert.match(guest, /data-testid="recover-form"/);

    const signedIn = joinScreenHtml({
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
      accountEmail: "pilot@starhold.test",
    });
    assert.doesNotMatch(signedIn, /data-testid="auth-forgot-link"/);
    assert.doesNotMatch(signedIn, /data-testid="recover-form"/);
  });
});
