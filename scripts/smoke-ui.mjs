#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Local smoke: UI join (URL + typed + helper), upgrade level via click, build-ship,
 * P1 flashes, fleet mission (attack + loot report).
 * Requires: npm run dev (web :5173, api :3001) and playwright + chromium.
 *
 * Steps (manual equivalent):
 * 1. Open http://127.0.0.1:5173/?commander=Smoke
 *    or type a name / run window.starhold.join("Smoke")
 * 2. Click Upgrade on Shipyard — level must rise 0→1 (not a silent no-op under polls).
 *    While "Queue busy", click another Upgrade — red flash must survive ~2s of polls.
 * 3. Click Metal Vault when unaffordable — flash "Not enough resources."
 * 4. Bank to ≥220 metal, click Build on Scout — hangar scout increments.
 * 5. Second commander + UI Launch fleet (attack) → combat report with loot path.
 */
import { createRequire } from "node:module";
import { runPollCadence } from "./poll-cadence-e2e.mjs";
import { fleetToStep2 } from "./lib/fleet-two-step.mjs";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:5173";
const API = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";

async function waitHealthy(ms = 30_000) {
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

async function apiJson(path, init) {
  const res = await fetch(`${API}${path}`, init);
  return res.json();
}

// Wait on the server's own progress: sleep until the build queue's endsAt
// and until production (economy.productionPerHour) should cover the gap,
// re-reading state between sleeps (1s-20s each). The deadline is the larger
// of `ms` and the server's own ETA plus a 2-minute margin, capped at 15 min,
// so a slow fresh Workers universe doesn't fail on a fixed clock.
async function waitMetal(playerId, minMetal, ms = 360_000) {
  const activeClock = createActiveWaitClock();
  const activeStart = activeClock.now();
  let deadline = activeStart + ms;
  let last = null;
  while (activeClock.now() < deadline) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if (st?.error) throw new Error(`waitMetal state: ${st.error}`);
    const buildQ = st.planet.buildQueue;
    const buildIdle = !buildQ || (Array.isArray(buildQ) ? buildQ.length === 0 : false);
    const metal = st.planet.resources.metal;
    if (metal >= minMetal && buildIdle) {
      return st;
    }
    const now = Date.now();
    const queueEnd = Array.isArray(buildQ)
      ? Math.max(0, ...buildQ.map((q) => q.endsAt ?? 0))
      : 0;
    const rate = st.economy?.productionPerHour?.metal ?? 0;
    const metalEta = rate > 0 ? now + ((minMetal - metal) / rate) * 3_600_000 : 0;
    const eta = Math.max(queueEnd, metalEta);
    if (eta > 0) {
      deadline = Math.max(
        deadline,
        Math.min(activeStart + 900_000, activeClock.now() + eta - now + 120_000),
      );
    }
    last = { metal: Math.floor(metal), rate, queue: buildQ?.length ?? 0, etaS: eta ? Math.round((eta - now) / 1000) : null };
    const sleep = Math.min(20_000, Math.max(1_000, eta - now));
    await new Promise((r) => setTimeout(r, sleep));
  }
  throw new Error(`timeout waiting for ${minMetal} metal: ${JSON.stringify(last)}`);
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
  if (!Array.isArray(up.planet?.buildQueue) || up.planet.buildQueue.length < 1) {
    throw new Error(`expected buildQueue array after yard: ${JSON.stringify(up.planet?.buildQueue)}`);
  }

  // Base building queue length is 2 — second item should enqueue.
  const second = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalMine" }),
  });
  if (second.error) throw new Error(`second queue item: ${second.error}`);
  if ((second.planet?.buildQueue?.length ?? 0) !== 2) {
    throw new Error(`expected 2 queued buildings, got: ${JSON.stringify(second.planet?.buildQueue)}`);
  }

  // Third item hits base cap.
  const full = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "crystalMine" }),
  });
  if (!full.error || !/full/i.test(full.error)) {
    throw new Error(`expected queue-full error, got: ${JSON.stringify(full)}`);
  }

  const vault = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalStorage" }),
  });
  if (!vault.error) throw new Error("expected vault reject while poor/full");

  // Cancel tail then front via Round 2 queue API.
  const tailId = second.planet.buildQueue[1].id;
  const cancelTail = await apiJson("/api/queue/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      kind: "building",
      itemId: tailId,
      planetId: second.planet.id,
    }),
  });
  if (cancelTail.error) throw new Error(`cancel tail: ${cancelTail.error}`);
  if ((cancelTail.planet?.buildQueue?.length ?? 0) !== 1) {
    throw new Error(`expected 1 item after cancel, got: ${JSON.stringify(cancelTail.planet?.buildQueue)}`);
  }

  await waitMetal(playerId, 220, 360_000);

  const ship = await apiJson("/api/build-ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, shipId: "scout", count: 1 }),
  });
  if (ship.error) throw new Error(`build scout: ${ship.error}`);

  let scoutReady = null;
  for (let i = 0; i < 30; i++) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if ((st.planet?.ships?.scout ?? 0) >= 1) {
      scoutReady = st;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!scoutReady) throw new Error("scout never entered hangar");

  const victimName = `Vic${Date.now().toString(36).slice(-5)}`;
  const victim = await apiJson("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: victimName }),
  });
  if (!victim.player?.id || !victim.planet?.id) {
    throw new Error(`victim join failed: ${JSON.stringify(victim)}`);
  }

  // Clear newbie protection on the victim so PvP raid e2e still runs.
  const graduated = await apiJson("/api/e2e/graduate-newbie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: victim.player.id }),
  });
  if (graduated.error) {
    throw new Error(
      `graduate-newbie hook failed (is ALLOW_E2E_HOOKS=1?): ${JSON.stringify(graduated)}`,
    );
  }

  const launch = await apiJson("/api/launch-fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      targetPlanetId: victim.planet.id,
      mission: "raid",
      ships: { scout: 1 },
    }),
  });
  if (launch.error) throw new Error(`launch fleet mission: ${launch.error}`);
  if (!Array.isArray(launch.fleets) || launch.fleets.length < 1) {
    throw new Error(`expected outbound fleet: ${JSON.stringify(launch.fleets)}`);
  }

  const outboundMs = Math.max(0, launch.fleets[0].arrivesAt - Date.now());
  const activeClock = createActiveWaitClock();
  const deadline = activeClock.now() + Math.max(90_000, outboundMs * 3 + 20_000);
  let reportSeen = false;
  let lootOk = false;
  while (activeClock.now() < deadline) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if ((st.reports?.length ?? 0) >= 1) {
      reportSeen = true;
      const r = st.reports[0];
      const lootTotal =
        (r.loot?.metal ?? 0) + (r.loot?.crystal ?? 0) + (r.loot?.deuterium ?? 0);
      lootOk = Boolean(r.outcome) && (lootTotal >= 0);
    }
    if (reportSeen && lootOk && (st.fleets?.length ?? 0) === 0) {
      console.log("API smoke OK", {
        name,
        playerId,
        scout: st.planet.ships.scout,
        reports: st.reports.length,
        loot: st.reports[0]?.loot,
      });
      return { name, playerId, victimName };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `fleet mission never resolved / returned (outboundEtaMs≈${outboundMs}, reportSeen=${reportSeen})`,
  );
}

