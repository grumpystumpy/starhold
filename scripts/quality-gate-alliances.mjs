#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for Alliances foundation — local production build only (no Vercel preview).
 * Covers: signup → login → cookie persistence + create alliance → tag badge + leave.
 *
 * Requires: build:vercel done, server on STARHOLD_WEB (default :3001) with
 * SESSION_SECRET set (or local fallback), playwright chromium installed.
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

async function signupAndJoin(browser, stamp, label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });
  const email = `gate_req_${label}_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `${label}${stamp.slice(-4)}`;
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
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });
  const playerId = await page.evaluate(() => window.starhold.getState().playerId);
  if (!playerId) throw new Error(`missing player id for ${label}`);
  return { context, page, errors, playerId, commander };
}

async function runRequestScenario(browser, logs) {
  const stamp = Date.now().toString(36);
  const tag = `R${stamp.slice(-3)}`.toUpperCase().slice(0, 4);
  const chatBody = `Hold ${stamp}`;
  const leader = await signupAndJoin(browser, stamp, "ReqA");
  const recruit = await signupAndJoin(browser, stamp, "ReqB");
  const target = await signupAndJoin(browser, stamp, "ReqC");
  try {
    await leader.page.getByTestId("nav-alliances").click();
    await leader.page.getByTestId("alliance-create-form").waitFor({ timeout: 10_000 });
    await leader.page.getByTestId("alliance-name").fill(`Request ${stamp.slice(-4)}`);
    await leader.page.getByTestId("alliance-tag").fill(tag);
    await leader.page.getByTestId("alliance-join-mode").selectOption("request");
    await Promise.all([
      leader.page.waitForResponse(
        (r) => r.url().includes("/api/alliance/create") && r.ok(),
        { timeout: 15_000 },
      ),
      leader.page.getByTestId("alliance-create-btn").click(),
    ]);
    await leader.page.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
    logs.push("request_alliance_created");

    await recruit.page.getByTestId("nav-alliances").click();
    await recruit.page.getByTestId("alliances-panel").waitFor({ timeout: 10_000 });
    await recruit.page.evaluate(() => window.starhold.poll());
    const requestRow = recruit.page
      .locator('[data-testid^="alliance-dir-"]')
      .filter({ hasText: `[${tag}]` });
    await requestRow.waitFor({ timeout: 10_000 });
    await Promise.all([
      recruit.page.waitForResponse(
        (r) => r.url().includes("/api/alliance/join") && r.ok(),
        { timeout: 15_000 },
      ),
      requestRow.getByRole("button", { name: "Request" }).click(),
    ]);
    await recruit.page.getByText("Request sent").first().waitFor({ timeout: 10_000 });
    logs.push("request_sent");

    await leader.page.evaluate(() => window.starhold.poll());
    const approve = leader.page.getByTestId(`alliance-approve-${recruit.playerId}`);
    await approve.waitFor({ timeout: 10_000 });
    await Promise.all([
      leader.page.waitForResponse(
        (r) => r.url().includes("/api/alliance/request/approve") && r.ok(),
        { timeout: 15_000 },
      ),
      approve.click(),
    ]);
    await leader.page.getByTestId(`alliance-member-${recruit.playerId}`).waitFor({ timeout: 10_000 });
    logs.push("request_approved");

    await recruit.page.reload({ waitUntil: "networkidle" });
    await recruit.page.getByTestId("nav-galaxy").click();
    await recruit.page.getByTestId("galaxy-panel").waitFor({ timeout: 10_000 });
    const galaxyHtml = await recruit.page.content();
    if (!galaxyHtml.includes(`[${tag}]`)) {
      throw new Error(`galaxy missing alliance tag [${tag}]`);
    }
    logs.push("request_galaxy_tag");

    await recruit.page.getByTestId("nav-highscore").click();
    await recruit.page.getByTestId("highscore-tab-alliances").click();
    await recruit.page.getByTestId("alliance-highscores").waitFor({ timeout: 10_000 });
    const ranks = await recruit.page.getByTestId("alliance-highscores").innerText();
    if (!ranks.includes(`[${tag}]`)) {
      throw new Error(`alliance ranks missing [${tag}]: ${ranks}`);
    }
    logs.push("alliance_rank_tab");

    await recruit.page.getByTestId("nav-alliances").click();
    await recruit.page.getByTestId("alliance-chat-form").waitFor({ timeout: 10_000 });
    await leader.page.getByTestId("alliance-chat-body").fill(chatBody);
    await Promise.all([
      leader.page.waitForResponse(
        (r) => r.url().includes("/api/alliance/chat") && r.request().method() === "POST" && r.ok(),
        { timeout: 15_000 },
      ),
      leader.page.getByTestId("alliance-chat-send").click(),
    ]);
    await Promise.all([
      recruit.page.waitForResponse(
        (r) => r.url().includes("/api/alliance/chat") && r.request().method() === "GET" && r.ok(),
        { timeout: 15_000 },
      ),
      recruit.page.evaluate(() => window.starhold.poll()),
    ]);
    await recruit.page.getByText(chatBody).waitFor({ timeout: 10_000 });
    logs.push("chat_poll_roundtrip");

    for (const playerId of [leader.playerId, recruit.playerId, target.playerId]) {
      const graduated = await fetch(`${API}/api/e2e/graduate-newbie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (!graduated.ok) {
        throw new Error(`graduate failed ${graduated.status}`);
      }
    }
    for (const playerId of [leader.playerId, recruit.playerId]) {
      const granted = await fetch(`${API}/api/e2e/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          ships: { interceptor: 4 },
          resources: { metal: 0, crystal: 0, deuterium: 50_000 },
        }),
      });
      if (!granted.ok) throw new Error(`grant failed ${granted.status}`);
    }
    const targetState = await fetch(
      `${API}/api/state?playerId=${encodeURIComponent(target.playerId)}`,
    );
    if (!targetState.ok) throw new Error("target state failed");
    const targetView = await targetState.json();
    const launched = await fetch(`${API}/api/launch-fleet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: leader.playerId,
        mission: "raid",
        ships: { interceptor: 1 },
        targetPlanetId: targetView.player.homePlanetId,
        openAcs: true,
      }),
    });
    const leadView = await launched.json();
    if (!launched.ok) {
      throw new Error(`leader ACS launch failed ${launched.status} ${leadView.error ?? ""}`);
    }
    const acsId = (leadView.fleets ?? []).find((fleet) => fleet.acsGroupId)?.acsGroupId;
    if (!acsId) throw new Error("leader fleet did not open an ACS group");
    const joined = await fetch(`${API}/api/launch-fleet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: recruit.playerId,
        mission: "raid",
        ships: { interceptor: 1 },
        targetPlanetId: targetView.player.homePlanetId,
        acsGroupId: acsId,
      }),
    });
    const wingView = await joined.json();
    if (!joined.ok) {
      throw new Error(`wing ACS join failed ${joined.status} ${wingView.error ?? ""}`);
    }
    const leaderState = await fetch(
      `${API}/api/state?playerId=${encodeURIComponent(leader.playerId)}`,
    );
    const leaderView = await leaderState.json();
    const group = (leaderView.openAcsGroups ?? []).find((row) => row.id === acsId);
    if (!group || group.fleetIds.length < 2) {
      throw new Error("ACS group does not contain both fleets");
    }
    logs.push("acs_grouped");

    const kickWait = leader.page.waitForResponse(
      (r) => r.url().includes("/api/alliance/kick"),
      { timeout: 15_000 },
    );
    await leader.page.getByTestId(`alliance-kick-${recruit.playerId}`).click();
    const kickRes = await kickWait;
    const kickBody = await kickRes.json();
    if (!kickRes.ok()) {
      throw new Error(`kick failed ${kickRes.status()} ${kickBody.error ?? ""}`);
    }
    const stillMember = (kickBody.alliance?.members ?? []).some(
      (member) => member.playerId === recruit.playerId,
    );
    if (stillMember) {
      throw new Error("kick response still lists the member");
    }
    await leader.page.getByTestId(`alliance-member-${recruit.playerId}`).waitFor({
      state: "detached",
      timeout: 10_000,
    });
    const afterKick = await fetch(
      `${API}/api/state?playerId=${encodeURIComponent(recruit.playerId)}`,
    );
    const kicked = await afterKick.json();
    const homebound = (kicked.fleets ?? []).find((fleet) => fleet.ownerPlayerId === recruit.playerId);
    if (!homebound || homebound.acsGroupId || homebound.phase !== "returning") {
      throw new Error(`kicked fleet was not sent home: ${JSON.stringify(homebound ?? null)}`);
    }
    logs.push("kick_detached_acs");

    const noise = [...leader.errors, ...recruit.errors, ...target.errors].filter(
      (line) => !/favicon|Failed to load resource/i.test(line),
    );
    if (noise.length) {
      throw new Error(`console/page errors: ${noise.join(" | ")}`);
    }
    logs.push("request_scenario_clean");
  } finally {
    await leader.context.close();
    await recruit.context.close();
    await target.context.close();
  }
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const email = `gate_ally_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Ally${stamp.slice(-5)}`;
  const tag = `A${stamp.slice(-3)}`.toUpperCase().slice(0, 4);
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

  await page.getByTestId("nav-alliances").click();
  await page.getByTestId("page-alliances").waitFor({ timeout: 10_000 });
  await page.getByTestId("alliances-panel").waitFor({ timeout: 10_000 });
  await page.getByTestId("alliance-create-form").waitFor({ timeout: 5_000 });
  logs.push("alliances_create_form");

  await page.getByTestId("alliance-name").fill(`Guard ${stamp.slice(-4)}`);
  await page.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/alliance/create") && r.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("alliance-create-btn").click(),
  ]);
  await page.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
  const badge = await page.getByTestId("alliance-tag-badge").textContent();
  if (!badge || !badge.includes(`[${tag}]`)) {
    throw new Error(`unexpected alliance badge: ${badge}`);
  }
  logs.push("alliance_created");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("nav-alliances").click();
  await page.getByTestId("alliance-tag-badge").waitFor({ timeout: 20_000 });
  logs.push("persist_reload_alliance");

  const page2 = await context.newPage();
  await page2.goto(WEB, { waitUntil: "networkidle" });
  const hasOverview = await page2
    .getByTestId("overview-panel")
    .isVisible()
    .catch(() => false);
  const hasAccount = await page2
    .getByTestId("account-email")
    .isVisible()
    .catch(() => false);
  if (!hasOverview && !hasAccount) {
    throw new Error("cookie session did not resume after reload in new tab");
  }
  logs.push(hasOverview ? "cookie_resume_overview" : "cookie_resume_signed_in");

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
  const overviewOrJoin = await Promise.race([
    loginPage
      .getByTestId("overview-panel")
      .waitFor({ timeout: 15_000 })
      .then(() => "overview"),
    loginPage
      .getByTestId("account-email")
      .waitFor({ timeout: 15_000 })
      .then(() => "join"),
  ]);
  if (overviewOrJoin === "join") {
    await loginPage.getByTestId("join-btn").click();
    await loginPage.getByTestId("overview-panel").waitFor({ timeout: 15_000 });
  }
  logs.push("login_ok");

  await loginPage.getByTestId("nav-alliances").click();
  await loginPage.getByTestId("alliance-tag-badge").waitFor({ timeout: 10_000 });
  logs.push("login_alliance_ok");

  await loginPage.getByTestId("nav-galaxy").click();
  await loginPage.getByTestId("galaxy-panel").waitFor({ timeout: 10_000 });
  const galaxyHtml = await loginPage.content();
  if (!galaxyHtml.includes(`[${tag}]`)) {
    throw new Error(`galaxy missing alliance tag [${tag}]`);
  }
  logs.push("galaxy_tag_ok");

  await loginPage.getByTestId("nav-alliances").click();
  await Promise.all([
    loginPage.waitForResponse(
      (r) => r.url().includes("/api/alliance/leave") && r.ok(),
      { timeout: 15_000 },
    ),
    loginPage.getByTestId("alliance-leave-btn").click(),
  ]);
  await loginPage.getByTestId("alliance-create-form").waitFor({ timeout: 10_000 });
  logs.push("leave_ok");

  await fresh.close();
  await runRequestScenario(browser, logs);
  await browser.close();
  console.log("QUALITY_GATE_ALLIANCES_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_ALLIANCES_FAIL", err);
  process.exit(1);
});
