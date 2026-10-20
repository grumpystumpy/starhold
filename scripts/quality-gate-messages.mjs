#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for Messages inbox — local production build only (no Vercel preview).
 * Covers: signup → login → cookie persistence + Messages panel (no stub) + Fleet link.
 * Inbox merge / combat rows covered by unit tests + smoke-ui messages check.
 *
 * Requires: build:vercel done, server on STARHOLD_WEB (default :3001) with
 * SESSION_SECRET set (or local fallback), playwright chromium installed.
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const email = `gate_msg_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Msg${stamp.slice(-5)}`;
  const logs = [];

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/auth/signup") && r.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  await page.getByTestId("account-email").waitFor({ timeout: 15_000 });
  logs.push("signup_ok");

  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  logs.push("joined");

  await page.getByTestId("nav-messages").click();
  await page.getByTestId("page-messages").waitFor({ timeout: 10_000 });
  await page.getByTestId("messages-panel").waitFor({ timeout: 10_000 });
  await page.getByTestId("messages-empty").waitFor({ timeout: 5_000 });
  if ((await page.getByTestId("messages-stub").count()) > 0) {
    throw new Error("messages stub still present");
  }
  const summary = await page.getByTestId("messages-summary").textContent();
  if (!summary || !/0 items/i.test(summary) || !/0 combat/i.test(summary)) {
    throw new Error(`unexpected messages summary: ${summary}`);
  }
  logs.push("messages_empty_ok");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("messages-panel").waitFor({ timeout: 20_000 });
  logs.push("persist_reload_messages");

  const page2 = await context.newPage();
  await page2.goto(WEB, { waitUntil: "networkidle" });
  const hasOverview = await page2
    .getByTestId("overview-panel")
    .isVisible()
    .catch(() => false);
  const hasAccount = await page2
    .getByTestId("account-email")
    .isVisible()
    .catch(() => false);
  if (!hasOverview && !hasAccount) {
    throw new Error("cookie session did not resume after reload in new tab");
  }
  logs.push(hasOverview ? "cookie_resume_overview" : "cookie_resume_signed_in");

  const fresh = await browser.newContext();
  const loginPage = await fresh.newPage();
  await loginPage.goto(WEB, { waitUntil: "networkidle" });
  await loginPage.getByTestId("auth-email").fill(email);
  await loginPage.getByTestId("auth-password").fill(password);
  await Promise.all([
    loginPage.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.ok(),
      { timeout: 15_000 },
    ),
    loginPage.getByTestId("auth-login-btn").click(),
  ]);
  const overviewOrJoin = await Promise.race([
    loginPage
      .getByTestId("overview-panel")
      .waitFor({ timeout: 15_000 })
      .then(() => "overview"),
    loginPage
      .getByTestId("account-email")
      .waitFor({ timeout: 15_000 })
      .then(() => "join"),
  ]);
  if (overviewOrJoin === "join") {
    await loginPage.getByTestId("join-btn").click();
    await loginPage.getByTestId("overview-panel").waitFor({ timeout: 15_000 });
  }
  logs.push("login_ok");

  await loginPage.getByTestId("nav-messages").click();
  await loginPage.getByTestId("messages-panel").waitFor({ timeout: 10_000 });
  await loginPage.getByTestId("messages-empty").waitFor({ timeout: 5_000 });
  logs.push("login_messages_ok");

  await loginPage.getByTestId("nav-fleet").click();
  await loginPage.getByTestId("fleets-panel").waitFor({ timeout: 10_000 });
  await loginPage.getByTestId("fleet-open-messages").click();
  await loginPage.getByTestId("messages-panel").waitFor({ timeout: 10_000 });
  await loginPage.getByTestId("page-messages").waitFor({ timeout: 5_000 });
  logs.push("fleet_link_to_messages");

  await fresh.close();
  await browser.close();
  console.log("QUALITY_GATE_MESSAGES_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_MESSAGES_FAIL", err);
  process.exit(1);
});
