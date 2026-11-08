#!/usr/bin/env node
/**
 * Production check: the step-2 review matches the launch payload.
 * STARHOLD_WEB and STARHOLD_API default to http://127.0.0.1:3001.
 * Physical devices are not covered.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fleetToStep2 } from "./lib/fleet-two-step.mjs";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;
const require = createRequire(import.meta.url);
const playwright = require("playwright");

function fail(message) {
  throw new Error(message);
}

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function overflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function main() {
  const stamp = Date.now().toString(36);
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  const email = `review${stamp}@example.com`;
  const name = `Rev${stamp.slice(-6)}`;
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', "starhold-review");
  await page.click('[data-testid="auth-signup-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', { timeout: 15_000 });
  await page.fill('[data-testid="commander-input"]', name);
  await page.click('[data-testid="join-btn"]');
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const playerId = await page.evaluate(() => window.starhold?.getState()?.playerId ?? null);
  if (!playerId) fail("missing player id");
  const beforeGrant = await fetch(
    `${API}/api/state?playerId=${encodeURIComponent(playerId)}`,
  ).then((res) => res.json());
  const homeSlot = beforeGrant.planet?.coords?.slot;
  const empty = (beforeGrant.galaxy?.slots ?? []).find(
    (slot) => !slot.planetId && slot.coords?.slot !== homeSlot,
  );
  if (!empty) {
    fail(`no empty colony slot: ${JSON.stringify(beforeGrant.planet?.coords ?? null)}`);
  }
  const granted = await api("/api/e2e/grant", {
    playerId,
    ships: { scout: 3 },
    resources: { metal: 5000, crystal: 5000, deuterium: 50000 },
    colonySlot: empty.coords.slot,
  });
  if (granted.error) fail(`grant failed: ${granted.error}`);
  const colonyValue = `planet:e2e_col_${playerId}_${empty.coords.slot}`;
  await page.reload({ waitUntil: "networkidle" });
  await page.click('[data-testid="nav-fleet"]');
  await fleetToStep2(page, { scout: 1 });
  await page.selectOption('[data-testid="fleet-mission"]', "deploy");
  try {
    await page.waitForFunction(
      (value) => {
        const sel = document.querySelector('[data-testid="fleet-target"]');
        return Boolean(sel && [...sel.options].some((option) => option.value === value));
      },
      colonyValue,
      { timeout: 10_000 },
    );
  } catch (err) {
    const options = await page.locator('[data-testid="fleet-target"]').innerText().catch(() => "");
    fail(`${err.message}\noptions:\n${options}\nwanted ${colonyValue}`);
  }
  await page.selectOption('[data-testid="fleet-target"]', colonyValue);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="fleet-review-destination"]')?.textContent?.includes("Far Holding"),
    null,
    { timeout: 10_000 },
  );
  const before = await page.locator('[data-testid="fleet-review-fuel"]').innerText();
  const missionText = await page.locator('[data-testid="fleet-review-mission"]').innerText();
  const destination = await page.locator('[data-testid="fleet-review-destination"]').innerText();
  const outbound = await page.locator('[data-testid="fleet-review-outbound"]').innerText();
  const arrival = await page.locator('[data-testid="fleet-review-arrival"]').innerText();
  const returning = await page.locator('[data-testid="fleet-review-return"]').innerText();
  if (!missionText.includes("Station")) fail(`mission review: ${missionText}`);
  if (!destination.includes("Far Holding") || !destination.includes(":")) {
    fail(`destination review: ${destination}`);
  }
  if (!outbound.startsWith("Duration")) fail(`duration: ${outbound}`);
  if (!arrival.startsWith("Clock") || !arrival.includes("(")) fail(`clock: ${arrival}`);
  if (!returning.includes("No return flight")) fail(`return: ${returning}`);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.selectOption('[data-testid="fleet-speed"]', "40");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="fleet-speed-note"]')?.textContent?.includes("not sent"),
    null,
    { timeout: 10_000 },
  );
  const after = await page.locator('[data-testid="fleet-review-fuel"]').innerText();
  if (after !== before) fail(`launch fuel changed with speed: ${before} -> ${after}`);
  mkdirSync("docs/fleet-review", { recursive: true });
  await page.screenshot({ path: "docs/fleet-review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const phoneOverflow = await overflow(page);
  if (phoneOverflow > 1) fail(`phone overflow ${phoneOverflow}px`);
  await page.screenshot({ path: "docs/fleet-review/phone.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopOverflow = await overflow(page);
  if (desktopOverflow > 1) fail(`desktop overflow ${desktopOverflow}px`);

  const posted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("launch request missing")), 10_000);
    page.on("request", (req) => {
      if (!req.url().includes("/api/launch-fleet") || req.method() !== "POST") return;
      clearTimeout(timer);
      resolve(JSON.parse(req.postData() || "{}"));
    });
  });
  await page.click('[data-testid="launch-fleet"]');
  const body = await posted;
  if (body.mission !== "deploy") fail(`payload mission ${body.mission}`);
  if (body.targetPlanetId !== colonyValue.slice("planet:".length)) {
    fail(`payload target ${body.targetPlanetId}`);
  }
  if (body.ships?.scout !== 1) fail(`payload ships ${JSON.stringify(body.ships)}`);
  if ("speed" in body || "speedPercent" in body) fail("payload included speed");
  await page.waitForSelector('[data-testid="flash-ok"], [data-testid="events-banner"]', {
    timeout: 10_000,
  });
  const launchErr = await page.locator('[data-testid="flash-error"]').count();
  if (launchErr > 0) fail(await page.locator('[data-testid="flash-error"]').innerText());
  if (pageErrors.length) fail(`page errors: ${pageErrors.join(" | ")}`);
  await browser.close();
  console.log("Fleet review smoke OK");
  console.log(JSON.stringify({ missionText, destination, outbound, arrival, fuel: after, body }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
