#!/usr/bin/env node
/**
 * Quality gate for ACS / Joint Strike — local production build only (no Vercel preview).
 * Covers: signup → login → cookie persist + alliance create + ACS UI on Fleets (raid).
 *
 * Requires: build:vercel done, server on STARHOLD_WEB (default :3001) with
 * SESSION_SECRET set, playwright chromium installed.
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;

async function waitHealthy(ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
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
  const email = `gate_acs_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Acs${stamp.slice(-5)}`;
  const tag = `J${stamp.slice(-3)}`.toUpperCase().slice(0, 4);
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

  // Cookie resume: new context with stored state
  const state = await context.storageState();
  await context.close();
  const context2 = await browser.newContext({ storageState: state });
  const page2 = await context2.newPage();
  await page2.goto(WEB, { waitUntil: "networkidle" });
  await page2.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  logs.push("cookie_resume_ok");

  await page2.getByTestId("nav-alliances").click();
  await page2.getByTestId("page-alliances").waitFor({ timeout: 10_000 });
  await page2.getByTestId("alliance-name").fill(`Joint ${stamp.slice(-4)}`);
  await page2.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    page2.waitForResponse(
      (r) => r.url().includes("/api/alliance/create") && r.ok(),
      { timeout: 15_000 },
    ),
    page2.getByTestId("alliance-create-btn").click(),
  ]);
  await page2.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
  logs.push("alliance_created");

  await page2.getByTestId("nav-fleets").click();
  await page2.getByTestId("fleet-form").waitFor({ timeout: 10_000 });
  await page2.getByTestId("mission-raid").click();
  await page2.getByTestId("acs-pick").waitFor({ timeout: 5_000 });
  await page2.getByTestId("fleet-open-acs").waitFor({ timeout: 5_000 });
  logs.push("acs_ui_visible");

  console.log("QUALITY_GATE_ACS_OK", logs.join(","));
  await browser.close();
}

main().catch((err) => {
  console.error("QUALITY_GATE_ACS_FAIL", err);
  process.exit(1);
});
