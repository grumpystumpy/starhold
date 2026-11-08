#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for email password reset.
 * Signup → request a reset link → read the mock mailbox → set a new
 * password on /?reset= → old password fails, new password works.
 *
 * Requires a production build, server on STARHOLD_WEB (default :3001)
 * started with EMAIL_MOCK=1, and playwright chromium.
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;

async function waitHealthy(ms = 60_000) {
  const activeClock = createActiveWaitClock();
  while (activeClock.elapsed() < ms) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("API health timeout");
}

async function readMock(ms = 15_000) {
  const activeClock = createActiveWaitClock();
  while (activeClock.elapsed() < ms) {
    const res = await fetch(`${API}/api/auth/reset/mock`);
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("mock reset mail did not arrive");
}

async function main() {
  await waitHealthy();
  const providers = await fetch(`${API}/api/auth/providers`);
  if (!providers.ok) throw new Error(`providers ${providers.status}`);
  const listed = await providers.json();
  if (listed.emailReset !== true) {
    throw new Error("EMAIL_MOCK=1 is required so emailReset is true");
  }

  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  function watch(target) {
    target.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
    target.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console:${msg.text()}`);
    });
  }
  watch(page);

  const stamp = Date.now().toString(36);
  const email = `gate_reset_${stamp}@example.com`;
  const password = `GateTest1${stamp}`;
  const nextPassword = `GateTest2${stamp}`;
  const logs = [];

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/signup") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  logs.push("signed_up");

  const loggedOut = await page.evaluate(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    return res.ok;
  });
  if (!loggedOut) throw new Error("logout failed");

  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();
  watch(guest);
  await guest.goto(WEB, { waitUntil: "networkidle" });
  await guest.getByTestId("auth-email-reset-link").waitFor({ timeout: 15_000 });
  await guest.getByTestId("auth-forgot-link").waitFor();
  await guest.getByTestId("auth-email-reset-link").click();
  await guest.getByTestId("email-reset-address").waitFor({ timeout: 10_000 });
  await guest.getByTestId("email-reset-address").fill(email);
  await Promise.all([
    guest.waitForResponse(
      (response) => response.url().includes("/api/auth/reset/request") && response.ok(),
      { timeout: 20_000 },
    ),
    guest.getByTestId("email-reset-request-submit").click(),
  ]);
  logs.push("reset_requested");

  const mail = await readMock();
  const token = String(mail.text ?? "").match(/[?&]reset=([^&\s]+)/)?.[1];
  if (!token) throw new Error(`reset link missing in ${mail.text}`);
  logs.push("mock_mail");

  const resetCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const resetPage = await resetCtx.newPage();
  watch(resetPage);
  await resetPage.goto(`${WEB}/?reset=${token}`, { waitUntil: "networkidle" });
  await resetPage.getByTestId("password-reset-form").waitFor({ timeout: 15_000 });
  await resetPage.getByTestId("password-reset-password").fill(nextPassword);
  await Promise.all([
    resetPage.waitForResponse(
      (response) => response.url().includes("/api/auth/reset/confirm") && response.ok(),
      { timeout: 20_000 },
    ),
    resetPage.getByTestId("password-reset-submit").click(),
  ]);
  await resetPage.getByTestId("auth-form").waitFor({ timeout: 15_000 });
  logs.push("password_set");

  await resetPage.getByTestId("auth-email").fill(email);
  await resetPage.getByTestId("auth-password").fill(password);
  const oldLogin = resetPage.waitForResponse(
    (response) => response.url().includes("/api/auth/login"),
    { timeout: 20_000 },
  );
  await resetPage.getByTestId("auth-login-btn").click();
  const oldRes = await oldLogin;
  if (oldRes.ok()) throw new Error("old password still works");
  logs.push("old_password_rejected");

  await resetPage.getByTestId("auth-password").fill(nextPassword);
  await Promise.all([
    resetPage.waitForResponse(
      (response) => response.url().includes("/api/auth/login") && response.ok(),
      { timeout: 20_000 },
    ),
    resetPage.getByTestId("auth-login-btn").click(),
  ]);
  await resetPage.getByTestId("account-email").waitFor({ timeout: 15_000 });
  logs.push("new_password_works");

  const noise = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  if (noise.length) throw new Error(`console/page errors: ${noise.join(" | ")}`);
  await browser.close();
  console.log("QUALITY_GATE_EMAIL_RESET_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_EMAIL_RESET_FAIL", err);
  process.exit(1);
});
