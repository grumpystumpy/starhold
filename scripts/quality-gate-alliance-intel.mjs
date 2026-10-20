#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * Quality gate for alliance chat, shared intel, galaxy markers, and
 * Joint Strike proposals. Local production build only.
 *
 * Flow: signup → create/join (2 users) → chat → share spy intel →
 * marker on galaxy → propose strike → persist across reload.
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

async function submitChat(page, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = page
      .waitForResponse(
        (r) =>
          r.url().includes("/api/alliance/chat") &&
          r.request().method() === "POST" &&
          r.ok(),
        { timeout: 5_000 },
      )
      .catch(() => null);
    await page.evaluate((text) => {
      const input = document.querySelector(
        '[data-testid="alliance-chat-body"]',
      );
      const form = document.querySelector("#alliance-chat-form");
      if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        return;
      }
      input.value = text;
      form.requestSubmit();
    }, body);
    if (await pending) return;
  }
  throw new Error("chat post failed");
}

async function signupAndJoin(page, email, password, commander) {
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
}

async function buildProbe(page) {
  await page.getByTestId("nav-buildings").click();
  await page.getByTestId("building-shipyard").waitFor({ timeout: 10_000 });
  const level = page.getByTestId("building-level-shipyard");
  if ((await level.textContent())?.trim() !== "L1") {
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/upgrade") && r.ok(),
        { timeout: 15_000 },
      ),
      page.getByTestId("upgrade-shipyard").click(),
    ]);
    await page.waitForFunction(() => {
      const el = document.querySelector(
        '[data-testid="building-level-shipyard"]',
      );
      return el?.textContent?.trim() === "L1";
    }, null, { timeout: 25_000 });
  }
  await page.getByTestId("nav-shipyard").click();
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="build-probe"]');
    return btn instanceof HTMLButtonElement && !btn.disabled;
  }, null, { timeout: 15_000 });
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/build-ship") && r.ok(),
      { timeout: 15_000 },
    ),
    page.getByTestId("build-probe").click(),
  ]);
  // Build buttons arm a short click-suppress window; wait it out before nav.
  await page.waitForTimeout(400);
  await page.getByTestId("nav-fleet").click();
  if ((await page.locator("#fleet-form").count()) === 0) {
    await page.getByTestId("nav-fleet").click();
  }
  await page.getByTestId("fleet-count-probe").waitFor({ timeout: 25_000 });
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const stamp = Date.now().toString(36);
  const tag = `C${stamp.slice(-3)}`.toUpperCase().slice(0, 4);
  const chatBody = `Hold the lane ${stamp}`;
  const markerNote = `Siege ${stamp.slice(-4)}`;
  const logs = [];

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const emailA = `gate_chat_a_${stamp}@example.com`;
  const commanderA = `Ca${stamp.slice(-4)}`;
  await signupAndJoin(pageA, emailA, `GateTest1!${stamp}`, commanderA);
  logs.push("signup_a");

  await pageA.getByTestId("nav-alliances").click();
  await pageA.getByTestId("alliance-create-form").waitFor({ timeout: 10_000 });
  await pageA.getByTestId("alliance-name").fill(`Chat ${stamp.slice(-4)}`);
  await pageA.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes("/api/alliance/create") && r.ok(),
      { timeout: 15_000 },
    ),
    pageA.getByTestId("alliance-create-btn").click(),
  ]);
  await pageA.getByTestId("alliance-chat-form").waitFor({ timeout: 10_000 });
  logs.push("alliance_created");

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const commanderB = `Cb${stamp.slice(-4)}`;
  await signupAndJoin(
    pageB,
    `gate_chat_b_${stamp}@example.com`,
    `GateTest1!${stamp}b`,
    commanderB,
  );
  await pageB.getByTestId("nav-alliances").click();
  const joinBtn = pageB
    .locator(".alliance-dir-row", { hasText: `[${tag}]` })
    .locator("[data-alliance-join]");
  await joinBtn.waitFor({ timeout: 15_000 });
  await Promise.all([
    pageB.waitForResponse(
      (r) => r.url().includes("/api/alliance/join") && r.ok(),
      { timeout: 15_000 },
    ),
    joinBtn.click(),
  ]);
  await pageB.getByTestId("alliance-chat-form").waitFor({ timeout: 10_000 });
  logs.push("joined_b");

  await submitChat(pageA, chatBody);
  await pageB.getByText(chatBody).waitFor({ timeout: 15_000 });
  logs.push("chat_shared");

  await buildProbe(pageA);
  await pageA.evaluate(() => {
    const mission = document.querySelector('[data-testid="mission-espionage"]');
    if (mission instanceof HTMLInputElement) {
      mission.checked = true;
      mission.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await pageA.waitForTimeout(300);
  const target = pageA.getByTestId("fleet-target");
  await target.waitFor({ timeout: 10_000 });
  const value = await target
    .locator("option", { hasText: commanderB })
    .getAttribute("value");
  if (!value) throw new Error(`no spy target for ${commanderB}`);
  await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes("/api/launch-fleet") && r.ok(),
      { timeout: 15_000 },
    ),
    pageA.evaluate((planetValue) => {
      const select = document.querySelector('[data-testid="fleet-target"]');
      const count = document.querySelector('[data-testid="fleet-count-probe"]');
      const form = document.querySelector("#fleet-form");
      if (
        select instanceof HTMLSelectElement &&
        count instanceof HTMLInputElement &&
        form instanceof HTMLFormElement
      ) {
        select.value = planetValue;
        count.value = "1";
        form.requestSubmit();
      }
    }, value),
  ]);
  const share = pageA.locator('[data-testid^="share-intel-"]').first();
  await share.waitFor({ timeout: 30_000 });
  await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes("/api/alliance/intel/share") && r.ok(),
      { timeout: 15_000 },
    ),
    share.click(),
  ]);
  logs.push("intel_shared");

  await pageB.getByTestId("nav-alliances").click();
  const openIntel = pageB.locator('[data-testid^="alliance-intel-open-"]').first();
  await openIntel.waitFor({ timeout: 15_000 });
  const intelText = await pageB.getByTestId("alliance-intel").innerText();
  if (!intelText.includes(commanderB)) {
    throw new Error(`ally intel missing target ${commanderB}: ${intelText}`);
  }
  await openIntel.click();
  await pageB.getByText(/resources /).waitFor({ timeout: 10_000 });
  logs.push("intel_opened");

  await pageA.getByTestId("nav-galaxy").click();
  await pageA.getByTestId("galaxy-mark-1").waitFor({ timeout: 10_000 });
  await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes("/api/alliance/markers") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    ),
    pageA.evaluate((note) => {
      const input = document.querySelector('[data-testid="galaxy-marker-note"]');
      const button = document.querySelector('[data-testid="galaxy-mark-1"]');
      if (input instanceof HTMLInputElement) input.value = note;
      if (button instanceof HTMLButtonElement) button.click();
    }, markerNote),
  ]);
  const pin = pageA.getByTestId("galaxy-marker-1");
  await pin.waitFor({ timeout: 10_000 });
  const tip = await pin.getAttribute("title");
  if (!tip || !tip.includes(markerNote) || !tip.includes(commanderA)) {
    throw new Error(`marker tooltip missing note or author: ${tip}`);
  }
  logs.push("marker_placed");

  await pageB.getByTestId("nav-galaxy").click();
  await pageB.getByTestId("galaxy-marker-1").waitFor({ timeout: 15_000 });
  logs.push("marker_visible_ally");

  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.getByTestId("nav-alliances").click();
  await pageA.getByText(chatBody).waitFor({ timeout: 20_000 });
  await pageA.getByTestId("nav-galaxy").click();
  await pageA.getByTestId("galaxy-marker-1").waitFor({ timeout: 15_000 });
  logs.push("persist_reload");

  await Promise.all([
    pageA.waitForResponse(
      (r) => r.url().includes("/api/alliance/plan-strike") && r.ok(),
      { timeout: 15_000 },
    ),
    pageA.getByTestId("galaxy-propose-1").click(),
  ]);
  await pageA.getByText("Joint Strike armed").waitFor({ timeout: 10_000 });
  const openAcs = pageA.getByTestId("fleet-open-acs");
  await openAcs.waitFor({ timeout: 10_000 });
  if (!(await openAcs.isChecked())) {
    throw new Error("Joint Strike deep-link did not arm Open ACS");
  }
  const flash = await pageA.getByTestId("flash-ok").innerText();
  const strikeCoords = flash.match(/(\d+:\d+:\d+)/)?.[1];
  if (!strikeCoords) {
    throw new Error(`Joint Strike flash missing target coords: ${flash}`);
  }
  await pageA.getByTestId("nav-alliances").click();
  await pageA
    .getByText(new RegExp(`proposed Joint Strike on ${strikeCoords}`))
    .waitFor({ timeout: 10_000 });
  logs.push("strike_proposed");

  await pageA.getByTestId("nav-fleet").click();
  await pageA.getByTestId("propose-joint-strike").waitFor({ timeout: 10_000 });
  logs.push("fleet_propose_visible");

  await contextB.close();
  await contextA.close();
  await browser.close();
  console.log("QUALITY_GATE_ALLIANCE_INTEL_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_ALLIANCE_INTEL_FAIL", err);
  process.exit(1);
});
