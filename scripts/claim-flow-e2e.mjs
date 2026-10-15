/**
 * Playwright claim flow against `wrangler dev --local` at 390×844.
 * Signup via the API, mark the account needsPasswordReset, then set a
 * new password in the join screen and log in with it.
 *
 *   STARHOLD_WEB=http://127.0.0.1:8787 node scripts/claim-flow-e2e.mjs
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:8787";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

async function waitHealthy() {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`${WEB}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("worker health timeout");
}

await waitHealthy();

const stamp = Date.now().toString(36);
const email = `claim${stamp}@example.com`;
const oldPassword = "old-password";
const newPassword = "new-password";

const signup = await fetch(`${WEB}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: oldPassword }),
});
if (!signup.ok) throw new Error(`signup failed ${signup.status}`);

const prepared = await fetch(`${WEB}/api/e2e/prepare-password-claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
});
if (!prepared.ok) {
  throw new Error(
    `prepare claim failed ${prepared.status} (STARHOLD_E2E=1 required)`,
  );
}
const { code } = await prepared.json();
if (!code || code.length < 6 || code.length > 8) {
  throw new Error("prepare did not return a claim code");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="password-claim-form"]', {
    timeout: 20_000,
  });
  const box = await page.locator('[data-testid="password-claim-form"]').boundingBox();
  if (!box || box.width > 390) {
    throw new Error(`claim form does not fit 390px (${box?.width})`);
  }

  await page.fill('[data-testid="claim-email"]', email);
  await page.fill('[data-testid="claim-code"]', code);
  await page.fill('[data-testid="claim-password"]', newPassword);
  await page.click('[data-testid="claim-password-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', { timeout: 20_000 });
  const signedIn = await page.textContent('[data-testid="account-email"]');
  if (!signedIn?.includes(email)) {
    throw new Error(`signed-in line missing email: ${signedIn}`);
  }

  await page.context().clearCookies();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="auth-email"]', { timeout: 20_000 });
  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', oldPassword);
  await page.click('[data-testid="auth-login-btn"]');
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 15_000 });
  const blocked = await page.textContent('[data-testid="flash-error"]');
  if (!blocked?.toLowerCase().includes("invalid")) {
    throw new Error(`old password should fail: ${blocked}`);
  }

  await page.fill('[data-testid="auth-password"]', newPassword);
  await page.click('[data-testid="auth-login-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', { timeout: 20_000 });
  console.log(`ok 390x844 ${email}`);
} finally {
  await browser.close();
}
