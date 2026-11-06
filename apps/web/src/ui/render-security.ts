import { ACCOUNT_MENU_LABELS, ACCOUNT_MENU_PATHS } from "./nav";
import { escapeHtml } from "./render-escape";

export interface SecurityPanelStatus {
  email: string;
  hasPassword: boolean;
  recoveryCodesRemaining: number;
  createdAt: number;
  lastLoginAt: number;
}

function fmtWhen(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

/** Account-menu link. Omitted unless the player is signed in. */
export function accountNavHtml(signedIn: boolean, active: boolean, href: string): string {
  if (!signedIn) return "";
  return `<li><a href="${escapeHtml(href)}" class="nav-link${active ? " active" : ""}" data-account-nav="security" data-testid="nav-security">${ACCOUNT_MENU_LABELS.security}</a></li>`;
}

export function securityPageHtml(
  status: SecurityPanelStatus | null,
  codes: readonly string[] | null,
  busy: boolean,
): string {
  if (!status) {
    return `<section class="panel" data-testid="security-panel"><h2>Security</h2><p>Loading security…</p></section>`;
  }
  const codeBlock =
    codes && codes.length > 0
      ? `<div data-testid="security-recovery-codes">
          <p class="hint">Copy these now. They will not be shown again.</p>
          <ul>${codes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join("")}</ul>
        </div>`
      : "";
  return `
    <section class="panel" data-testid="security-panel">
      <h2>Security</h2>
      <p data-testid="security-email">Signed in as <strong>${escapeHtml(status.email)}</strong></p>
      <p class="hint">Created ${fmtWhen(status.createdAt)} · last login ${fmtWhen(status.lastLoginAt)}</p>
      <p data-testid="security-recovery-remaining">Recovery codes left: ${status.recoveryCodesRemaining}</p>
      ${status.hasPassword ? "" : `<p class="hint">This account has no password yet. Use a recovery code on the sign-in screen.</p>`}
      <form id="security-password-form" data-testid="security-password-form">
        <h3>Change password</h3>
        <div class="join-row" style="flex-wrap:wrap;gap:0.5rem">
          <input type="password" autocomplete="current-password" minlength="8" maxlength="128" placeholder="Current password" data-testid="security-current-password" ${busy ? "disabled" : ""} />
          <input type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="New password" data-testid="security-next-password" ${busy ? "disabled" : ""} />
          <button type="submit" data-testid="security-password-submit" ${busy ? "disabled" : ""}>Change password</button>
        </div>
      </form>
      <p style="margin-top:1rem">
        <button type="button" data-security-revoke data-testid="security-revoke-others" ${busy ? "disabled" : ""}>Sign out other devices</button>
      </p>
      <form id="security-recovery-form" data-testid="security-recovery-form">
        <h3>Recovery codes</h3>
        <p class="hint">Generating new codes invalidates the previous ones. Each code works once.</p>
        <div class="join-row" style="flex-wrap:wrap;gap:0.5rem">
          <input type="password" autocomplete="current-password" placeholder="Current password" data-testid="security-recovery-current" ${busy ? "disabled" : ""} />
          <button type="submit" data-testid="security-recovery-generate" ${busy ? "disabled" : ""}>Generate recovery codes</button>
        </div>
      </form>
      ${codeBlock}
    </section>`;
}

/** Join-screen recovery. Hidden until Forgot password? is used. */
export function recoverFormHtml(): string {
  return `
    <form id="recover-form" data-testid="recover-form" hidden>
      <label for="recover-email">Email</label>
      <div class="join-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
        <input id="recover-email" name="email" type="email" maxlength="254" placeholder="you@example.com" autocomplete="email" data-testid="recover-email" />
        <input id="recover-code" name="code" type="text" maxlength="32" placeholder="recovery code" autocomplete="off" data-testid="recover-code" />
        <input id="recover-password" name="password" type="password" minlength="8" maxlength="128" placeholder="new password (8+)" autocomplete="new-password" data-testid="recover-password" />
      </div>
      <div class="join-row" style="margin-top:0.5rem">
        <button type="submit" data-testid="recover-submit">Set new password</button>
      </div>
    </form>`;
}

export function securityHref(pathQuery: string): string {
  return `${ACCOUNT_MENU_PATHS.security}${pathQuery}`;
}
