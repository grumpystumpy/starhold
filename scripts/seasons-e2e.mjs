#!/usr/bin/env node
/**
 * Seasons Playwright flow:
 * hook scores → boards show them → seal the month → claim → title survives reload.
 *
 * Requires the API (with STARHOLD_E2E=1) and the web app.
 *   STARHOLD_WEB  default http://127.0.0.1:3001
 *   STARHOLD_API  default STARHOLD_WEB
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;

async function api(path, init) {
  const res = await fetch(`${API}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function nextMonth(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12, 0, 0);
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 2;
  });
  if (overflow) throw new Error(`${label} page overflows horizontally`);
}

async function main() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const name = `Season${Date.now().toString(36).slice(-4)}`;
  const join = await api("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const playerId = join.player?.id;
  if (!playerId) throw new Error(`join failed: ${JSON.stringify(join)}`);

  await api("/api/season/hook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      combat: 10,
      economy: 4,
      pirateKills: 2,
    }),
  });

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`${WEB}/seasons?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await page.waitForSelector('[data-testid="seasons-panel"]', {
      timeout: 15_000,
    });
    const combat = await page.textContent('[data-testid="season-score-combat"]');
    const economy = await page.textContent('[data-testid="season-score-economy"]');
    const pirates = await page.textContent(
      '[data-testid="season-score-pirateKills"]',
    );
    if (!combat?.includes("#1") || !combat.includes("10")) {
      throw new Error(`combat board missing score: ${combat}`);
    }
    if (!economy?.includes("4")) throw new Error(`economy board: ${economy}`);
    if (!pirates?.includes("2")) throw new Error(`pirate board: ${pirates}`);
    const row = await page.textContent('[data-testid="season-row-combat-1"]');
    if (!row?.includes(name)) throw new Error(`top combat row: ${row}`);
    await assertNoPageOverflow(page, "desktop seasons");

    await api("/api/season/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, rollAt: nextMonth() }),
    });
    await page.reload({ waitUntil: "networkidle" });
    const claim = page.locator('[data-testid="season-claim-combat"]');
    await claim.waitFor({ timeout: 10_000 });
    if (await claim.isDisabled()) throw new Error("claim button disabled");
    await claim.click();
    await page.waitForSelector('[data-testid="flash-ok"], [data-testid="active-title"]', {
      timeout: 10_000,
    });

    await page.click('[data-testid="nav-overview"]');
    await page.waitForSelector('[data-testid="page-overview"]', { timeout: 10_000 });
    const title = (await page.textContent('[data-testid="active-title"]'))?.trim();
    if (title !== "Season Champion") {
      throw new Error(`expected Season Champion, got ${title}`);
    }
    const commander = (await page.textContent('[data-testid="commander-name"]'))?.trim();
    if (commander !== name) throw new Error(`commander name: ${commander}`);
    const skin = await page.getAttribute(
      '[data-testid="planet-skin-frame"]',
      "data-planet-skin",
    );
    if (!skin?.startsWith("season-champion-")) {
      throw new Error(`planet skin: ${skin}`);
    }

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="active-title"]', { timeout: 10_000 });
    const afterReload = (await page.textContent('[data-testid="active-title"]'))?.trim();
    if (afterReload !== "Season Champion") {
      throw new Error(`title missing after reload: ${afterReload}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-testid="nav-seasons"]');
    await page.waitForSelector('[data-testid="seasons-panel"]', { timeout: 10_000 });
    await assertNoPageOverflow(page, "phone seasons");
    await page.click('[data-testid="nav-overview"]');
    await page.waitForSelector('[data-testid="active-title"]', { timeout: 10_000 });
    const phoneTitle = (await page.textContent('[data-testid="active-title"]'))?.trim();
    if (phoneTitle !== "Season Champion") {
      throw new Error(`phone title: ${phoneTitle}`);
    }
    await assertNoPageOverflow(page, "phone overview");
    console.log("seasons-e2e ok");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
