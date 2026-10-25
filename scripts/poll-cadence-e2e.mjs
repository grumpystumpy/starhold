#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Local production check: background polls are one GET /api/state,
 * 30s apart, paused while the tab is hidden, and a player action
 * refreshes from its own response instead of an extra state GET.
 *
 * Uses Playwright's clock so the 30s gaps do not wait on the wall clock.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

function stateGets(log) {
  return log.filter(
    (entry) => entry.method === "GET" && entry.url.includes("/api/state"),
  );
}

function waitForState(page) {
  return page.waitForResponse(
    (res) =>
      res.url().includes("/api/state") && res.request().method() === "GET",
    { timeout: 60_000 },
  );
}

async function readLog(page) {
  return page.evaluate(() => window.__apiLog.slice());
}

async function waitForLog(page, pred, ms = 8_000) {
  const activeClock = createActiveWaitClock();
  let last = [];
  while (activeClock.elapsed() < ms) {
    last = await readLog(page);
    if (pred(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`api log timeout: ${JSON.stringify(last)}`);
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const state = { hidden: false };
    window.__vis = state;
    window.__apiLog = [];
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (url.includes("/api/")) {
        window.__apiLog.push({ url, method, t: Date.now() });
      }
      return orig(input, init);
    };
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        return state.hidden ? "hidden" : "visible";
      },
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return state.hidden;
      },
    });
  });
  await page.clock.install();
  const name = `Poll${viewport.name}${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${WEB}/?commander=${encodeURIComponent(name)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const interval = await page.evaluate(() => window.starhold?.pollIntervalMs);
  if (interval !== 30_000) {
    throw new Error(`${viewport.name} pollIntervalMs=${interval}`);
  }

  let log = await readLog(page);
  if (stateGets(log).length !== 0) {
    throw new Error(`${viewport.name} polled before 30s: ${JSON.stringify(log)}`);
  }
  const joinPosts = log.filter(
    (entry) => entry.method === "POST" && entry.url.includes("/api/join"),
  );
  if (joinPosts.length !== 1 || log.length !== 1) {
    throw new Error(`${viewport.name} join was not one request: ${JSON.stringify(log)}`);
  }

  await page.clock.fastForward(29_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  log = await readLog(page);
  if (stateGets(log).length !== 0) {
    throw new Error(`${viewport.name} polled at 29s: ${JSON.stringify(log)}`);
  }

  const firstPoll = waitForState(page);
  await page.clock.fastForward(1_000);
  await firstPoll;
  await new Promise((resolve) => setTimeout(resolve, 100));
  log = await waitForLog(page, (entries) => stateGets(entries).length === 1);

  const secondPoll = waitForState(page);
  await page.clock.fastForward(30_000);
  await secondPoll;
  await new Promise((resolve) => setTimeout(resolve, 100));
  log = await waitForLog(page, (entries) => stateGets(entries).length === 2);
  const polls = stateGets(log);
  const gap = polls[1].t - polls[0].t;
  if (gap < 30_000) {
    throw new Error(`${viewport.name} poll gap ${gap}ms`);
  }
  const between = log.filter(
    (entry) => entry.t > polls[0].t && entry.t < polls[1].t,
  );
  if (between.length !== 0) {
    throw new Error(
      `${viewport.name} extra calls between polls: ${JSON.stringify(between)}`,
    );
  }

  const hiddenAt = log.length;
  await page.evaluate(() => {
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    window.__vis.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(90_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  log = await readLog(page);
  if (log.length !== hiddenAt) {
    throw new Error(
      `${viewport.name} polled while hidden: ${JSON.stringify(log.slice(hiddenAt))}`,
    );
  }

  await page.evaluate(() => Promise.all([window.starhold.poll(), window.starhold.poll()]));
  log = await waitForLog(page, (entries) => stateGets(entries).length === 3);
  if (log.length !== hiddenAt + 1) {
    throw new Error(
      `${viewport.name} parallel polls were not one request: ${JSON.stringify(log.slice(hiddenAt))}`,
    );
  }

  const shownPoll = waitForState(page);
  await page.evaluate(() => {
    window.__vis.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await shownPoll;
  log = await waitForLog(page, (entries) => stateGets(entries).length === 4);
  const shown = log.slice(hiddenAt + 1);
  if (shown.length !== 1 || !shown[0].url.includes("/api/state")) {
    throw new Error(
      `${viewport.name} show-tab refresh was not one state GET: ${JSON.stringify(shown)}`,
    );
  }

  await page.click('[data-testid="nav-buildings"]');
  await page.waitForSelector('[data-testid="upgrade-shipyard"]', {
    timeout: 10_000,
  });
  const beforeAction = (await readLog(page)).length;
  const upgradeResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/upgrade") && res.request().method() === "POST",
  );
  await page.click('[data-testid="upgrade-shipyard"]');
  await upgradeResponse;
  await new Promise((resolve) => setTimeout(resolve, 100));
  log = await waitForLog(
    page,
    (entries) =>
      entries.slice(beforeAction).some((entry) => entry.url.includes("/api/upgrade")),
  );
  const actionCalls = log.slice(beforeAction);
  const upgrades = actionCalls.filter((entry) => entry.url.includes("/api/upgrade"));
  const actionStates = actionCalls.filter(
    (entry) => entry.method === "GET" && entry.url.includes("/api/state"),
  );
  if (upgrades.length !== 1 || upgrades[0].method !== "POST" || actionStates.length !== 0) {
    throw new Error(
      `${viewport.name} action did not refresh from its own response: ${JSON.stringify(actionCalls)}`,
    );
  }
  if (actionCalls.length !== 1) {
    throw new Error(
      `${viewport.name} action sent extra requests: ${JSON.stringify(actionCalls)}`,
    );
  }

  await page.clock.fastForward(29_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const mid = await readLog(page);
  if (stateGets(mid).length !== stateGets(log).length) {
    throw new Error(`${viewport.name} polled 29s after an action`);
  }
  await page.clock.fastForward(1_000);
  const after = await waitForLog(
    page,
    (entries) => stateGets(entries).length === stateGets(log).length + 1,
  );
  const lastGap =
    stateGets(after).at(-1).t - stateGets(log).at(-1).t;
  if (lastGap < 30_000) {
    throw new Error(`${viewport.name} post-action poll gap ${lastGap}ms`);
  }

  await context.close();
  return `${viewport.name}:${viewport.width}x${viewport.height}`;
}

async function installProbe(page) {
  await page.addInitScript(() => {
    const state = { hidden: false };
    window.__vis = state;
    window.__apiLog = [];
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (url.includes("/api/")) {
        window.__apiLog.push({ url, method, t: Date.now() });
      }
      return orig(input, init);
    };
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        return state.hidden ? "hidden" : "visible";
      },
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return state.hidden;
      },
    });
  });
  await page.clock.install();
}

async function runIdlePause(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await installProbe(page);
  const name = `Idle${viewport.name}${Date.now().toString(36).slice(-4)}`;
  await page.goto(`${WEB}/?commander=${encodeURIComponent(name)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  const idleMs = await page.evaluate(() => window.starhold?.idlePauseMs);
  if (idleMs !== 180_000) {
    throw new Error(`${viewport.name} idlePauseMs=${idleMs}`);
  }
  if (await page.locator('[data-testid="idle-pause"]').isVisible()) {
    throw new Error(`${viewport.name} idle notice shown at join`);
  }

  const metalBefore = await page.evaluate(() => {
    const metal = document.querySelector('[data-testid="res-metal"] .value')
      ?.textContent ?? "";
    const sub = document.querySelector('[data-testid="res-metal"] .sub')
      ?.textContent ?? "";
    return { metal, sub };
  });
  const beforeGets = stateGets(await readLog(page)).length;
  await page.clock.fastForward(10_000);
  const metalAfter = await page.evaluate(
    () =>
      document.querySelector('[data-testid="res-metal"] .value')?.textContent ??
      "",
  );
  if (stateGets(await readLog(page)).length !== beforeGets) {
    throw new Error(`${viewport.name} resource tick called the network`);
  }
  const rate = Number(
    (metalBefore.sub.match(/\+([0-9,]+)\/h/)?.[1] ?? "0").replace(/,/g, ""),
  );
  const gain = rate * (10_000 / 3_600_000);
  if (gain >= 1 && metalAfter === metalBefore.metal) {
    throw new Error(
      `${viewport.name} metal stayed ${metalAfter} after a local 10s tick`,
    );
  }

  await page.click('[data-testid="nav-buildings"]');
  const upgradeResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/upgrade") && res.request().method() === "POST",
  );
  await page.click('[data-testid="upgrade-shipyard"]');
  await upgradeResponse;
  await page.waitForSelector('[data-testid="eta"]', { timeout: 10_000 });
  const etaBefore = await page.textContent('[data-testid="eta"]');
  const callsAtEta = (await readLog(page)).length;
  await page.clock.fastForward(2_000);
  const etaAfter = await page.textContent('[data-testid="eta"]');
  if (!etaBefore || etaAfter === etaBefore) {
    throw new Error(`${viewport.name} eta did not tick locally (${etaBefore})`);
  }
  if ((await readLog(page)).length !== callsAtEta) {
    throw new Error(`${viewport.name} eta tick called the network`);
  }

  // Land 1s before the 3 minute idle mark. One background poll is due in
  // that window; wait for it before crossing the deadline.
  const getsBeforeLong = stateGets(await readLog(page)).length;
  await page.clock.fastForward(177_000);
  await waitForLog(
    page,
    (entries) => stateGets(entries).length >= getsBeforeLong + 1,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (await page.locator('[data-testid="idle-pause"]').isVisible()) {
    throw new Error(`${viewport.name} paused before 3 minutes`);
  }
  const getsNearIdle = stateGets(await readLog(page)).length;
  await page.clock.fastForward(5_000);
  await page.locator('[data-testid="idle-pause"]').waitFor({ state: "visible" });
  const label = (await page.textContent('[data-testid="idle-pause"]'))?.trim();
  if (label !== "Paused, tap to resume") {
    throw new Error(`${viewport.name} idle label: ${label}`);
  }
  const getsAtPause = stateGets(await readLog(page)).length;
  if (getsAtPause > getsNearIdle + 1) {
    throw new Error(
      `${viewport.name} kept polling into idle (${getsNearIdle} -> ${getsAtPause})`,
    );
  }
  await page.clock.fastForward(90_000);
  if (stateGets(await readLog(page)).length !== getsAtPause) {
    throw new Error(`${viewport.name} polled while idle`);
  }

  await page.evaluate(() => {
    window.__vis.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30_000);
  await page.evaluate(() => {
    window.__vis.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (stateGets(await readLog(page)).length !== getsAtPause) {
    throw new Error(`${viewport.name} showing a paused tab polled`);
  }

  const wakeResponse = waitForState(page);
  await page.click('[data-testid="idle-pause"]');
  await wakeResponse;
  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitForLog(
    page,
    (entries) => stateGets(entries).length === getsAtPause + 1,
  );
  if (await page.locator('[data-testid="idle-pause"]').isVisible()) {
    throw new Error(`${viewport.name} idle notice stayed after tap`);
  }
  const woke = stateGets(await readLog(page)).length;
  await page.clock.fastForward(29_000);
  if (stateGets(await readLog(page)).length !== woke) {
    throw new Error(`${viewport.name} polled 29s after wake`);
  }
  await page.clock.fastForward(1_000);
  await waitForLog(page, (entries) => stateGets(entries).length === woke + 1);

  await context.close();
  return `idle-${viewport.name}:${viewport.width}x${viewport.height}`;
}

export async function runPollCadence() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const done = [];
  try {
    for (const viewport of VIEWPORTS) {
      done.push(await runViewport(browser, viewport));
    }
    for (const viewport of VIEWPORTS) {
      done.push(await runIdlePause(browser, viewport));
    }
  } finally {
    await browser.close();
  }
  console.log("Poll cadence OK", done.join(", "));
  return done;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await runPollCadence();
}
