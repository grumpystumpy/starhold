#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for account security.
 * Signup → generate recovery codes → change password → logout →
 * login with the new password → logout → recover with a code.
 *
 * Requires a production build, server on STARHOLD_WEB (default :3001),
 * and playwright chromium.
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

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });

  const stamp = Date.now().toString(36);
  const email = `gate_sec_${stamp}@example.com`;
  const password = `GateTest1${stamp}`;
  const nextPassword = `GateTest2${stamp}`;
  const recoveredPassword = `GateTest3${stamp}`;
  const commander = `Sec${stamp.slice(-5)}`;
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
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("game-shell").waitFor({ timeout: 20_000 });
  await page.getByTestId("nav-security").click();
  await page.getByTestId("security-password-form").waitFor({ timeout: 15_000 });
  logs.push("security_page");

  await page.getByTestId("security-recovery-current").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/account/recovery-codes") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("security-recovery-generate").click(),
  ]);
  await page.getByTestId("security-recovery-codes").waitFor({ timeout: 10_000 });
  const codeText = await page.getByTestId("security-recovery-codes").innerText();
  const code = codeText.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0];
  if (!code) throw new Error(`no recovery code in ${codeText}`);
  if (!/Copy these now/.test(codeText)) throw new Error("missing copy hint");
  logs.push("codes_generated");

  await page.getByTestId("security-current-password").fill(password);
  await page.getByTestId("security-next-password").fill(nextPassword);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/account/password") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("security-password-submit").click(),
  ]);
  logs.push("password_changed");

  const loggedOut = await page.evaluate(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    return res.ok;
  });
  if (!loggedOut) throw new Error("logout failed");
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(nextPassword);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/login") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("auth-login-btn").click(),
  ]);
  await page.getByTestId("game-shell").waitFor({ timeout: 20_000 });
  logs.push("login_new_password");

  const loggedOutAgain = await page.evaluate(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    return res.ok;
  });
  if (!loggedOutAgain) throw new Error("second logout failed");
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-forgot-link").click();
  await page.getByTestId("recover-form").waitFor({ timeout: 10_000 });
  await page.getByTestId("recover-email").fill(email);
  await page.getByTestId("recover-code").fill(code);
  await page.getByTestId("recover-password").fill(recoveredPassword);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/recover") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("recover-submit").click(),
  ]);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="game-shell"], [data-testid="account-email"]'),
    undefined,
    { timeout: 20_000 },
  );
  logs.push("recovered");

  const noise = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  if (noise.length) throw new Error(`console/page errors: ${noise.join(" | ")}`);
  await browser.close();
  console.log("QUALITY_GATE_SECURITY_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_SECURITY_FAIL", err);
  process.exit(1);
});
