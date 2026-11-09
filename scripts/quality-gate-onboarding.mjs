#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for commander onboarding — local production build only.
 * Signup → briefing on Overview → locked presets hidden → claim ore mine
 * → dismiss and restore from Goals. Phone and desktop widths.
 *
 * Requires a production build, server on STARHOLD_WEB (default :3001)
 * with SESSION_SECRET or the local fallback, and playwright chromium.
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

function parseAmount(text) {
  const raw = String(text).replace(/,/g, "").trim();
  const match = raw.match(/^(-?\d+(?:\.\d+)?)([kMBT])?$/i);
  if (!match) throw new Error(`unparsed amount "${text}"`);
  const value = Number(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  const mult = suffix === "k" ? 1_000
    : suffix === "m" ? 1_000_000
      : suffix === "b" ? 1_000_000_000
        : suffix === "t" ? 1_000_000_000_000
          : 1;
  return value * mult;
}

async function resourceAmount(page, testId) {
  const text = await page.getByTestId(testId).locator(".value").innerText();
  return parseAmount(text);
}

async function assertNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) throw new Error(`${label} horizontal overflow ${overflow}px`);
}

async function assertNextGoal(page, label) {
  const goal = page.getByTestId("next-goal");
  await goal.waitFor({ timeout: 10_000 });
  const id = await goal.getAttribute("data-next-goal-id");
  if (id !== "building:researchLab") {
    throw new Error(`${label} next goal ${id}`);
  }
  const rationale = await page.getByTestId("next-goal-rationale").innerText();
  if (!/Power Discipline/.test(rationale) || !/Research Lab level 1/.test(rationale)) {
    throw new Error(`${label} rationale ${rationale}`);
  }
  const href = await page.getByTestId("next-goal-open").getAttribute("href");
  if (!href || !href.startsWith("/buildings")) {
    throw new Error(`${label} next goal href ${href}`);
  }
  const box = await goal.boundingBox();
  if (!box || box.width < 40) throw new Error(`${label} next goal has no box`);
  const overflow = await goal.evaluate((el) => el.scrollWidth - el.clientWidth);
  if (overflow > 1) throw new Error(`${label} next goal overflow ${overflow}px`);
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });
  const stamp = Date.now().toString(36);
  const email = `gate_onb_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Onb${stamp.slice(-5)}`;
  const logs = [];

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/signup") && response.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  await page.getByTestId("onboarding-panel").waitFor({ timeout: 10_000 });
  const stepCount = await page.locator("[data-testid^='onboarding-step-']").count();
  if (stepCount !== 8) throw new Error(`expected 8 onboarding steps, saw ${stepCount}`);
  await assertNextGoal(page, "phone");
  logs.push("briefing_phone");
  await assertNoHorizontalScroll(page, "phone overview");

  await page.setViewportSize({ width: 1280, height: 800 });
  await assertNextGoal(page, "desktop");
  await assertNoHorizontalScroll(page, "desktop overview");
  logs.push("briefing_desktop");

  await page.getByTestId("next-goal-open").click();
  await page.getByTestId("upgrade-metalMine").waitFor({ timeout: 10_000 });
  logs.push("next_goal_buildings");
  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-panel").waitFor({ timeout: 10_000 });

  await page.getByTestId("nav-fleet").click();
  await page.getByTestId("fleet-preset").waitFor({ timeout: 10_000 });
  const presetText = await page.getByTestId("fleet-preset").innerText();
  if (/Moon Destruction|Mini Planet Destruction/.test(presetText)) {
    throw new Error(`locked presets visible: ${presetText}`);
  }
  if (!/Expedition/.test(presetText) || !/Raid/.test(presetText)) {
    throw new Error(`early presets missing: ${presetText}`);
  }
  logs.push("presets_hidden");

  await page.getByTestId("nav-buildings").click();
  await page.getByTestId("upgrade-metalMine").click();
  await page.waitForFunction(
    () => (window.starhold?.getState()?.buildings?.metalMine ?? 0) >= 2,
    undefined,
    { timeout: 30_000 },
  );
  logs.push("ore_mine_upgraded");

  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-claim-metalMine1").waitFor({ timeout: 10_000 });
  const metalBefore = await resourceAmount(page, "res-metal");
  const crystalBefore = await resourceAmount(page, "res-crystal");
  await page.getByTestId("onboarding-claim-metalMine1").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="onboarding-step-metalMine1"]')
      ?.getAttribute("data-claimed") === "true",
    undefined,
    { timeout: 15_000 },
  );
  const metalAfter = await resourceAmount(page, "res-metal");
  const crystalAfter = await resourceAmount(page, "res-crystal");
  if (metalAfter < metalBefore + 400) {
    throw new Error(`metal did not rise (${metalBefore} -> ${metalAfter})`);
  }
  if (crystalAfter < crystalBefore + 150) {
    throw new Error(`crystal did not rise (${crystalBefore} -> ${crystalAfter})`);
  }
  logs.push("ore_mine_claimed");

  await page.getByTestId("onboarding-dismiss").click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="onboarding-panel"]'),
    undefined,
    { timeout: 10_000 },
  );
  await page.getByTestId("nav-goals").click();
  await page.getByTestId("onboarding-restore").waitFor({ timeout: 10_000 });
  if (await page.getByTestId("next-goal").count()) {
    throw new Error("next goal stayed visible after dismiss");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalScroll(page, "phone goals dismissed");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("onboarding-restore").click();
  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-panel").waitFor({ timeout: 10_000 });
  await assertNextGoal(page, "restored");
  logs.push("dismiss_restore");

  const noise = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  if (noise.length) throw new Error(`console/page errors: ${noise.join(" | ")}`);
  await browser.close();
  console.log("QUALITY_GATE_ONBOARDING_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_ONBOARDING_FAIL", err);
  process.exit(1);
});
