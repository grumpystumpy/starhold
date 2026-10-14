#!/usr/bin/env node
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
    () => {
      const log = window.starhold?.getState()?.eventLog ?? [];
      return log.some(
        (entry) =>
          entry.kind === "buildComplete" &&
          typeof entry.title === "string" &&
          entry.title.includes("Ore Extractor"),
      );
    },
    undefined,
    { timeout: 40_000 },
  );
  logs.push("build_complete_event");

  await page.waitForFunction(
    () => (window.starhold?.getState()?.buildings?.shipyard ?? 0) >= 1,
    undefined,
    { timeout: 45_000 },
  );
  logs.push("shipyard_ready");

  await page.evaluate(() => window.starhold.buildShip("probe", 1));
  await page.waitForFunction(
    () => (window.starhold?.getState()?.ships?.probe ?? 0) >= 1,
    undefined,
    { timeout: 30_000 },
  );
  logs.push("probe_built");

  const coords = await page.getByTestId("planet-coords").innerText();
  const match = coords.match(/(\d+):(\d+):(\d+)/);
  if (!match) throw new Error(`could not read coords from ${coords}`);
  const galaxy = Number(match[1]);
  const system = Number(match[2]);
  const launched = await page.evaluate(
    async ({ galaxy, system }) => {
      try {
        await window.starhold.launch({
          mission: "expedition",
          ships: { probe: 1 },
          targetCoords: { galaxy, system, slot: 16 },
        });
        return { ok: true, error: window.starhold.getState().error };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    { galaxy, system },
  );
  if (!launched.ok || launched.error) {
    throw new Error(`expedition launch failed: ${launched.error ?? "unknown"}`);
  }
  logs.push("expedition_launched");

  await page.waitForFunction(
    () =>
      (window.starhold?.getState()?.eventLog ?? []).some(
        (entry) => entry.kind === "fleetReturn",
      ),
    undefined,
    { timeout: 40_000 },
  );
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
  await page
    .locator('[data-testid^="message-fleetReturn-"]')
    .first()
    .waitFor({ timeout: 5_000 });
  if (
    (await page.locator('[data-testid^="message-combat-"]').count()) +
      (await page.locator('[data-testid^="message-expedition-"]').count()) >
    0
  ) {
    throw new Error("alerts filter still shows combat mail");
  }
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

  await page.getByTestId("mark-all-read").click();
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
