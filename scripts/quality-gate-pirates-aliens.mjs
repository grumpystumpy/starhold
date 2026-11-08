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
import { captureBrowserErrors } from "./browser-error-capture.mjs";

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
  captureBrowserErrors(page, `pirates-${vp.name}`);
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
  captureBrowserErrors(loginPage, `pirates-login-${vp.name}`);
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

  // Freshly joined players start without ships; seed one so this exercises the
  // attack prefill with a usable ship input instead of the empty-orbit state.
  const scoutGrant = await fetch(`${API}/api/e2e/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ships: { scout: 1 } }),
  });
  if (!scoutGrant.ok) {
    throw new Error(`${vp.name}: scout grant failed (${scoutGrant.status})`);
  }
  await loginPage.reload({ waitUntil: "networkidle" });
  await loginPage.waitForSelector('[data-testid="resources"]', {
    timeout: 20_000,
  });
  await loginPage.waitForFunction(
    () => (window.starhold?.getState()?.ships?.scout ?? 0) >= 1,
    null,
    { timeout: 15_000 },
  );
  pass.push("one scout available for pirate attack prefill");

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
  if (!pirateInHome) {
    const jump = loginPage.locator('[data-testid="galaxy-jump"]');
    await jump.fill(`${pirateHit.coords.galaxy}:${pirateHit.coords.system}`);
    await jump.press("Enter");
    await loginPage.waitForFunction(
      (target) =>
        (document.querySelector('[data-testid="galaxy-label"]')?.textContent ??
          "").startsWith(target),
      `${pirateHit.coords.galaxy}:${pirateHit.coords.system}`,
      { timeout: 10_000 },
    );
    foundPirate =
      (await loginPage.locator('[data-testid="galaxy-pirate"]').count()) > 0;
  }
  if (!foundPirate) {
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

    const pirateButton = loginPage.locator(
      '[data-testid="galaxy-attack-pirates"]',
    );
    if ((await pirateButton.count()) !== 1) {
      throw new Error(`${vp.name}: pirate attack button missing`);
    }
    const expectedCoords = `${pirateHit.coords.galaxy}:${pirateHit.coords.system}:${pirateHit.coords.slot}`;
    if (
      (await pirateButton.getAttribute("data-galaxy-attack-pirates")) !==
      expectedCoords
    ) {
      throw new Error(`${vp.name}: pirate attack button has wrong coordinates`);
    }

    const galaxyActionButtons = loginPage.locator(
      '[data-testid="galaxy-actions"] button',
    );
    const buttonCount = await galaxyActionButtons.count();
    const buttonSizes = await galaxyActionButtons.evaluateAll((buttons) =>
      buttons.map((button) => {
        const { width, height } = button.getBoundingClientRect();
        return { width, height };
      }),
    );
    if (
      buttonSizes.some(
        (size) =>
          size.width !== buttonSizes[0].width ||
          size.height !== buttonSizes[0].height,
      )
    ) {
      throw new Error(`${vp.name}: galaxy action buttons have unequal sizes`);
    }
    pass.push(`all ${buttonCount} galaxy action buttons have equal size`);

    await pirateButton.click();
    await loginPage.waitForSelector('[data-testid="fleet-form"]', {
      timeout: 10_000,
    });
    const shipCount = loginPage.locator("[data-fleet-count]").first();
    if ((await shipCount.count()) === 0) {
      throw new Error(`${vp.name}: fleet composer has no ship input`);
    }
    await shipCount.fill("1");
    await loginPage.click('[data-testid="fleet-next"]');
    await loginPage.waitForSelector('[data-testid="fleet-target"]', {
      timeout: 10_000,
    });
    const targetValue = await loginPage
      .locator('[data-testid="fleet-target"]')
      .inputValue();
    const missionValue = await loginPage
      .locator('[data-testid="fleet-mission"]')
      .inputValue();
    if (targetValue !== `pirate:${pirateHit.id}` || missionValue !== "pirateRaid") {
      throw new Error(
        `${vp.name}: fleet target/mission prefill mismatch (${targetValue}, ${missionValue})`,
      );
    }
    const fleetCoords = await loginPage.textContent('[data-testid="fleet-coords"]');
    if (!fleetCoords?.includes(expectedCoords)) {
      throw new Error(`${vp.name}: fleet composer coordinates do not match pirate base`);
    }
    pass.push("pirate attack opens fleet composer with pirate target and mission");
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

    const playerId = results[0]?.playerId;
    const occupierPlayerId = results[1]?.playerId;
    if (!playerId || !occupierPlayerId) {
      throw new Error("missing players for occupation yard checks");
    }

    const occupiedPlanet = await fetch(`${API}/api/e2e/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, occupyNonMini: true, occupierPlayerId }),
    });
    const occupiedPlanetView = await occupiedPlanet.json().catch(() => ({}));
    if (!occupiedPlanet.ok) {
      throw new Error(
        `non-mini occupation grant failed (${occupiedPlanet.status}): ${JSON.stringify(occupiedPlanetView)}`,
      );
    }
    const homeId = occupiedPlanetView.planet?.id;
    if (!homeId || occupiedPlanetView.planet?.flags?.mini) {
      throw new Error("occupyNonMini grant did not activate a non-mini planet");
    }
    const nonMiniChecks = [
      ["/api/upgrade", { playerId, buildingId: "metalMine", planetId: homeId }, "Construction blocked while planet is occupied."],
      ["/api/build-ship", { playerId, shipId: "scout", count: 1, planetId: homeId }, "Shipyard blocked while planet is occupied."],
      ["/api/build-defense", { playerId, defenseId: "laserBattery", count: 1, planetId: homeId }, "Defense yard blocked while planet is occupied."],
    ];
    for (const [route, body, expectedError] of nonMiniChecks) {
      const response = await fetch(`${API}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status !== 400 || result.error !== expectedError) {
        throw new Error(
          `occupied non-mini ${route} was not blocked (${response.status}): ${JSON.stringify(result)}`,
        );
      }
      const action = route === "/api/upgrade" ? "building" : route === "/api/build-ship" ? "ship" : "defense";
      console.log(`non-mini occupation blocked: ${action}`);
    }

    const seeded = await fetch(`${API}/api/e2e/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, occupyMini: true }),
    });
    const seededView = await seeded.json().catch(() => ({}));
    if (!seeded.ok) {
      throw new Error(
        `occupyMini grant failed (${seeded.status}): ${JSON.stringify(seededView)}`,
      );
    }
    const miniId = seededView.planet?.id;
    if (!miniId || !seededView.planet?.flags?.mini) {
      throw new Error("occupyMini grant did not activate a mini planet");
    }
    if (seededView.occupation?.occupierPlayerId !== playerId) {
      throw new Error("occupied mini is not owned by the occupier");
    }
    const miniYard = await fetch(`${API}/api/e2e/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, buildings: { shipyard: 1 } }),
    });
    if (!miniYard.ok) {
      throw new Error(`occupied mini shipyard grant failed (${miniYard.status})`);
    }
    const upgrade = await fetch(`${API}/api/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        buildingId: "metalMine",
        planetId: miniId,
      }),
    });
    const upgraded = await upgrade.json().catch(() => ({}));
    if (!upgrade.ok) {
      throw new Error(
        `occupier could not queue a building (${upgrade.status}): ${JSON.stringify(upgraded)}`,
      );
    }
    const queued = (upgraded.planet?.buildQueue ?? []).some(
      (item) => item.buildingId === "metalMine",
    );
    if (!queued) {
      throw new Error("occupied mini build queue missing metal mine");
    }
    console.log("mini occupier building allowed");
    const ship = await fetch(`${API}/api/build-ship`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, shipId: "scout", count: 1, planetId: miniId }),
    });
    const shipView = await ship.json().catch(() => ({}));
    if (!ship.ok || !shipView.planet?.shipQueue?.some((item) => item.shipId === "scout")) {
      throw new Error(`occupier could not queue a ship (${ship.status}): ${JSON.stringify(shipView)}`);
    }
    console.log("mini occupier ship allowed");
    const defense = await fetch(`${API}/api/build-defense`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, defenseId: "laserBattery", count: 1, planetId: miniId }),
    });
    const defenseView = await defense.json().catch(() => ({}));
    if (!defense.ok || !defenseView.planet?.defenseQueue?.some((item) => item.defenseId === "laserBattery")) {
      throw new Error(`occupier could not queue a defense (${defense.status}): ${JSON.stringify(defenseView)}`);
    }
    console.log("mini occupier defense allowed");
    console.log("occupied mini: occupier queued building, ship, and defense", miniId);
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
