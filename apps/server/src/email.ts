/**
 * Password-reset mail. No provider configured means the feature is off.
 * `EMAIL_MOCK=1` keeps the last message in memory for tests. It is refused
 * on Workers unless `STARHOLD_E2E=1`, same rule as `OAUTH_MOCK`.
 */
import { isWorkersRuntime } from "./accounts.js";

export const RESET_EMAIL_SUBJECT = "Reset your Starhold password";
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const PUBLIC_DEFAULT = "https://starhold.stumpysgarage.workers.dev";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

let lastMock: OutboundEmail | null = null;

export function resetMockMailbox(): void {
  lastMock = null;
}

export function lastMockEmail(): OutboundEmail | null {
  return lastMock;
}

export function mockEmailAllowed(): boolean {
  if (process.env.EMAIL_MOCK !== "1") return false;
  if (isWorkersRuntime() && process.env.STARHOLD_E2E !== "1") return false;
  return true;
}

export function resendConfigured(): boolean {
  return (
    process.env.EMAIL_PROVIDER?.trim() === "resend" &&
    Boolean(process.env.RESEND_API_KEY?.trim()) &&
    Boolean(process.env.EMAIL_FROM?.trim())
  );
}

/** True when a reset link can actually be delivered. */
export function emailResetEnabled(): boolean {
  return mockEmailAllowed() || resendConfigured();
}

export function publicBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return PUBLIC_DEFAULT;
}

export function passwordResetLink(token: string): string {
  return `${publicBaseUrl()}/?reset=${encodeURIComponent(token)}`;
}

export function passwordResetText(token: string): string {
  return [
    "Reset your Starhold password.",
    "",
    "This link works once and expires in 30 minutes:",
    passwordResetLink(token),
    "",
    "If you did not ask for this, you can ignore this email.",
  ].join("\n");
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  if (!emailResetEnabled()) {
    throw new Error("email reset is not configured");
  }
  const text = passwordResetText(token);
  if (mockEmailAllowed()) {
    lastMock = { to, subject: RESET_EMAIL_SUBJECT, text };
    return;
  }
  const key = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: RESET_EMAIL_SUBJECT,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`resend ${res.status} ${detail.slice(0, 200)}`);
  }
}
