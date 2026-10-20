#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for the Messages event log — local production build only.
 * Signup → build complete + fleet return → rows persist across reload →
 * mark read clears the nav badge. Desktop and phone viewports.
 *
 * Requires build:vercel (or build + web dist), server on STARHOLD_WEB
 * (default :3001), and playwright chromium.
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

function coordDistance(a, b) {
  return (
    Math.abs(a.galaxy - b.galaxy) * 100 +
    Math.abs(a.system - b.system) * 10 +
    Math.abs(a.slot - b.slot)
  );
}

/** Closest foreign homeworld so a probe deploy round-trips in seconds, not minutes. */
async function nearestRivalPlanet(selfId, origin, cookie) {
  const load = async () => {
    const res = await fetch(`${API}/api/universe`, {
      headers: { cookie },
    });
    if (!res.ok) throw new Error(`universe ${res.status}`);
    return res.json();
  };
  let uni = await load();
  const others = () =>
    (uni.players ?? []).filter(
      (p) => p.id !== selfId && p.planetId && p.coords,
    );
  if (others().length === 0) {
    const joined = await fetch(`${API}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Rival${Date.now().toString(36).slice(-6)}` }),
    });
    if (!joined.ok) {
      throw new Error(`rival join ${joined.status} ${await joined.text()}`);
    }
    uni = await load();
  }
  const candidates = others();
  if (candidates.length === 0) throw new Error("no rival planet to deploy to");
  candidates.sort(
    (a, b) => coordDistance(origin, a.coords) - coordDistance(origin, b.coords),
  );
  return candidates[0];
}

