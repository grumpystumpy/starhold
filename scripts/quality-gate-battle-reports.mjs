#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for replayable battle reports — local production build only.
 * Covers: signup → login → cookie persist + raid with rounds → replay UI + share copy.
 *
 * Requires: build:vercel done, server on STARHOLD_WEB (default :3001) with
 * SESSION_SECRET + STARHOLD_E2E=1, playwright chromium installed.
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

async function apiJson(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: WEB,
  });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const email = `gate_br_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `BrAtk${stamp.slice(-4)}`;
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
  const attackerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId,
  );
  if (!attackerId) throw new Error("missing attacker playerId after join");
  logs.push("joined");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  logs.push("persist_reload");

  const defenderJoin = await apiJson("/api/join", {
    method: "POST",
    body: JSON.stringify({ name: `BrDef${stamp.slice(-4)}` }),
  });
  if (!defenderJoin.ok || !defenderJoin.data.player?.id || !defenderJoin.data.planet?.id) {
    throw new Error(`defender join failed: ${JSON.stringify(defenderJoin)}`);
  }
  const defenderId = defenderJoin.data.player.id;
  const defenderPlanetId = defenderJoin.data.planet.id;

  const grantAtk = await apiJson("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({
      playerId: attackerId,
      ships: { scout: 6 },
      resources: { metal: 1000, crystal: 1000, deuterium: 2000 },
    }),
  });
  if (!grantAtk.ok) {
    throw new Error(
      `e2e grant required (set STARHOLD_E2E=1): ${grantAtk.status} ${JSON.stringify(grantAtk.data)}`,
    );
  }
  const grantDef = await apiJson("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({
      playerId: defenderId,
      ships: { scout: 2 },
      resources: { metal: 500, crystal: 500, deuterium: 200 },
    }),
  });
  if (!grantDef.ok) {
    throw new Error(`defender grant failed: ${JSON.stringify(grantDef.data)}`);
  }
  logs.push("e2e_grant");

  const graduated = await apiJson("/api/e2e/graduate-newbie", {
    method: "POST",
    body: JSON.stringify({ playerId: defenderId }),
  });
  if (!graduated.ok) {
    throw new Error(
      `graduate defender failed: ${JSON.stringify(graduated.data)}`,
    );
  }
  logs.push("defender_graduated");

  const launch = await apiJson("/api/launch-fleet", {
    method: "POST",
    body: JSON.stringify({
      playerId: attackerId,
      targetPlanetId: defenderPlanetId,
      mission: "raid",
      ships: { scout: 5 },
    }),
  });
  if (!launch.ok || launch.data.error) {
    throw new Error(`raid launch failed: ${JSON.stringify(launch.data)}`);
  }
  logs.push("raid_launched");

  let report = null;
  const activeClock = createActiveWaitClock();
  while (activeClock.elapsed() < 180_000) {
    const st = await apiJson(
      `/api/state?playerId=${encodeURIComponent(attackerId)}`,
    );
    const reports = st.data.reports ?? [];
    if (reports.length >= 1) {
      report = reports[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!report) throw new Error("no combat report after raid");
  if (!report.roundLog?.length) {
    throw new Error(`report missing roundLog: ${JSON.stringify(report)}`);
  }
  if (!report.shareCode || !report.xpAwarded) {
    throw new Error(`report missing share/xp: ${JSON.stringify(report)}`);
  }
  logs.push("raid_report_ok");

  await page.reload({ waitUntil: "networkidle" });
  // Combat reports live in Messages after #47; Fleet only links to the inbox.
  await page.getByTestId("nav-messages").click();
  await page.getByTestId("messages-panel").waitFor({ timeout: 15_000 });
  await page.getByTestId("messages-inbox").waitFor({ timeout: 10_000 });
  await page
    .getByTestId(`message-combat-${report.id}`)
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(`open-report-combat-${report.id}`)
    .click();
  await page.getByTestId("report-subwindow").waitFor({ timeout: 5_000 });
  logs.push("report_summary_ui_ok");

  await page
    .getByTestId("report-subwindow")
    .getByTestId(`copy-battle-share-${report.id}`)
    .click();
  await page.getByTestId("flash-ok").waitFor({ timeout: 10_000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip.includes(report.shareCode) || !/Rounds:/i.test(clip)) {
    throw new Error(`clipboard share card bad: ${clip}`);
  }
  if (!/Attacker ships: .+ before, .+ after/.test(clip)) {
    throw new Error(`clipboard missing before/after ships: ${clip}`);
  }
  const reportUrl = clip.split("\n").find((line) => line.includes("?report="));
  if (!reportUrl) throw new Error(`clipboard missing report url: ${clip}`);
  logs.push("share_copy_ok");

  const shotDir = process.env.STARHOLD_SHOT_DIR ?? "/tmp/starhold-b7-68";
  await mkdir(shotDir, { recursive: true });

  async function shot(target, name) {
    await target.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true });
  }

  const guest = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(reportUrl, { waitUntil: "networkidle" });
  await guestPage.getByTestId("shared-combat-report").waitFor({ timeout: 15_000 });
  const sharedDesktop = await guestPage.getByTestId("shared-combat-report").innerText();
  if (!sharedDesktop.includes("Before") || !sharedDesktop.includes("After")) {
    throw new Error(`shared report missing before/after: ${sharedDesktop}`);
  }
  await shot(guestPage, "shared-report-desktop");
  await guestPage.setViewportSize({ width: 390, height: 844 });
  await guestPage.getByTestId("shared-combat-report").waitFor({ timeout: 10_000 });
  const phoneOverflow = await guestPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (phoneOverflow > 1) {
    throw new Error(`shared report phone overflow ${phoneOverflow}px`);
  }
  await shot(guestPage, "shared-report-phone");
  await guest.close();
  logs.push("shared_report_url_ok");

  await page.setViewportSize({ width: 1280, height: 800 });
  const highscoreHref = await page.getByTestId("nav-highscore").getAttribute("href");
  if (!highscoreHref) throw new Error("highscore nav has no href");
  await page.goto(new URL(highscoreHref, WEB).toString(), { waitUntil: "networkidle" });
  await page.getByTestId("hall-of-fame").waitFor({ timeout: 10_000 });
  await page.getByTestId("hall-of-shame").waitFor({ timeout: 10_000 });
  const fame = await page.getByTestId("hall-of-fame").innerText();
  const shame = await page.getByTestId("hall-of-shame").innerText();
  if (!fame.includes("Battle report")) {
    throw new Error(`hall of fame missing shared fight: ${fame}`);
  }
  if (/No combat losses recorded yet/.test(shame)) {
    throw new Error(`hall of shame empty: ${shame}`);
  }
  await shot(page, "highscores-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("hall-of-fame").waitFor({ timeout: 10_000 });
  await page.getByTestId("hall-of-shame").waitFor({ timeout: 10_000 });
  const hallOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (hallOverflow > 1) throw new Error(`highscores phone overflow ${hallOverflow}px`);
  await shot(page, "highscores-phone");
  logs.push("halls_ok");
  await page.setViewportSize({ width: 1280, height: 800 });

  const fresh = await browser.newContext();
  const loginPage = await fresh.newPage();
  await loginPage.goto(WEB, { waitUntil: "networkidle" });
  await loginPage.getByTestId("auth-email").fill(email);
  await loginPage.getByTestId("auth-password").fill(password);
  await Promise.all([
    loginPage.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.ok(),
      { timeout: 15_000 },
    ),
    loginPage.getByTestId("auth-login-btn").click(),
  ]);
  await Promise.race([
    loginPage.getByTestId("overview-panel").waitFor({ timeout: 15_000 }),
    loginPage.getByTestId("account-email").waitFor({ timeout: 15_000 }),
  ]);
  logs.push("login_ok");

  await fresh.close();
  await browser.close();
  console.log("QUALITY_GATE_BATTLE_REPORTS_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_BATTLE_REPORTS_FAIL", err);
  process.exit(1);
});
