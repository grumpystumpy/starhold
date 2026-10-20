#!/usr/bin/env node
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
    .getByTestId(`battle-details-${report.id}`)
    .locator("summary")
    .click();
  await page.getByTestId("battle-replay").waitFor({ timeout: 5_000 });
  await page.getByTestId("battle-round-1").waitFor({ timeout: 5_000 });
  if (report.roundLog.length > 1) {
    const next = report.roundLog[1].round;
    await page.getByTestId(`battle-round-tab-${next}`).click();
    await page.getByTestId(`battle-round-${next}`).waitFor({ timeout: 5_000 });
  }
  logs.push("replay_ui_ok");

  await page.getByTestId(`copy-battle-share-${report.id}`).click();
  await page.getByTestId("flash-ok").waitFor({ timeout: 10_000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip.includes(report.shareCode) || !/Rounds:/i.test(clip)) {
    throw new Error(`clipboard share card bad: ${clip}`);
  }
  logs.push("share_copy_ok");

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
