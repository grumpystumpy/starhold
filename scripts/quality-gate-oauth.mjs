#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for optional OAuth sign-in.
 * With OAUTH_MOCK=1 on the server: mock sign-in reaches the commander
 * field, logout returns to the password form, and email signup still works.
 *
 * Requires a production build, server on STARHOLD_WEB (default :3001)
 * started with OAUTH_MOCK=1, and playwright chromium.
 */
import { createRequire } from "node:module";
import { armWhatsNewDismiss } from "./lib/dismiss-whats-new.mjs";

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

async function assertNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) throw new Error(`${label} horizontal overflow ${overflow}px`);
}

async function main() {
  await waitHealthy();
  const providers = await fetch(`${API}/api/auth/providers`);
  if (!providers.ok) throw new Error(`providers ${providers.status}`);
  const listed = (await providers.json()).providers ?? [];
  if (!listed.includes("mock")) {
    throw new Error("OAUTH_MOCK=1 is required so the mock provider is listed");
  }

  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await armWhatsNewDismiss(await context.newPage());
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });

  const stamp = Date.now().toString(36);
  const email = `gate_oauth_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const logs = [];

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("oauth-mock").waitFor({ timeout: 15_000 });
  await page.getByTestId("auth-form").waitFor();
  await assertNoHorizontalScroll(page, "phone join");
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/me") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("oauth-mock").click(),
  ]);
  await page.getByTestId("account-email").waitFor({ timeout: 15_000 });
  await page.getByTestId("commander-input").waitFor();
  await assertNoHorizontalScroll(page, "phone signed-in join");
  logs.push("mock_signed_in");

  await page.setViewportSize({ width: 1280, height: 800 });
  await assertNoHorizontalScroll(page, "desktop signed-in join");

  const loggedOut = await page.evaluate(async () => {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    return res.ok;
  });
  if (!loggedOut) throw new Error("logout failed");
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-form").waitFor({ timeout: 15_000 });
  await page.getByTestId("auth-email").waitFor();
  logs.push("logged_out");

  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/signup") && response.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  await page.getByTestId("account-email").waitFor({ timeout: 15_000 });
  const signedInAs = await page.getByTestId("account-email").innerText();
  if (!signedInAs.toLowerCase().includes(email.toLowerCase())) {
    throw new Error(`password signup did not sign in ${email}: ${signedInAs}`);
  }
  logs.push("password_signup");

  const noise = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  if (noise.length) throw new Error(`console/page errors: ${noise.join(" | ")}`);
  await browser.close();
  console.log("QUALITY_GATE_OAUTH_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_OAUTH_FAIL", err);
  process.exit(1);
});
