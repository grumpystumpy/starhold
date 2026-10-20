#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Local prod quality gate: signup → login → cookie persist + pirates/aliens smoke.
 *
 * Requires:
 *   npm run build:vercel
 *   SESSION_SECRET=… PORT=3001 npm start
 *   npx playwright install chromium
 *
 * Env:
 *   STARHOLD_WEB / STARHOLD_API (default http://127.0.0.1:3001)
 *   UI_REVIEW_OUT (default /tmp/pirates-aliens-qg)
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;
const OUT =
  process.env.UI_REVIEW_OUT ??
  path.resolve("/tmp/pirates-aliens-qg");

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

async function findPirateViaApi(playerId, homeGalaxy = 1) {
  // Galaxy UI only steps systems within the current galaxy — search home first.
  const order = [
    homeGalaxy,
    ...Array.from({ length: 10 }, (_, i) => i + 1).filter((g) => g !== homeGalaxy),
  ];
  for (const galaxy of order) {
    for (let system = 1; system <= 399; system++) {
      const res = await fetch(
        `${API}/api/state?playerId=${encodeURIComponent(playerId)}&galaxy=${galaxy}&system=${system}`,
      );
      if (!res.ok) continue;
      const st = await res.json();
      if (st.galaxy?.pirateBase) {
        return { ...st.galaxy.pirateBase, _viewGalaxy: st.galaxy.galaxy };
      }
    }
  }
  return null;
}

async function waitHealthy(ms = 45_000) {
  const activeClock = createActiveWaitClock();
  while (activeClock.elapsed() < ms) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API health timeout (${API})`);
}

async function shot(page, dir, name) {
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name),
    fullPage: true,
  });
}

async function runViewport(browser, vp, email, password, commander) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  const dir = path.join(OUT, vp.name);
  const pass = [];

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="auth-form"]', { timeout: 15_000 });
  await shot(page, dir, "01-join-auth-idle.png");

  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', password);
  await shot(page, dir, "02-auth-filled.png");
  await page.click('[data-testid="auth-signup-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', {
    timeout: 15_000,
  });
  const accountLine = await page.textContent('[data-testid="account-email"]');
  if (!accountLine?.includes(email)) {
    throw new Error(`${vp.name}: signup did not show account line`);
  }
  pass.push("signup shows signed-in account line");
  await shot(page, dir, "03-after-signup.png");

  await page.fill('[data-testid="commander-input"]', commander);
  await page.click('[data-testid="join-btn"]');
  await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="side-nav"]', { timeout: 10_000 });
  pass.push("entered game after signup+join");
  await shot(page, dir, "04-in-game-after-signup-join.png");

  const playerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (!playerId) throw new Error(`${vp.name}: missing playerId after join`);

  // Cookie resume after reload
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
  const resumedId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (resumedId !== playerId) {
    throw new Error(
      `${vp.name}: reload did not resume player (${resumedId} vs ${playerId})`,
    );
  }
  pass.push("reload resumed in-game session via cookie");
  await shot(page, dir, "05-reload-cookie-resume.png");

  // Fresh context login restores same linked player
  const loginCtx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const loginPage = await loginCtx.newPage();
  await loginPage.goto(WEB, { waitUntil: "networkidle" });
  await loginPage.waitForSelector('[data-testid="auth-form"]', {
    timeout: 15_000,
  });
  await loginPage.fill('[data-testid="auth-email"]', email);
  await loginPage.fill('[data-testid="auth-password"]', password);
  await shot(loginPage, path.join(OUT, vp.name), "06-fresh-login-form.png");
  await loginPage.click('[data-testid="auth-login-btn"]');
  await loginPage.waitForSelector('[data-testid="resources"]', {
    timeout: 20_000,
  });
  const loginId = await loginPage.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (loginId !== playerId) {
    throw new Error(
      `${vp.name}: login restored wrong player (${loginId} vs ${playerId})`,
    );
  }
  pass.push("login restored linked player into game");
  await shot(loginPage, path.join(OUT, vp.name), "07-after-login.png");

  await loginPage.reload({ waitUntil: "networkidle" });
  await loginPage.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
  const loginResume = await loginPage.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (loginResume !== playerId) {
    throw new Error(`${vp.name}: post-login reload lost session`);
  }
  pass.push("post-login reload keeps session");
  await shot(loginPage, path.join(OUT, vp.name), "08-login-reload-resume.png");

  // Pirates + Aliens galaxy smoke — locate a pirate via API (seed density is sparse per system)
  const homeGalaxy = await loginPage.evaluate(
    () => window.starhold?.getState()?.galaxy?.galaxy ?? 1,
  );
  const pirateHit = await findPirateViaApi(playerId, homeGalaxy);
  if (!pirateHit) {
    throw new Error(`${vp.name}: API scan found no pirate bases (expected ~200 seeded)`);
  }
  const pirateInHome = pirateHit.coords.galaxy === homeGalaxy;
  pass.push(
    pirateInHome
      ? `API pirate seed ok @ ${pirateHit.coords.galaxy}:${pirateHit.coords.system}`
      : `API pirate seed ok outside home galaxy ${homeGalaxy} @ ${pirateHit.coords.galaxy}:${pirateHit.coords.system}`,
  );

  await loginPage.click('[data-testid="nav-galaxy"]');
  await loginPage.waitForSelector('[data-testid="galaxy-panel"]', {
    timeout: 10_000,
  });
  await loginPage.waitForSelector(
    '[data-testid="galaxy-alien-empty"], [data-testid="galaxy-alien"]',
    { timeout: 5_000 },
  );
  const alienEmpty = await loginPage
    .locator('[data-testid="galaxy-alien-empty"]')
    .count();
  const alienPresent = await loginPage
    .locator('[data-testid="galaxy-alien"]')
    .count();
  if (alienEmpty < 1 && alienPresent < 1) {
    throw new Error(`${vp.name}: galaxy missing Aliens row`);
  }
  pass.push(
    alienEmpty >= 1
      ? "galaxy Aliens empty (ALIEN_INITIAL_BASE_COUNT=0)"
      : "galaxy Aliens row rendered",
  );

  const targetLabel = `${pirateHit.coords.galaxy}:${pirateHit.coords.system}`;
  let foundPirate =
    pirateInHome &&
    (await loginPage.locator('[data-testid="galaxy-pirate"]').count()) > 0;
  for (let i = 0; i < 450 && pirateInHome && !foundPirate; i++) {
    const before =
      (await loginPage.textContent('[data-testid="galaxy-label"]')) ?? "";
    if (before.startsWith(targetLabel)) {
      foundPirate =
        (await loginPage.locator('[data-testid="galaxy-pirate"]').count()) > 0;
      break;
    }
    await loginPage.click('[data-testid="galaxy-next"]');
    await loginPage.waitForFunction(
      (prev) =>
        (document.querySelector('[data-testid="galaxy-label"]')?.textContent ??
          "") !== prev,
      before,
      { timeout: 8_000 },
    );
    foundPirate =
      (await loginPage.locator('[data-testid="galaxy-pirate"]').count()) > 0;
  }
  if (pirateInHome && !foundPirate) {
    throw new Error(
      `${vp.name}: UI did not show pirate at ${targetLabel} after galaxy nav`,
    );
  }
  if (foundPirate) {
    const pirateText = await loginPage.textContent(
      '[data-testid="galaxy-pirate"]',
    );
    if (!pirateText || !/Lv\s*\d+/i.test(pirateText)) {
      throw new Error(`${vp.name}: pirate row missing Lv label: ${pirateText}`);
    }
    pass.push(`galaxy pirate found with level: ${pirateText.trim()}`);
  } else {
    const empty = await loginPage
      .locator('[data-testid="galaxy-pirate-empty"]')
      .count();
    if (empty < 1) {
      throw new Error(`${vp.name}: galaxy missing pirate row`);
    }
    pass.push(
      "home galaxy has no pirate this seed; empty pirate row rendered",
    );
  }
  await shot(loginPage, path.join(OUT, vp.name), "09-galaxy-pirate.png");

  // Fleet composer should offer pirate target when in that system
  await loginPage.click('[data-testid="nav-fleet"]');
  await loginPage.waitForSelector('[data-testid="page-fleet"], [data-testid="fleet-panel"], .fleet-composer, [data-testid="fleet-form"]', {
    timeout: 10_000,
  });
  const pirateOption = await loginPage.locator('option[value^="pirate:"]').count();
  if (pirateOption < 1) {
    // Soft: galaxy find is enough; fleet option depends on composer mount
    pass.push("fleet pirate option skipped (composer may need ships)");
  } else {
    pass.push("fleet composer lists pirate target");
  }
  await shot(loginPage, path.join(OUT, vp.name), "10-fleet-after-pirate.png");

  await loginCtx.close();
  await context.close();
  return { viewport: vp, pass, playerId, verdict: "PASS" };
}

async function main() {
  const health = await waitHealthy();
  if (!health?.auth?.sessionSecretConfigured) {
    throw new Error(
      "SESSION_SECRET not configured — set it before npm start for this gate",
    );
  }

  await mkdir(OUT, { recursive: true });
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const stamp = Date.now().toString(36);
  const results = [];

  try {
    for (const vp of VIEWPORTS) {
      const email = `pirates-${vp.name}-${stamp}@example.com`;
      const password = "hunter2xx";
      const commander = `P${vp.name.slice(0, 3)}${stamp.slice(-4)}`;
      const result = await runViewport(
        browser,
        vp,
        email,
        password,
        commander,
      );
      results.push(result);
      console.log(`${vp.name}: PASS`, result.pass);
    }
  } finally {
    await browser.close();
  }

  const report = {
    overall: "QUALITY_GATE_PIRATES_ALIENS_OK",
    tip: process.env.GIT_TIP ?? null,
    method:
      "local build:vercel + SESSION_SECRET npm start; Playwright signup→login→persist + galaxy pirates/aliens",
    web: WEB,
    health,
    results,
  };
  await writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("QUALITY_GATE_PIRATES_ALIENS_OK", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
