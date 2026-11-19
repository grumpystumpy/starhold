#!/usr/bin/env node
/**
 * Galaxy System Scanner overlay on a local production build.
 * Requires the API on :3001 with STARHOLD_E2E=1 (the grant hook).
 */
import { createRequire } from "node:module";
import { armWhatsNewDismiss } from "./lib/dismiss-whats-new.mjs";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";
const MAP_SYSTEMS = 399;

function cookieHeader(setCookie) {
  if (!setCookie) return "";
  return String(setCookie)
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body, cookie: cookieHeader(res.headers.get("set-cookie")) };
}

function hintFor(system, level) {
  const from = Math.max(1, system - level);
  const to = Math.min(MAP_SYSTEMS, system + level);
  const text =
    from === to ? `Scanner: system ${from}` : `Scanner: systems ${from}–${to}`;
  return { from, to, text };
}

function outsideSystem(system, level) {
  const above = system + level + 1;
  if (above <= MAP_SYSTEMS) return above;
  const below = system - level - 1;
  if (below >= 1) return below;
  throw new Error(`no system just outside ${system} ±${level}`);
}

async function readOverlay(page) {
  const hint = (
    await page.locator('[data-testid="galaxy-scanner-range"]').textContent()
  )?.trim() ?? "";
  const mark = await page.locator('[data-testid="galaxy-scanner-mark"]').count();
  const label = (
    await page.locator('[data-testid="galaxy-label"]').textContent()
  )?.trim() ?? "";
  return { hint, mark, label };
}

function logLine(viewport, level, system, hint, mark) {
  console.log(
    `SCANNER_OVERLAY_E2E viewport=${viewport} level=${level} system=${system} hint=${JSON.stringify(hint)} mark=${mark}`,
  );
}

async function jumpTo(page, galaxy, system) {
  const input = page.locator('[data-testid="galaxy-jump"]');
  await input.fill(`${galaxy}:${system}`);
  await input.press("Enter");
  const expected = `${galaxy}:${system} /`;
  await page.waitForFunction(
    (label) =>
      document.querySelector('[data-testid="galaxy-label"]')?.textContent?.includes(label) ===
      true,
    expected,
    { timeout: 20_000 },
  );
}

async function expectOverlay(page, viewport, moonSystem, level, viewedSystem) {
  const expected = hintFor(moonSystem, level);
  const inRange = Math.abs(viewedSystem - moonSystem) <= level;
  try {
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="galaxy-scanner-range"]')?.textContent?.trim() ===
        text,
      expected.text,
      { timeout: 20_000 },
    );
  } catch (err) {
    const bar = await page.locator('[data-testid="galaxy-system-bar"]').innerText().catch(() => "");
    throw new Error(`overlay wait for ${JSON.stringify(expected.text)} failed. bar=${JSON.stringify(bar)}\n${err}`);
  }
  const overlay = await readOverlay(page);
  if (overlay.hint !== expected.text) {
    throw new Error(`hint ${JSON.stringify(overlay.hint)} !== ${JSON.stringify(expected.text)}`);
  }
  if (inRange && overlay.mark !== 1) {
    throw new Error(`expected the in-range mark at system ${viewedSystem}`);
  }
  if (!inRange && overlay.mark !== 0) {
    throw new Error(`system ${viewedSystem} is outside range but the mark is showing`);
  }
  logLine(viewport, level, viewedSystem, overlay.hint, overlay.mark);
}

async function main() {
  const health = await api("/api/health");
  if (health.res.status !== 200) throw new Error("API is not healthy");

  const email = `scanner_${Date.now().toString(36)}@example.com`;
  const password = "scanner-pass-99";
  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (signup.res.status !== 200) {
    throw new Error(`signup ${signup.res.status} ${JSON.stringify(signup.body)}`);
  }
  const cookie = signup.cookie;
  const joined = await api("/api/auth/join", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: `ScannerWalk${Date.now().toString(36).slice(-4)}` }),
  });
  if (joined.res.status !== 200) {
    throw new Error(`join ${joined.res.status} ${JSON.stringify(joined.body)}`);
  }
  const playerId = joined.body.player.id;

  const grant = await api("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({
      playerId,
      scannerMoonLevel: 2,
      dismissWhatsNew: true,
    }),
  });
  if (grant.res.status !== 200) {
    throw new Error(`grant ${grant.res.status} ${JSON.stringify(grant.body)}`);
  }
  const moon = grant.body.ownedPlanets?.find((planet) => planet.isMoon);
  if (!moon) throw new Error("grant did not return a moon");
  const system = moon.coords.system;
  const galaxy = moon.coords.galaxy;
  const outside = outsideSystem(system, 2);

  const selected = await api("/api/select-planet", {
    method: "POST",
    body: JSON.stringify({ playerId, planetId: moon.id }),
  });
  if (selected.res.status !== 200) {
    throw new Error(`select ${selected.res.status} ${JSON.stringify(selected.body)}`);
  }
  const funded = await api("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({
      playerId,
      resources: { metal: 200_000, crystal: 200_000, deuterium: 50_000 },
    }),
  });
  if (funded.res.status !== 200) {
    throw new Error(`fund ${funded.res.status} ${JSON.stringify(funded.body)}`);
  }

  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await armWhatsNewDismiss(await browser.newPage());
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${WEB}/galaxy?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "networkidle",
    });
    const dismiss = page.locator('[data-testid="pwa-install-dismiss"]');
    if (await dismiss.count()) await dismiss.click();

    await expectOverlay(page, 1280, system, 2, system);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOverlay(page, 390, system, 2, system);

    await page.setViewportSize({ width: 1280, height: 800 });
    await jumpTo(page, galaxy, outside);
    await expectOverlay(page, 1280, system, 2, outside);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOverlay(page, 390, system, 2, outside);

    await page.evaluate(() => window.starhold.upgrade("sensorArray"));
    const queued = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    const item = queued.body?.planet?.buildQueue?.find(
      (entry) => entry.buildingId === "sensorArray",
    );
    if (!item) {
      throw new Error(
        `scanner upgrade did not queue: ${JSON.stringify(queued.body?.planet?.buildQueue)}`,
      );
    }
    console.log(
      `SCANNER_OVERLAY_E2E upgrade queued target=${item.targetLevel} completesAt=${item.completesAt}`,
    );

    const wider = hintFor(system, 3).text;
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="galaxy-scanner-range"]')?.textContent?.trim() ===
        text,
      wider,
      { timeout: 45_000 },
    );
    await expectOverlay(page, 390, system, 3, outside);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectOverlay(page, 1280, system, 3, outside);

    const done = await api(
      `/api/state?playerId=${encodeURIComponent(playerId)}&scanners=1`,
    );
    const scanner = done.body?.scannerMoons?.find((entry) => entry.planetId === moon.id);
    if (scanner?.sensorArray !== 3 || scanner?.range !== 3) {
      throw new Error(`scanner did not finish at level 3: ${JSON.stringify(scanner)}`);
    }
    console.log(
      `SCANNER_OVERLAY_E2E scannerMoon sensorArray=${scanner.sensorArray} range=${scanner.range}`,
    );
    console.log("SCANNER_OVERLAY_E2E_PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("SCANNER_OVERLAY_E2E_FAIL", err);
  process.exit(1);
});
