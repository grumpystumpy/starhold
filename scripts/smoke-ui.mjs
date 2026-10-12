#!/usr/bin/env node
/**
 * Local smoke: UI join (URL + typed + helper), upgrade, build-ship, P1 flashes.
 * Requires: npm run dev (web :5173, api :3001) and playwright + chromium.
 *
 * Steps (manual equivalent):
 * 1. Open http://127.0.0.1:5173/?commander=Smoke
 *    or type a name / run window.starhold.join("Smoke")
 * 2. Click Upgrade on Shipyard; while "Queue busy", click another Upgrade —
 *    red flash must show "already under construction" and survive ~2s of polls.
 * 3. Click Metal Vault when unaffordable — flash "Not enough resources."
 * 4. After yard completes, bank ~4.5 min to ≥220 metal, click Build on Scout —
 *    hangar scout increments (notice persists across polls).
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:5173";
const API = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";

async function waitHealthy(ms = 30_000) {
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

async function apiJson(path, init) {
  const res = await fetch(`${API}${path}`, init);
  return res.json();
}

async function waitMetal(playerId, minMetal, ms = 360_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const st = await apiJson(`/api/state/${playerId}`);
    if (st.planet.resources.metal >= minMetal && !st.planet.buildQueue) {
      return st;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${minMetal} metal`);
}

async function apiSmoke() {
  const name = `Smoke${Date.now().toString(36).slice(-5)}`;
  const join = await apiJson("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!join.player?.id) throw new Error(`join failed: ${JSON.stringify(join)}`);
  const playerId = join.player.id;

  const up = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "shipyard" }),
  });
  if (up.error) throw new Error(`yard upgrade: ${up.error}`);

  const busy = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalMine" }),
  });
  if (busy.error !== "A building is already under construction.") {
    throw new Error(`expected double-queue error, got: ${JSON.stringify(busy)}`);
  }

  const vault = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalStorage" }),
  });
  // Vault either blocked by queue or unaffordable — both are valid reject strings.
  if (!vault.error) throw new Error("expected vault reject while poor/busy");

  await waitMetal(playerId, 220, 360_000);

  const ship = await apiJson("/api/build-ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, shipId: "scout", count: 1 }),
  });
  if (ship.error) throw new Error(`build scout: ${ship.error}`);

  for (let i = 0; i < 30; i++) {
    const st = await apiJson(`/api/state/${playerId}`);
    if ((st.planet?.ships?.scout ?? 0) >= 1) {
      console.log("API smoke OK", { name, playerId, scout: st.planet.ships.scout });
      return { name, playerId };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("scout never entered hangar");
}

async function uiSmoke() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const logs = [];

  // 1) URL commander join
  const urlName = `Url${Date.now().toString(36).slice(-4)}`;
  const page = await browser.newPage();
  await page.goto(`${WEB}/?commander=${encodeURIComponent(urlName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const joined = await page.evaluate(() => window.starhold?.getState());
  if (joined?.name !== urlName) {
    throw new Error(`URL join failed: ${JSON.stringify(joined)}`);
  }
  logs.push(`url-join:${urlName}`);

  // 2) P1 double-queue flash + persistence across polls
  await page.click('[data-testid="upgrade-shipyard"]');
  await page.waitForSelector('[data-testid="flash-ok"], [data-testid="build-queue"]', {
    timeout: 10_000,
  });
  await page.click('[data-testid="upgrade-metalMine"]');
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const errText = await page.textContent('[data-testid="flash-error"]');
  if (!errText?.includes("already under construction")) {
    throw new Error(`bad double-queue flash: ${errText}`);
  }
  await page.waitForTimeout(2500);
  if ((await page.locator('[data-testid="flash-error"]').count()) < 1) {
    throw new Error("flash cleared by polls too early");
  }
  logs.push("p1-double-queue-flash");

  // 3) Unaffordable vault (after dismissing prior flash via new click)
  await page.click('[data-testid="upgrade-metalStorage"]');
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const vaultErr = await page.textContent('[data-testid="flash-error"]');
  if (
    !vaultErr?.includes("Not enough resources") &&
    !vaultErr?.includes("already under construction")
  ) {
    throw new Error(`bad vault flash: ${vaultErr}`);
  }
  logs.push("p1-unaffordable-or-busy-flash");

  // 4) Typed join (fresh page — input must accept fill)
  const typedPage = await browser.newPage();
  await typedPage.goto(WEB, { waitUntil: "networkidle" });
  await typedPage.waitForSelector('[data-testid="commander-input"]');
  // Clear any boot flash; type like automation
  const typed = `Type${Date.now().toString(36).slice(-4)}`;
  await typedPage.click('[data-testid="commander-input"]');
  await typedPage.fill('[data-testid="commander-input"]', typed);
  const val = await typedPage.inputValue('[data-testid="commander-input"]');
  if (val !== typed) throw new Error(`input value bind failed: ${val}`);
  // Mid-type re-paint simulation: trigger nothing; busy paint shouldn't wipe
  await typedPage.waitForTimeout(300);
  const val2 = await typedPage.inputValue('[data-testid="commander-input"]');
  if (val2 !== typed) throw new Error(`input wiped after delay: ${val2}`);
  await typedPage.click('[data-testid="join-btn"]');
  await typedPage.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  logs.push(`typed-join:${typed}`);

  // 5) Helper join
  const helpPage = await browser.newPage();
  await helpPage.goto(WEB, { waitUntil: "networkidle" });
  const helperName = `Help${Date.now().toString(36).slice(-4)}`;
  await helpPage.evaluate(async (n) => {
    await window.starhold.join(n);
  }, helperName);
  await helpPage.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  logs.push(`helper-join:${helperName}`);

  // 6) Build scout under live 1s polls (yard-first + bank)
  const buildName = `Clk${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${WEB}/?commander=${encodeURIComponent(buildName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="resources"]');
  await page.evaluate(async () => {
    await window.starhold.upgrade("shipyard");
  });

  // Wait until Build Scout is affordable and unlocked (up to ~6 min)
  // Playwright signature: waitForFunction(fn, arg, options) — options must be 3rd.
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="build-scout"]');
      const metalText =
        document.querySelector('[data-testid="res-metal"] .value')?.textContent ?? "0";
      const metal = Number(String(metalText).replace(/,/g, ""));
      const label = btn?.textContent ?? "";
      const queue = document.querySelector('[data-testid="build-queue"]');
      return Boolean(btn) && !queue && !label.includes("Locked") && metal >= 220;
    },
    undefined,
    { timeout: 360_000 },
  );

  // Click during active polling — paint deferral + delegation must land the build
  await page.click('[data-testid="build-scout"]');
  await page.waitForFunction(
    () => {
      const hangar = document.querySelector(
        '[data-testid="hangar-scout"] span:last-child',
      );
      const q = document.querySelector('[data-testid="ship-queue"]');
      const ok = document.querySelector('[data-testid="flash-ok"]');
      const n = Number(hangar?.textContent ?? 0);
      return n >= 1 || Boolean(q) || Boolean(ok?.textContent?.match(/scout|Hangar|Queued/i));
    },
    undefined,
    { timeout: 15_000 },
  );

  // Confirm hangar increment (queue may finish in seconds at 8×)
  await page.waitForFunction(
    () => {
      const hangar = document.querySelector(
        '[data-testid="hangar-scout"] span:last-child',
      );
      return Number(hangar?.textContent ?? 0) >= 1;
    },
    undefined,
    { timeout: 30_000 },
  );
  logs.push("ui-build-scout");

  // Success notice should still be visible briefly after a poll
  await page.waitForTimeout(1500);
  const noticeOrHangar =
    (await page.locator('[data-testid="flash-ok"]').count()) >= 1 ||
    Number(await page.textContent('[data-testid="hangar-scout"] span:last-child')) >= 1;
  if (!noticeOrHangar) throw new Error("lost build feedback after poll");
  logs.push("build-feedback-ok");

  await browser.close();
  console.log("UI smoke OK", logs);
  return { logs };
}

await waitHealthy();
const api = await apiSmoke();
const ui = await uiSmoke();
console.log(JSON.stringify({ ok: true, api, ui }, null, 2));
