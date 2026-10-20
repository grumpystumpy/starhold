#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for Alliances foundation — local production build only (no Vercel preview).
 * Covers: signup → login → cookie persistence + create alliance → tag badge + leave.
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
  const email = `gate_ally_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Ally${stamp.slice(-5)}`;
  const tag = `A${stamp.slice(-3)}`.toUpperCase().slice(0, 4);
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

  await page.getByTestId("nav-alliances").click();
  await page.getByTestId("page-alliances").waitFor({ timeout: 10_000 });
  await page.getByTestId("alliances-panel").waitFor({ timeout: 10_000 });
  await page.getByTestId("alliance-create-form").waitFor({ timeout: 5_000 });
  logs.push("alliances_create_form");

  await page.getByTestId("alliance-name").fill(`Guard ${stamp.slice(-4)}`);
  await page.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/alliance/create") && r.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("alliance-create-btn").click(),
  ]);
  await page.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
  const badge = await page.getByTestId("alliance-tag-badge").textContent();
  if (!badge || !badge.includes(`[${tag}]`)) {
    throw new Error(`unexpected alliance badge: ${badge}`);
  }
  logs.push("alliance_created");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("nav-alliances").click();
  await page.getByTestId("alliance-tag-badge").waitFor({ timeout: 20_000 });
  logs.push("persist_reload_alliance");

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

  await loginPage.getByTestId("nav-alliances").click();
  await loginPage.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
  logs.push("login_alliance_ok");

  await loginPage.getByTestId("nav-galaxy").click();
  await loginPage.getByTestId("galaxy-panel").waitFor({ timeout: 10_000 });
  const galaxyHtml = await loginPage.content();
  if (!galaxyHtml.includes(`[${tag}]`)) {
    throw new Error(`galaxy missing alliance tag [${tag}]`);
  }
  logs.push("galaxy_tag_ok");

  await loginPage.getByTestId("nav-alliances").click();
  await Promise.all([
    loginPage.waitForResponse(
      (r) => r.url().includes("/api/alliance/leave") && r.ok(),
      { timeout: 15_000 },
    ),
    loginPage.getByTestId("alliance-leave-btn").click(),
  ]);
  await loginPage.getByTestId("alliance-create-form").waitFor({ timeout: 10_000 });
  logs.push("leave_ok");

  await fresh.close();
  await browser.close();
  console.log("QUALITY_GATE_ALLIANCES_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_ALLIANCES_FAIL", err);
  process.exit(1);
});
