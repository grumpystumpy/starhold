#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createActiveWaitClock } from "./active-wait-clock.mjs";

/**
 * First-hour new-player audit — local production build only.
 * Signup → Overview briefing → claim the starter mines → Goals and the
 * optional next step → Deuterium Extractor, Research Lab, Power Discipline,
 * Shipyard, Recon Drone, Spy Satellite, and the fleet composer.
 * No admin grants and no clock skips. Build timers run at the server speed.
 *
 * Requires a production build, server on STARHOLD_WEB (default :3001)
 * with SESSION_SECRET or the local fallback, and playwright chromium.
 * Screenshots go to FIRST_HOUR_SHOTS (default /opt/cursor/artifacts).
 */

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;
const SHOTS = process.env.FIRST_HOUR_SHOTS ?? "/opt/cursor/artifacts";

const STARTER_CLAIMS = ["metalMine1", "solarPlant1", "crystalMine1"];

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

function parseAmount(text) {
  const raw = String(text).replace(/,/g, "").trim();
  const match = raw.match(/^(-?\d+(?:\.\d+)?)([kMBT])?$/i);
  if (!match) throw new Error(`unparsed amount "${text}"`);
  const value = Number(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  const mult = suffix === "k" ? 1_000
    : suffix === "m" ? 1_000_000
      : suffix === "b" ? 1_000_000_000
        : suffix === "t" ? 1_000_000_000_000
          : 1;
  return value * mult;
}

async function resourceAmount(page, testId) {
  const text = await page.getByTestId(testId).locator(".value").innerText();
  return parseAmount(text);
}

async function assertNoHorizontalScroll(page, label, notes) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) {
    notes.push({ kind: "friction", where: label, detail: `horizontal overflow ${overflow}px` });
    throw new Error(`${label} horizontal overflow ${overflow}px`);
  }
}

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function readSteps(page) {
  return page.locator("[data-testid^='onboarding-step-']").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const claim = node.querySelector("[data-testid^='onboarding-claim-']");
      const claimRect = claim ? claim.getBoundingClientRect() : null;
      const jump = node.querySelector("[data-testid^='onboarding-jump-']");
      return {
        id: (node.getAttribute("data-testid") || "").replace("onboarding-step-", ""),
        completed: node.getAttribute("data-completed"),
        claimed: node.getAttribute("data-claimed"),
        title: node.querySelector("strong")?.textContent?.trim() ?? "",
        hints: [...node.querySelectorAll(".onboarding-step-copy .hint")].map((el) => el.textContent?.trim() ?? ""),
        status: node.querySelector(".onboarding-step-actions .hint")?.textContent?.trim() ?? "",
        jump: jump?.getAttribute("href") ?? "",
        claimInView: claimRect
          ? claimRect.top >= 0 && claimRect.bottom <= window.innerHeight && claimRect.width > 0
          : false,
        rowTop: Math.round(rect.top),
      };
    }),
  );
}

async function visibleText(page, testId) {
  const loc = page.getByTestId(testId);
  if ((await loc.count()) === 0) return "";
  if (!(await loc.isVisible())) return "";
  return (await loc.innerText()).trim();
}

async function waitLevel(page, bucket, id, level) {
  await page.waitForFunction(
    ({ bucket: key, id: rowId, level: min }) => {
      const state = window.starhold?.getState()?.[key];
      return (state?.[rowId] ?? 0) >= min;
    },
    { bucket, id, level },
    { timeout: 90_000 },
  );
}