async function assertFitsViewport(page, testId) {
  const box = await page.getByTestId(testId).boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${testId} is not visible`);
  if (box.width <= 0 || box.height <= 0) {
    throw new Error(`${testId} has no size`);
  }
  if (box.x < -1 || box.x + box.width > viewport.width + 2) {
    throw new Error(
      `${testId} overflows viewport x=${box.x} w=${box.width} vw=${viewport.width}`,
    );
  }
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const email = `gate_evt_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Evt${stamp.slice(-5)}`;
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

  await page.getByTestId("nav-messages").click();
  await page.getByTestId("messages-panel").waitFor({ timeout: 10_000 });
  await page.getByTestId("messages-empty").waitFor({ timeout: 5_000 });
  await page.getByTestId("inbox-filter-alerts").waitFor({ timeout: 5_000 });
  if ((await page.getByTestId("messages-stub").count()) > 0) {
    throw new Error("messages stub still present");
  }
  logs.push("messages_empty_ok");

  await page.getByTestId("nav-buildings").click();
  await page.getByTestId("upgrade-metalMine").click();
  await page.getByTestId("flash-ok").waitFor({ timeout: 15_000 });
  await page.getByTestId("upgrade-shipyard").click();
  await page.waitForFunction(
    () => /2 in queue/i.test(
      document.querySelector('[data-testid="flash-ok"]')?.textContent ?? "",
    ),
    undefined,
    { timeout: 15_000 },
  );
  logs.push("queued_builds");

  await page.waitForFunction(
    () => (window.starhold?.getState()?.buildings?.metalMine ?? 0) >= 2,
    undefined,
    { timeout: 40_000 },
  );
  const buildingMail = await page.evaluate(
    () =>
      (window.starhold?.getState()?.eventLog ?? []).some(
        (entry) =>
          entry.kind === "buildComplete" &&
          typeof entry.title === "string" &&
          entry.title.includes("Ore Extractor"),
      ),
  );
  if (buildingMail) {
    throw new Error("building upgrade still mailed the inbox");
  }
  logs.push("build_complete_silent");

  await page.waitForFunction(
    () => (window.starhold?.getState()?.buildings?.shipyard ?? 0) >= 1,
    undefined,
    { timeout: 45_000 },
  );
  logs.push("shipyard_ready");

  await page.evaluate(() => window.starhold.buildShip("probe", 2));
  await page.waitForFunction(
    () => (window.starhold?.getState()?.ships?.probe ?? 0) >= 2,
    undefined,
    { timeout: 30_000 },
  );
  logs.push("probe_built");

  const coords = await page.getByTestId("planet-coords").innerText();
  const match = coords.match(/(\d+):(\d+):(\d+)/);
  if (!match) throw new Error(`could not read coords from ${coords}`);
  const origin = {
    galaxy: Number(match[1]),
    system: Number(match[2]),
    slot: Number(match[3]),
  };
  const selfId = await page.evaluate(
    () => window.starhold?.getState()?.playerId ?? null,
  );
  if (!selfId) throw new Error("missing player id after probe build");
  const cookies = await context.cookies(API);
  const sessionCookie = cookies.find((cookie) => cookie.name === "starhold_session");
  if (!sessionCookie) throw new Error("signup session cookie missing");
  const rival = await nearestRivalPlanet(
    selfId,
    origin,
    `${sessionCookie.name}=${sessionCookie.value}`,
  );
  const launched = await page.evaluate(async (targetPlanetId) => {
    try {
      await window.starhold.launch({
        mission: "deploy",
        ships: { probe: 2 },
        targetPlanetId,
      });
      const st = window.starhold.getState();
      const fleet = st.fleets?.[0] ?? null;
      return {
        ok: true,
        error: st.error,
        fleets: st.fleets?.length ?? 0,
        mission: fleet?.mission ?? null,
        phase: fleet?.phase ?? null,
        arrivesInMs: fleet ? fleet.arrivesAt - Date.now() : null,
        ships: fleet?.ships ?? null,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, rival.planetId);
  if (!launched.ok || launched.error || launched.fleets < 1) {
    throw new Error(
      `deploy launch failed: ${launched.error ?? "no fleet"} (fleets=${launched.fleets ?? 0})`,
    );
  }
  if (launched.mission !== "deploy" || launched.ships?.probe !== 2) {
    throw new Error(`expected probe deploy, got ${JSON.stringify(launched)}`);
  }
  logs.push(
    `deploy_launched_${rival.coords.galaxy}:${rival.coords.system}:${rival.coords.slot}`,
  );

  const oneWayMs = Math.max(8_000, launched.arrivesInMs ?? 8_000);
  try {
    await page.waitForFunction(
      () =>
        (window.starhold?.getState()?.eventLog ?? []).some(
          (entry) => entry.kind === "fleetReturn",
        ),
      undefined,
      { timeout: oneWayMs * 2 + 12_000 },
    );
  } catch (err) {
    const snap = await page.evaluate(() => window.starhold?.getState() ?? null);
    throw new Error(
      `fleet return missing: ${err instanceof Error ? err.message : err} state=${JSON.stringify(snap)}`,
    );
  }
  logs.push("fleet_return_event");

  await page.getByTestId("nav-messages").click();
  await page.getByTestId("messages-panel").waitFor({ timeout: 10_000 });
  const buildRows = await page
    .locator('[data-testid^="message-buildComplete-"]')
    .count();
  const fleetRows = await page
    .locator('[data-testid^="message-fleetReturn-"]')
    .count();
  if (buildRows < 1 || fleetRows < 1) {
    throw new Error(`inbox rows build=${buildRows} fleet=${fleetRows}`);
  }
  const badge = await page.getByTestId("nav-messages-badge").innerText();
  if (!badge || badge === "0") throw new Error(`expected unread badge, got ${badge}`);
  logs.push(`badge_${badge.trim()}`);

  await page.getByTestId("inbox-filter-alerts").click();
  await page.waitForFunction(
    () => {
      const pressed = document
        .querySelector('[data-testid="inbox-filter-alerts"]')
        ?.getAttribute("aria-pressed");
      const combatMail = document.querySelectorAll(
        '[data-testid^="message-combat-"], [data-testid^="message-spy-"], [data-testid^="message-expedition-"]',
      ).length;
      const fleet = document.querySelectorAll(
        '[data-testid^="message-fleetReturn-"]',
      ).length;
      return pressed === "true" && combatMail === 0 && fleet >= 1;
    },
    undefined,
    { timeout: 8_000 },
  );
  logs.push("alerts_filter_ok");

  await assertFitsViewport(page, "messages-panel");
  await assertFitsViewport(page, "inbox-filter-alerts");
  await assertFitsViewport(page, "nav-messages-badge");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("messages-panel").waitFor({ timeout: 5_000 });
  await page.getByTestId("inbox-filter-all").waitFor({ timeout: 5_000 });
  await page.getByTestId("nav-messages-badge").waitFor({ timeout: 5_000 });
  await assertFitsViewport(page, "messages-panel");
  await assertFitsViewport(page, "inbox-filter-all");
  await assertFitsViewport(page, "nav-messages-badge");
  logs.push("dual_viewport_ok");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("messages-panel").waitFor({ timeout: 20_000 });
  if ((await page.locator('[data-testid^="message-buildComplete-"]').count()) < 1) {
    throw new Error("build row missing after reload");
  }
  if ((await page.locator('[data-testid^="message-fleetReturn-"]').count()) < 1) {
    throw new Error("fleet row missing after reload");
  }
  await page.getByTestId("nav-messages-badge").waitFor({ timeout: 5_000 });
  logs.push("persist_reload");

  const readResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/events/read") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByTestId("mark-all-read").click();
  const marked = await readResponse;
  if (!marked.ok()) {
    throw new Error(`mark all read failed: ${marked.status()} ${await marked.text()}`);
  }
  await page.waitForFunction(
    () => document.querySelector('[data-testid="nav-messages-badge"]') == null,
    undefined,
    { timeout: 15_000 },
  );
  logs.push("badge_cleared");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("messages-panel").waitFor({ timeout: 20_000 });
  if ((await page.getByTestId("nav-messages-badge").count()) > 0) {
    throw new Error("badge returned after reload");
  }
  if ((await page.locator('[data-unread="1"]').count()) > 0) {
    throw new Error("unread rows remained after mark all + reload");
  }
  logs.push("read_persisted");

  await browser.close();
  console.log("QUALITY_GATE_EVENTS_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_EVENTS_FAIL", err);
  process.exit(1);
});
