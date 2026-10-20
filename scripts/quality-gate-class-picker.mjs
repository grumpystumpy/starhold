#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for PR #41 — local production build only (no Vercel preview).
 * Covers: signup → login → cookie persistence + class picker choose on Overview.
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
  const email = `gate41_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Gate${stamp.slice(-5)}`;

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
  await page.getByTestId("class-panel").waitFor({ timeout: 10_000 });
  logs.push("overview_class_panel");

  await page.getByTestId("choose-class-miner").click();
  await page.getByTestId("class-current").waitFor({ timeout: 10_000 });
  const current = await page.getByTestId("class-current").textContent();
  if (!current || !/mine/i.test(current)) {
    throw new Error(`expected Miner blurb after choose, got: ${current}`);
  }
  logs.push("class_chosen_miner");

  // Cookie persistence: reload without localStorage dependence for session.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  await page.getByTestId("class-current").waitFor({ timeout: 10_000 });
  logs.push("persist_reload_in_game");

  // Logout path via fresh context login check: open new page same cookies.
  const page2 = await context.newPage();
  await page2.goto(WEB, { waitUntil: "networkidle" });
  // Cookie should resume into game or show signed-in join.
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

  // Explicit login on clean context (no cookies).
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
  // Linked commander resumes straight into Overview; otherwise signed-in join.
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
  await loginPage.getByTestId("class-current").waitFor({ timeout: 10_000 });
  logs.push("login_ok_class_persisted");

  // Shipyard should not list other-class exclusive hulls (vaultScout is explorer).
  await loginPage.goto(`${WEB}/shipyard`, { waitUntil: "networkidle" });
  await loginPage.getByTestId("hull-bay-panel").waitFor({ timeout: 10_000 });
  const vaultVisible = await loginPage
    .getByTestId("ship-vaultScout")
    .isVisible()
    .catch(() => false);
  if (vaultVisible) {
    throw new Error("Explorer-only Vault Scout visible while Miner class");
  }
  const veinVisible = await loginPage
    .getByTestId("ship-veinAnchor")
    .isVisible()
    .catch(() => false);
  if (!veinVisible) {
    throw new Error("Miner Vein Anchor missing from shipyard");
  }
  logs.push("shipyard_class_filter_ok");

  await fresh.close();
  await browser.close();
  console.log("QUALITY_GATE_CLASS_PICKER_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_CLASS_PICKER_FAIL", err);
  process.exit(1);
});