async function clickUpgrade(page, id, notes) {
  const button = page.getByTestId(`upgrade-${id}`);
  await button.scrollIntoViewIfNeeded();
  const reason = await visibleText(page, `blocked-upgrade-${id}`);
  if (await button.isDisabled()) {
    notes.push({ kind: "stall", where: `upgrade-${id}`, detail: reason || "disabled with no reason" });
    throw new Error(`upgrade-${id} blocked: ${reason || "disabled"}`);
  }
  await button.click();
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });

  const notes = [];
  const shots = [];
  const stamp = Date.now().toString(36);
  const email = `hour_${stamp}@example.com`;
  const password = `HourTest1!${stamp}`;
  const commander = `Hour${stamp.slice(-5)}`;

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/auth/signup") && response.ok(),
      { timeout: 20_000 },
    ),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("overview-panel").waitFor({ timeout: 30_000 });
  await page.getByTestId("onboarding-panel").waitFor({ timeout: 15_000 });

  const daily = await visibleText(page, "claim-daily");
  notes.push({ kind: "observe", where: "resource-bar", detail: `daily control: ${daily || "(missing)"}` });

  const energyClass = await page.getByTestId("res-energy").getAttribute("class");
  const energyText = await page.getByTestId("res-energy").innerText();
  notes.push({
    kind: energyClass?.includes("deficit") ? "friction" : "observe",
    where: "energy",
    detail: `${energyText.replace(/\s+/g, " ")} class=${energyClass}`,
  });

  const progress = await page.getByTestId("onboarding-progress").innerText();
  const steps = await readSteps(page);
  if (steps.length !== 8) throw new Error(`expected 8 onboarding steps, saw ${steps.length}`);
  if (!/ready to claim/i.test(progress)) {
    throw new Error(`progress line does not say rewards are ready: ${progress}`);
  }
  notes.push({ kind: "observe", where: "overview-progress", detail: progress });
  for (const stepId of STARTER_CLAIMS) {
    const step = steps.find((row) => row.id === stepId);
    if (!step) throw new Error(`missing starter step ${stepId}`);
    if (step.status !== "Ready to claim") {
      throw new Error(`${stepId} status is "${step.status}"`);
    }
    if (!step.hints.some((line) => line === "Already done. Claim the reward.")) {
      throw new Error(`${stepId} is missing the claim hint: ${step.hints.join(" | ")}`);
    }
  }
  for (const step of steps) {
    notes.push({
      kind: "observe",
      where: `step:${step.id}`,
      detail: `status=${step.status} completed=${step.completed} claimed=${step.claimed} claimInView=${step.claimInView} title=${step.title} copy=${step.hints.join(" | ")}`,
    });
    if (step.completed === "true" && step.claimed === "false" && !step.claimInView) {
      notes.push({
        kind: "friction",
        where: `step:${step.id}`,
        detail: "Claim reward is outside the phone viewport on arrival",
      });
    }
  }

  const nextGoalId = await page.getByTestId("next-goal").getAttribute("data-next-goal-id");
  const nextGoalTitle = await page.getByTestId("next-goal").locator("strong").innerText();
  const nextGoalWhy = await page.getByTestId("next-goal-rationale").innerText();
  const recommended = await page.getByTestId("recommended-next").innerText();
  const nextIncomplete = steps.find((step) => step.completed !== "true");
  notes.push({
    kind: "observe",
    where: "next-goal",
    detail: `${nextGoalId} ${nextGoalTitle} — ${nextGoalWhy}`,
  });
  notes.push({ kind: "observe", where: "recommended-next", detail: recommended });
  if (!/Power Discipline/.test(recommended) || /Shadow Optics/.test(recommended)) {
    throw new Error(`recommended next still points past the first research: ${recommended}`);
  }
  if (nextIncomplete && nextGoalId && !nextGoalId.includes(nextIncomplete.id.replace(/1$/, ""))) {
    notes.push({
      kind: "friction",
      where: "competing-next",
      detail: `briefing highlights ${nextIncomplete.id} (${nextIncomplete.title}); optional next step is ${nextGoalId}; recommended says "${recommended}"`,
    });
  }
  shots.push(await shot(page, "b7-70-phone-overview-join"));
  await assertNoHorizontalScroll(page, "phone overview", notes);

  const metalBefore = await resourceAmount(page, "res-metal");
  const crystalBefore = await resourceAmount(page, "res-crystal");
  for (const stepId of STARTER_CLAIMS) {
    const button = page.getByTestId(`onboarding-claim-${stepId}`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-testid="onboarding-step-${id}"]`)?.getAttribute("data-claimed") === "true",
      stepId,
      { timeout: 20_000 },
    );
  }
  const metalAfter = await resourceAmount(page, "res-metal");
  const crystalAfter = await resourceAmount(page, "res-crystal");
  if (metalAfter < metalBefore + 400) {
    throw new Error(`metal did not rise (${metalBefore} -> ${metalAfter})`);
  }
  if (crystalAfter < crystalBefore + 150) {
    throw new Error(`crystal did not rise (${crystalBefore} -> ${crystalAfter})`);
  }
  notes.push({
    kind: "observe",
    where: "starter-claims",
    detail: `metal ${metalBefore} -> ${metalAfter}; crystal ${crystalBefore} -> ${crystalAfter}`,
  });

  await page.getByTestId("nav-goals").click();
  await page.getByTestId("onboarding-goals").waitFor({ timeout: 15_000 });
  const goalSteps = await readSteps(page);
  const goalIds = goalSteps.map((step) => step.id).join(",");
  notes.push({ kind: "observe", where: "goals-steps", detail: goalIds || "(none)" });
  if (!goalIds.includes("deutSynth1")) {
    notes.push({ kind: "friction", where: "goals", detail: `next extractor step missing from Goals (${goalIds})` });
  }
  const goalsGoal = await page.getByTestId("next-goal").getAttribute("data-next-goal-id");
  notes.push({ kind: "observe", where: "goals-next-goal", detail: goalsGoal || "(missing)" });
  await assertNoHorizontalScroll(page, "phone goals", notes);
  shots.push(await shot(page, "b7-70-phone-goals"));

  await page.getByTestId("onboarding-jump-deutSynth1").click();
  await page.getByTestId("upgrade-deutSynth").waitFor({ timeout: 15_000 });
  const deutReason = await visibleText(page, "blocked-upgrade-deutSynth");
  const buildingsHint = await page.locator("[data-testid='buildings-panel'] .hint").last().innerText();
  notes.push({
    kind: deutReason ? "friction" : "observe",
    where: "deut-upgrade",
    detail: deutReason || "upgrade enabled",
  });
  notes.push({ kind: "observe", where: "buildings-hint", detail: buildingsHint });
  shots.push(await shot(page, "b7-70-phone-buildings-deut"));
  await clickUpgrade(page, "deutSynth", notes);
  await waitLevel(page, "buildings", "deutSynth", 1);
  const energyAfterDeut = (await page.getByTestId("res-energy").innerText()).replace(/\s+/g, " ");
  const energyClassAfter = await page.getByTestId("res-energy").getAttribute("class");
  notes.push({
    kind: energyClassAfter?.includes("deficit") ? "friction" : "observe",
    where: "energy-after-deut",
    detail: `${energyAfterDeut} class=${energyClassAfter}`,
  });
  notes.push({ kind: "observe", where: "deut-built", detail: "Deuterium Extractor reached level 1" });

  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-claim-deutSynth1").waitFor({ timeout: 15_000 });
  await page.getByTestId("onboarding-claim-deutSynth1").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="onboarding-step-deutSynth1"]')?.getAttribute("data-claimed") === "true",
    undefined,
    { timeout: 20_000 },
  );

  await page.getByTestId("nav-research").click();
  await page.getByTestId("research-btn-energyTech").waitFor({ timeout: 15_000 });
  const powerLabel = await page.getByTestId("research-btn-energyTech").innerText();
  const powerReason = await visibleText(page, "blocked-research-energyTech");
  const opticsLabel = await page.getByTestId("research-btn-espionageTech").innerText();
  const opticsReason = await visibleText(page, "blocked-research-espionageTech");
  notes.push({
    kind: "observe",
    where: "research-before-lab",
    detail: `Power Discipline button "${powerLabel}" ${powerReason}; Shadow Optics button "${opticsLabel}" ${opticsReason}`,
  });
  shots.push(await shot(page, "b7-70-phone-research-before-lab"));

  await page.getByTestId("nav-buildings").click();
  await page.getByTestId("upgrade-researchLab").waitFor({ timeout: 15_000 });
  await clickUpgrade(page, "researchLab", notes);
  await waitLevel(page, "buildings", "researchLab", 1);
  notes.push({ kind: "observe", where: "lab-built", detail: "Research Lab reached level 1" });

  await page.getByTestId("nav-overview").click();
  const recommendedAfterLab = await page.getByTestId("recommended-next").innerText();
  notes.push({ kind: "observe", where: "recommended-after-lab", detail: recommendedAfterLab });
  if (!/Recon Drone or Spy Satellite/.test(recommendedAfterLab)) {
    throw new Error(`recommended next after the lab: ${recommendedAfterLab}`);
  }

  await page.getByTestId("nav-research").click();
  const powerButton = page.getByTestId("research-btn-energyTech");
  await powerButton.scrollIntoViewIfNeeded();
  const powerBlocked = await visibleText(page, "blocked-research-energyTech");
  if (await powerButton.isDisabled()) {
    notes.push({ kind: "stall", where: "research-energyTech", detail: powerBlocked || "disabled" });
    throw new Error(`Power Discipline blocked after the lab: ${powerBlocked}`);
  }
  await powerButton.click();
  await waitLevel(page, "research", "energyTech", 1);
  notes.push({ kind: "observe", where: "research-done", detail: "Power Discipline reached level 1" });

  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-claim-researchLab1").waitFor({ timeout: 20_000 });
  await page.getByTestId("onboarding-claim-researchLab1").click();

  await page.getByTestId("nav-buildings").click();
  await clickUpgrade(page, "shipyard", notes);
  await waitLevel(page, "buildings", "shipyard", 1);
  notes.push({ kind: "observe", where: "yard-built", detail: "Shipyard reached level 1" });

  await page.getByTestId("nav-shipyard").click();
  const scoutButton = page.getByTestId("build-scout");
  await scoutButton.scrollIntoViewIfNeeded();
  const scoutName = await page.getByTestId("ship-scout").locator("h3").innerText();
  const scoutBlocked = await visibleText(page, "blocked-build-scout");
  notes.push({
    kind: scoutBlocked ? "friction" : "observe",
    where: "shipyard-scout",
    detail: `${scoutName}; ${scoutBlocked || "build enabled"}`,
  });
  if (await scoutButton.isDisabled()) {
    throw new Error(`Recon Drone blocked: ${scoutBlocked}`);
  }
  shots.push(await shot(page, "b7-70-phone-shipyard"));
  await scoutButton.click();
  await waitLevel(page, "ships", "scout", 1);

  const probeButton = page.getByTestId("build-probe");
  await probeButton.scrollIntoViewIfNeeded();
  const probeBlocked = await visibleText(page, "blocked-build-probe");
  if (await probeButton.isDisabled()) {
    notes.push({ kind: "stall", where: "shipyard-probe", detail: probeBlocked || "disabled" });
    throw new Error(`Spy Satellite blocked: ${probeBlocked}`);
  }
  await probeButton.click();
  await waitLevel(page, "ships", "probe", 1);
  notes.push({ kind: "observe", where: "hulls", detail: "Recon Drone and Spy Satellite built" });

  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-claim-shipyardScout1").waitFor({ timeout: 20_000 });
  await page.getByTestId("onboarding-claim-shipyardScout1").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="onboarding-step-shipyardScout1"]')?.getAttribute("data-claimed") === "true",
    undefined,
    { timeout: 20_000 },
  );
  await page.getByTestId("onboarding-claim-firstReconOrExpedition").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="onboarding-step-firstReconOrExpedition"]')?.getAttribute("data-claimed") === "true",
    undefined,
    { timeout: 20_000 },
  );
  const progressLate = await page.getByTestId("onboarding-progress").innerText();
  notes.push({ kind: "observe", where: "overview-after-claims", detail: progressLate });

  await page.getByTestId("onboarding-jump-firstReconOrExpedition").click();
  await page.getByTestId("galaxy-panel").waitFor({ timeout: 15_000 });
  const scanLabel = await visibleText(page, "galaxy-scan-system");
  const maxExpedition = await visibleText(page, "galaxy-max-expeditions");
  const deepSpace = await visibleText(page, "galaxy-deep-space");
  notes.push({
    kind: "observe",
    where: "galaxy",
    detail: `scan="${scanLabel}" maxExpeditions="${maxExpedition}" deepSpace="${deepSpace.replace(/\s+/g, " ")}"`,
  });
  shots.push(await shot(page, "b7-70-phone-galaxy"));

  await page.getByTestId("nav-fleet").click();
  await page.getByTestId("fleet-form").waitFor({ timeout: 15_000 });
  const presetText = await page.getByTestId("fleet-preset").innerText();
  const orbit = await visibleText(page, "fleet-orbit-ships");
  const emptyOrbit = await visibleText(page, "fleet-orbit-empty");
  if (/Moon Destruction|Mini Planet Destruction/.test(presetText)) {
    throw new Error(`locked presets visible: ${presetText}`);
  }
  notes.push({
    kind: "observe",
    where: "fleet",
    detail: `presets=${presetText.replace(/\s+/g, " ")}; orbit=${(orbit || emptyOrbit).replace(/\s+/g, " ")}`,
  });
  const fleetHint = await page.getByTestId("fleet-orbit-hint").innerText();
  notes.push({ kind: "observe", where: "fleet-hint", detail: fleetHint.replace(/\s+/g, " ") });
  if (!/1 Recon Drone/.test(fleetHint)) {
    throw new Error(`fleet example does not name the Recon Drone: ${fleetHint}`);
  }
  const fleetNext = page.getByTestId("fleet-next");
  const nextReason = await visibleText(page, "fleet-next-blocked");
  const nextDisabled = await fleetNext.isDisabled();
  notes.push({
    kind: nextDisabled ? "friction" : "observe",
    where: "fleet-next-before-count",
    detail: `${nextDisabled ? "disabled" : "enabled"} ${nextReason}`,
  });
  await page.getByTestId("fleet-count-scout").fill("1");
  await page.getByTestId("fleet-count-scout").dispatchEvent("input");
  await page.waitForFunction(
    () => {
      const button = document.querySelector("[data-testid='fleet-next']");
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: 10_000 },
  );
  await fleetNext.click();
  await page.getByTestId("fleet-send-review").waitFor({ timeout: 10_000 });
  const review = await page.getByTestId("fleet-send-review").innerText();
  notes.push({
    kind: "observe",
    where: "fleet-review",
    detail: `step 2 opened, fleet not sent: ${review.replace(/\s+/g, " ").slice(0, 280)}`,
  });
  await page.getByTestId("fleet-back").click();
  await assertNoHorizontalScroll(page, "phone fleet", notes);
  shots.push(await shot(page, "b7-70-phone-fleet"));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("nav-overview").click();
  await page.getByTestId("onboarding-panel").waitFor({ timeout: 15_000 });
  await assertNoHorizontalScroll(page, "desktop overview", notes);
  shots.push(await shot(page, "b7-70-desktop-overview"));
  await page.getByTestId("nav-goals").click();
  await assertNoHorizontalScroll(page, "desktop goals", notes);
  await page.getByTestId("nav-fleet").click();
  await page.getByTestId("fleet-form").waitFor({ timeout: 15_000 });
  await assertNoHorizontalScroll(page, "desktop fleet", notes);
  shots.push(await shot(page, "b7-70-desktop-fleet"));

  notes.push({
    kind: "observe",
    where: "colony-foundation",
    detail: `${progressLate}; colony foundation stays open after the first builds`,
  });

  const noise = errors.filter((line) => !/favicon|Failed to load resource/i.test(line));
  if (noise.length) throw new Error(`console/page errors: ${noise.join(" | ")}`);

  const report = { commander, notes, shots };
  console.log(`FIRST_HOUR_AUDIT_REPORT ${JSON.stringify(report)}`);
  console.log("FIRST_HOUR_AUDIT_OK", notes.filter((row) => row.kind === "friction").length, "friction notes");
  await browser.close();
}

main().catch((err) => {
  console.error("FIRST_HOUR_AUDIT_FAIL", err);
  process.exit(1);
});