/** Map legacy Round-1 page ids to Round-2 nav testids (Thread G). */
const NAV_ALIAS = {
  facilities: "buildings",
  resources: "buildings",
  defense: "defenses",
};

const SHOP_TAB_PAGES = new Set(["officers", "skills"]);

/** Background polls are 30s, so waits that need tick-on-read call poll() themselves. */
async function pollUntil(page, label, ready, timeoutMs) {
  const activeClock = createActiveWaitClock();
  let last = null;
  while (activeClock.elapsed() < timeoutMs) {
    last = await page.evaluate(ready);
    if (last === true) return;
    await page.evaluate(() => window.starhold?.poll());
    await page.waitForTimeout(750);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

async function goNav(page, id) {
  const navId = NAV_ALIAS[id] ?? id;
  if (SHOP_TAB_PAGES.has(navId)) {
    // Officers/Skills live as tabs under the Shop page (B5-01).
    await page.click('[data-testid="nav-shop"]');
    await page.click(`[data-testid="shop-tab-${navId}"]`);
    await page.waitForSelector(`[data-testid="page-${navId}"]`, { timeout: 10_000 });
    return;
  }
  await page.click(`[data-testid="nav-${navId}"]`);
  await page.waitForSelector(`[data-testid="page-${navId}"]`, {
    timeout: 10_000,
  });
}

async function uiSmoke() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const logs = [];

  const urlName = `Url${Date.now().toString(36).slice(-4)}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${WEB}/?commander=${encodeURIComponent(urlName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="side-nav"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="player-level"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="xp-bar"]', { timeout: 5_000 });
  logs.push("ui-player-level");
  await goNav(page, "seasons");
  await page.waitForSelector('[data-testid="seasons-panel"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="season-board-combat"]', { timeout: 5_000 });
  logs.push("ui-seasons");
  await goNav(page, "highscore");
  await page.waitForSelector('[data-testid="highscores"]', { timeout: 10_000 });
  const hsRank = await page.locator('[data-testid="highscore-1"]').count();
  if (hsRank < 1) throw new Error("highscores missing rank #1");
  logs.push("ui-highscores");
  await goNav(page, "officers");
  await page.waitForSelector('[data-testid="officers-panel"]', { timeout: 10_000 });
  await goNav(page, "skills");
  await page.waitForSelector('[data-testid="skills-panel"]', { timeout: 10_000 });
  const claimDaily = await page.locator('[data-testid="claim-daily"]').count();
  if (claimDaily < 1) throw new Error("claim-daily missing from resource bar");
  logs.push("ui-officers-skills");
  const galaxyHasMoon = await page.evaluate(() => {
    const st = window.starhold?.getState();
    const slots = st?.galaxy?.slots ?? [];
    return slots.length > 0 && slots.every((s) => typeof s.hasMoon === "boolean");
  });
  if (!galaxyHasMoon) throw new Error("galaxy slots missing hasMoon");
  logs.push("ui-galaxy-moon-field");

  // Pirates + Aliens redesign smoke (galaxy chrome)
  await goNav(page, "galaxy");
  await page.waitForSelector('[data-testid="galaxy-panel"]', { timeout: 10_000 });
  const alienChrome =
    (await page.locator('[data-testid="galaxy-alien-empty"]').count()) +
    (await page.locator('[data-testid="galaxy-alien"]').count());
  if (alienChrome < 1) throw new Error("galaxy missing Aliens row");
  logs.push("ui-galaxy-aliens-row");
  const playerIdForPirate = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (!playerIdForPirate) throw new Error("missing playerId for pirate scan");
  const homeGalaxy = await page.evaluate(
    () => window.starhold?.getState()?.galaxy?.galaxy ?? 1,
  );
  // Workers seeds pirates lazily, a few per request (world-seed.ts), so a
  // fresh local universe may not have placed them yet. Scan the home galaxy
  // once. If it's empty and the API is local, advance the seed with up to
  // 150 plain state reads, then scan once more. Worst case: 399+150+399
  // local requests, once per run. Node (CI) seeds eagerly and never waits.
  const scanHome = async () => {
    for (let system = 1; system <= 399; system++) {
      const st = await apiJson(
        `/api/state?playerId=${encodeURIComponent(playerIdForPirate)}&galaxy=${homeGalaxy}&system=${system}`,
      );
      if (st?.error) throw new Error(`pirate scan ${homeGalaxy}:${system}: ${st.error}`);
      if (st.galaxy?.pirateBase) return st.galaxy.pirateBase;
    }
    return null;
  };
  let pirateHit = await scanHome();
  const localApi = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API);
  if (!pirateHit && localApi) {
    console.log("Pirate seed wait: 150 state reads, then one rescan");
    logs.push("pirate-seed-wait");
    for (let i = 0; i < 150; i++) {
      await apiJson(`/api/state?playerId=${encodeURIComponent(playerIdForPirate)}`);
    }
    pirateHit = await scanHome();
  }
  // The UI can't cross galaxies (S2-F2), so only the home galaxy counts.
  if (!pirateHit) {
    throw new Error(
      `no pirate in home galaxy ${homeGalaxy}; UI cannot cross galaxies`,
    );
  }
  logs.push(
    `api-pirate:${pirateHit.coords.galaxy}:${pirateHit.coords.system}`,
  );
  const targetLabel = `${pirateHit.coords.galaxy}:${pirateHit.coords.system}`;
  let foundPirate =
    (await page.locator('[data-testid="galaxy-pirate"]').count()) > 0;
  for (let i = 0; i < 450 && !foundPirate; i++) {
    const before =
      (await page.textContent('[data-testid="galaxy-label"]')) ?? "";
    if (before.startsWith(`${targetLabel} `)) {
      foundPirate =
        (await page.locator('[data-testid="galaxy-pirate"]').count()) > 0;
      break;
    }
    await page.click('[data-testid="galaxy-next"]');
    await page.waitForFunction(
      (prev) =>
        (document.querySelector('[data-testid="galaxy-label"]')?.textContent ??
          "") !== prev,
      before,
      { timeout: 8_000 },
    );
    foundPirate =
      (await page.locator('[data-testid="galaxy-pirate"]').count()) > 0;
  }
  if (!foundPirate) {
    throw new Error(`galaxy UI missing pirate at ${targetLabel}`);
  }
  logs.push("ui-galaxy-pirate-found");

  const joined = await page.evaluate(() => window.starhold?.getState());
  if (joined?.name !== urlName) {
    throw new Error(`URL join failed: ${JSON.stringify(joined)}`);
  }
  logs.push(`url-join:${urlName}`);

  await goNav(page, "facilities");
  const yardLevelBefore = await page.textContent(
    '[data-testid="building-level-shipyard"]',
  );
  if (!yardLevelBefore?.includes("L0")) {
    throw new Error(`expected shipyard L0 before click, got: ${yardLevelBefore}`);
  }
  const yardBtn = page.locator('[data-testid="upgrade-shipyard"]');
  const yardAttr = await yardBtn.getAttribute("data-upgrade");
  if (yardAttr !== "shipyard") {
    throw new Error(`upgrade-shipyard data-upgrade mismatch: ${yardAttr}`);
  }

  const pollHammer = await page.evaluateHandle(() => {
    const id = window.setInterval(() => {
      void window.starhold?.poll();
    }, 80);
    return id;
  });
  try {
    for (let i = 0; i < 8; i++) {
      await yardBtn.click({ timeout: 5_000 });
      await page.waitForTimeout(90);
      const leveled = await page.evaluate(() => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? "";
        const queue = document.querySelector('[data-testid="build-queue"]');
        const ok = document.querySelector('[data-testid="flash-ok"]');
        return (
          lvl.includes("L1") ||
          Boolean(queue?.textContent?.match(/Shipyard/i)) ||
          Boolean(ok?.textContent?.match(/Queued upgrade|Upgrade complete/i))
        );
      });
      if (leveled) break;
    }
    await page.waitForFunction(
      () => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? "";
        const queue = document.querySelector('[data-testid="build-queue"]');
        const ok = document.querySelector('[data-testid="flash-ok"]');
        const st = window.starhold?.getState();
        return (
          lvl.includes("L1") ||
          (st?.buildings?.shipyard ?? 0) >= 1 ||
          Boolean(queue?.textContent?.match(/Shipyard/i)) ||
          Boolean(ok?.textContent?.match(/Queued upgrade|Upgrade complete/i))
        );
      },
      undefined,
      { timeout: 15_000 },
    );
    // pollUntil asks the server each loop (tick-on-read); background polls
    // are 30 s apart, which a fresh, still-seeding Workers universe can miss.
    await pollUntil(
      page,
      "shipyard built",
      () => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? "";
        const queue = document.querySelector('[data-testid="build-queue"]');
        const st = window.starhold?.getState();
        return (lvl.includes("L1") || (st?.buildings?.shipyard ?? 0) >= 1) && !queue;
      },
      90_000,
    );
  } finally {
    await page.evaluate((id) => window.clearInterval(id), pollHammer);
  }
  const yardLevelAfter = await page.textContent(
    '[data-testid="building-level-shipyard"]',
  );
  const yardState = await page.evaluate(
    () => window.starhold?.getState()?.buildings?.shipyard ?? 0,
  );
  if (!yardLevelAfter?.includes("L1") && yardState < 1) {
    throw new Error(
      `UI upgrade did not raise shipyard level (before=${yardLevelBefore}, after=${yardLevelAfter}, state=${yardState})`,
    );
  }
  logs.push("ui-upgrade-shipyard-level-under-poll-hammer");

  await goNav(page, "resources");
  await page.click('[data-testid="upgrade-solarPlant"]');
  await page.waitForSelector('[data-testid="flash-ok"], [data-testid="build-queue"]', {
    timeout: 10_000,
  });
  // Base queue length 2 — second item should enqueue (multi-item queues).
  await page.click('[data-testid="upgrade-crystalMine"]');
  await page.waitForFunction(
    () => {
      const items = document.querySelectorAll('[data-testid="build-queue-item"]');
      const ok = document.querySelector('[data-testid="flash-ok"]');
      return items.length >= 2 || Boolean(ok?.textContent?.match(/Queued upgrade/i));
    },
    undefined,
    { timeout: 10_000 },
  );
  logs.push("p1-multi-queue-second-item");

  // Third item should hit the base cap. The control is disabled while the
  // queue is full, and background polls are 30s, so drive the action through
  // the page helper instead of waiting for Playwright to enable the button.
  await page.evaluate(() => window.starhold.upgrade("metalMine"));
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const errText = await page.textContent('[data-testid="flash-error"]');
  if (!errText?.match(/full|Not enough resources/i)) {
    throw new Error(`bad queue-full flash: ${errText}`);
  }
  await page.waitForTimeout(2500);
  if ((await page.locator('[data-testid="flash-error"]').count()) < 1) {
    throw new Error("flash cleared by polls too early");
  }
  logs.push("p1-queue-full-flash");

  await page.evaluate(() => window.starhold.upgrade("metalStorage"));
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const vaultErr = await page.textContent('[data-testid="flash-error"]');
  if (
    !vaultErr?.includes("Not enough resources") &&
    !vaultErr?.match(/full/i)
  ) {
    throw new Error(`bad vault flash: ${vaultErr}`);
  }
  logs.push("p1-unaffordable-or-full-flash");

  const typedPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await typedPage.goto(WEB, { waitUntil: "networkidle" });
  await typedPage.waitForSelector('[data-testid="commander-input"]');
  const typed = `Type${Date.now().toString(36).slice(-4)}`;
  await typedPage.click('[data-testid="commander-input"]');
  await typedPage.fill('[data-testid="commander-input"]', typed);
  const val = await typedPage.inputValue('[data-testid="commander-input"]');
  if (val !== typed) throw new Error(`input value bind failed: ${val}`);
  await typedPage.waitForTimeout(300);
  const val2 = await typedPage.inputValue('[data-testid="commander-input"]');
  if (val2 !== typed) throw new Error(`input wiped after delay: ${val2}`);
  await typedPage.click('[data-testid="join-btn"]');
  await typedPage.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  logs.push(`typed-join:${typed}`);

  const helpPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await helpPage.goto(WEB, { waitUntil: "networkidle" });
  const helperName = `Help${Date.now().toString(36).slice(-4)}`;
  await helpPage.evaluate(async (n) => {
    await window.starhold.join(n);
  }, helperName);
  await helpPage.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  logs.push(`helper-join:${helperName}`);

  const buildName = `Clk${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${WEB}/?commander=${encodeURIComponent(buildName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="resources"]');
  await goNav(page, "facilities");
  const hammer2 = await page.evaluateHandle(() =>
    window.setInterval(() => {
      void window.starhold?.poll();
    }, 100),
  );
  try {
    await page.click('[data-testid="upgrade-shipyard"]');
    await page.waitForFunction(
      () => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? "";
        return (
          lvl.includes("L1") ||
          (window.starhold?.getState()?.buildings?.shipyard ?? 0) >= 1
        );
      },
      undefined,
      { timeout: 30_000 },
    );
  } finally {
    await page.evaluate((id) => window.clearInterval(id), hammer2);
  }

  await goNav(page, "shipyard");
  // Outer slots accrue a few metal a minute. Top up so the Build click does
  // not depend on which home slot this commander drew.
  const scoutPlayerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (!scoutPlayerId) throw new Error("missing player for scout grant");
  const granted = await apiJson("/api/e2e/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId: scoutPlayerId,
      resources: { metal: 800, crystal: 500, deuterium: 200 },
    }),
  });
  if (granted.error) throw new Error(`scout grant failed: ${granted.error}`);
  await page.evaluate(() => window.starhold.poll());
  await pollUntil(
    page,
    "scout build ready",
    () => {
      const btn = document.querySelector('[data-testid="build-scout"]');
      const metalText =
        document.querySelector('[data-testid="res-metal"] .value')?.textContent ?? "0";
      const metal = Number(String(metalText).replace(/,/g, ""));
      const label = btn?.textContent ?? "";
      const queue = Boolean(document.querySelector('[data-testid="build-queue"]'));
      const shipQ = Boolean(document.querySelector('[data-testid="ship-queue"]'));
      const ready =
        Boolean(btn) &&
        !queue &&
        !shipQ &&
        !label.includes("Locked") &&
        metal >= 220;
      return ready
        ? true
        : {
            metalText,
            label,
            queue,
            shipQ,
            hasButton: Boolean(btn),
            yard: window.starhold?.getState()?.buildings?.shipyard ?? null,
          };
    },
    240_000,
  );

  await page.click('[data-testid="build-scout"]');
  await page.waitForFunction(
    () => {
      const hangar = document.querySelector('[data-testid="hangar-count-scout"]');
      const q = document.querySelector('[data-testid="ship-queue"]');
      const ok = document.querySelector('[data-testid="flash-ok"]');
      const n = Number(String(hangar?.textContent ?? "0").replace(/,/g, ""));
      return n >= 1 || Boolean(q) || Boolean(ok?.textContent?.match(/scout|Hangar|Queued/i));
    },
    undefined,
    { timeout: 15_000 },
  );

  await pollUntil(
    page,
    "scout hangar",
    () => {
      const hangar = document.querySelector('[data-testid="hangar-count-scout"]');
      const n = Number(String(hangar?.textContent ?? "0").replace(/,/g, ""));
      return n >= 1 ? true : { hangar: hangar?.textContent ?? null };
    },
    30_000,
  );
  logs.push("ui-build-scout");

  await page.waitForTimeout(1500);
  const hangarCountText =
    (await page.textContent('[data-testid="hangar-count-scout"]')) ?? "0";
  const noticeOrHangar =
    (await page.locator('[data-testid="flash-ok"]').count()) >= 1 ||
    Number(String(hangarCountText).replace(/,/g, "")) >= 1;
  if (!noticeOrHangar) throw new Error("lost build feedback after poll");
  logs.push("build-feedback-ok");

  const rivalName = `Riv${Date.now().toString(36).slice(-4)}`;
  const rivalPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await rivalPage.goto(`${WEB}/?commander=${encodeURIComponent(rivalName)}`, {
    waitUntil: "networkidle",
  });
  await rivalPage.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  logs.push(`rival-join:${rivalName}`);
  // getState() exposes playerId (not player.id) + roster planet ids.
  const rivalMeta = await rivalPage.evaluate(() => {
    const st = window.starhold?.getState();
    const playerId = st?.playerId ?? null;
    const planetId =
      st?.roster?.find((r) => r.id === playerId)?.planetId ?? null;
    return { playerId, planetId };
  });
  if (!rivalMeta.playerId || !rivalMeta.planetId) {
    throw new Error(`rival join missing ids: ${JSON.stringify(rivalMeta)}`);
  }
  const grad = await apiJson("/api/e2e/graduate-newbie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: rivalMeta.playerId }),
  });
  if (grad.error) {
    throw new Error(`UI rival graduate failed: ${JSON.stringify(grad)}`);
  }
  logs.push("rival-graduated");

  await page.reload({ waitUntil: "networkidle" });
  const hasResources = await page.locator('[data-testid="resources"]').count();
  if (!hasResources) {
    await page.goto(`${WEB}/?commander=${encodeURIComponent(buildName)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector('[data-testid="resources"]');
  }
  await goNav(page, "overview");
  const rec = await page.locator('[data-testid="recommended-next"]').count();
  if (rec < 1) throw new Error("recommended-next hint missing");
  await goNav(page, "resources");
  const thumb = await page.locator('[data-testid="building-metalMine"] img.thumb').count();
  if (thumb < 1) throw new Error("building thumbnail missing");
  await goNav(page, "fleet");
  await page.waitForSelector('[data-testid="fleet-form"]', { timeout: 15_000 });
  await fleetToStep2(page, { scout: 1 });
  logs.push("fleet-form-and-art");

  await page.click('[data-testid="mission-raid"]');
  // Default target is roster[0] (often another newbie). Aim at the graduated rival.
  await page.waitForFunction(
    (planetId) => {
      const sel = document.querySelector('[data-testid="fleet-target"]');
      return Boolean(
        sel &&
          [...sel.options].some((o) => o.value === `planet:${planetId}`),
      );
    },
    rivalMeta.planetId,
    { timeout: 10_000 },
  );
  await page.selectOption(
    '[data-testid="fleet-target"]',
    `planet:${rivalMeta.planetId}`,
  );
  await page.click('[data-testid="launch-fleet"]');
  await page.waitForSelector('[data-testid="fleets-live"], [data-testid="flash-ok"]', {
    timeout: 10_000,
  });
  const launchErr = await page.locator('[data-testid="flash-error"]').count();
  if (launchErr > 0) {
    const errText = await page.textContent('[data-testid="flash-error"]');
    throw new Error(`UI fleet launch error: ${errText}`);
  }
  logs.push("ui-fleet-mission-launch");

  // Flight time grows with distance to the rival (a reused DB has more
  // players, so the rival can sit several systems away). Recompute the
  // deadline on every poll from the fleets' current arrivesAt (+60s margin,
  // at least 2 min from launch), capped at 10 min from launch, so a fleet the
  // client hasn't seen yet still extends the wait once it shows up.
  const activeClock = createActiveWaitClock();
  let reportLast = null;
  let reportMaxWait = 120_000;
  for (;;) {
    reportLast = await page.evaluate(() => {
      const st = window.starhold?.getState();
      const fleets = st?.fleets ?? [];
      const reports = st?.reports?.length ?? 0;
      const arrivesAt = Math.max(0, ...fleets.map((f) => f.arrivesAt ?? 0));
      return { reports, fleets: fleets.length, arrivesAt, now: Date.now() };
    });
    if (reportLast.reports >= 1) break;
    if (reportLast.arrivesAt > 0) {
      reportMaxWait = Math.min(
        600_000,
        Math.max(reportMaxWait, Math.max(0, reportLast.arrivesAt - reportLast.now) + 60_000 + activeClock.elapsed()),
      );
    }
    if (activeClock.elapsed() >= reportMaxWait) {
      throw new Error(`fleet report timed out after ${Math.round(reportMaxWait / 1000)}s: ${JSON.stringify(reportLast)}`);
    }
    await page.evaluate(() => window.starhold?.poll());
    await page.waitForTimeout(2_000);
  }
  logs.push(`fleet-report-wait-ms:${Math.round(reportMaxWait)}`);
  await goNav(page, "messages");
  await page.waitForSelector('[data-testid="messages-panel"]', {
    timeout: 10_000,
  });
  const inboxCombat = await page.locator('[data-testid^="message-combat-"]').count();
  if (inboxCombat < 1) {
    throw new Error("messages inbox missing combat report after raid");
  }
  logs.push("ui-messages-inbox");
  const missionState = await page.evaluate(() => {
    const st = window.starhold.getState();
    const r = st.reports?.[0];
    const loot =
      (r?.loot?.metal ?? 0) + (r?.loot?.crystal ?? 0) + (r?.loot?.deuterium ?? 0);
    return {
      reports: st.reports?.length ?? 0,
      outcome: r?.outcome ?? null,
      loot,
      fleets: st.fleets?.length ?? 0,
    };
  });
  if ((missionState.reports ?? 0) < 1 || !missionState.outcome) {
    throw new Error(`UI fleet mission missing report: ${JSON.stringify(missionState)}`);
  }
  logs.push(
    `ui-fleet-mission-report:${missionState.outcome}:loot${missionState.loot}`,
  );

  await browser.close();
  console.log("UI smoke OK", logs);
  return { logs };
}

async function authAndGoalsSmoke() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const stamp = Date.now().toString(36);
  const email = `goals${stamp}@example.com`;
  const password = "starhold-goals";
  const name = `Goal${stamp.slice(-4)}`;
  const logs = [];

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', password);
  await page.click('[data-testid="auth-signup-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', { timeout: 15_000 });
  logs.push("signup");

  await page.fill('[data-testid="commander-input"]', name);
  await page.click('[data-testid="join-btn"]');
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const playerId = await page.evaluate(() => window.starhold.getState().playerId);
  if (!playerId) throw new Error("signup join missing player");
  logs.push(`joined:${name}`);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const persisted = await page.evaluate(() => window.starhold.getState());
  if (persisted.playerId !== playerId || persisted.name !== name) {
    throw new Error(`cookie persist failed: ${JSON.stringify(persisted)}`);
  }
  logs.push("cookie-persist");

  await goNav(page, "goals");
  await page.waitForSelector('[data-testid="goals-daily"]', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="goals-weekly"]', { timeout: 10_000 });
  const progress = await page.textContent(
    '[data-testid="goal-progress-dailyPirateWins"]',
  );
  const reward = await page.textContent(
    '[data-testid="goal-reward-dailyExpeditions"]',
  );
  const weeklyReward = await page.textContent(
    '[data-testid="goal-reward-weeklyExpeditions"]',
  );
  const panel = await page.innerText('[data-testid="goals-panel"]');
  if (progress?.trim() !== "0 / 3") {
    throw new Error(`daily pirate progress: ${progress}`);
  }
  if (!reward?.includes("2,000") || !weeklyReward?.includes("12,000")) {
    throw new Error(`goal rewards missing commas: ${reward} | ${weeklyReward}`);
  }
  if (panel.includes("_")) {
    throw new Error(`underscore in goals UI: ${panel}`);
  }
  const claim = page.locator('[data-testid="claim-goal-dailyPirateWins"]');
  if (await claim.isEnabled()) {
    throw new Error("unfinished pirate goal should not be claimable");
  }
  logs.push("goals-ui");

  await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    localStorage.clear();
  });
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="auth-login-btn"]', { timeout: 15_000 });
  if ((await page.locator('[data-testid="resources"]').count()) > 0) {
    throw new Error("logout still showed the resource bar");
  }
  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', password);
  await page.click('[data-testid="auth-login-btn"]');
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const afterLogin = await page.evaluate(() => window.starhold.getState());
  if (afterLogin.playerId !== playerId || afterLogin.name !== name) {
    throw new Error(`login did not resume commander: ${JSON.stringify(afterLogin)}`);
  }
  await goNav(page, "goals");
  await page.waitForSelector('[data-testid="goal-progress-dailyExpeditions"]', {
    timeout: 10_000,
  });
  logs.push("login-persist");

  await browser.close();
  console.log("Auth + goals smoke OK", logs);
  return { logs, playerId, email };
}

await waitHealthy();
const api = await apiSmoke();
const authGoals = await authAndGoalsSmoke();
const ui = await uiSmoke();
const poll = await runPollCadence();
console.log(JSON.stringify({ ok: true, api, authGoals, ui, poll }, null, 2));
