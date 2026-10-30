#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
import fs from "node:fs";
import path from "node:path";
/**
 * Local prod Playwright for playtest bugs 1–9.
 * Desktop 1280×800 and phone 390×844.
 *
 *   STARHOLD_WEB / STARHOLD_API  default http://127.0.0.1:3001
 * Server needs STARHOLD_E2E=1 and ALLOW_E2E_HOOKS=1.
 */
import { createRequire } from "node:module";
import { fleetToStep2 } from "./lib/fleet-two-step.mjs";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

async function join(name) {
  const { status, body } = await api("/api/join", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  assert(status === 200 && body?.player?.id, `join ${name}: ${JSON.stringify(body)}`);
  return body;
}

async function grant(playerId, resources, ships) {
  const { status, body } = await api("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({ playerId, resources, ships }),
  });
  assert(status === 200, `grant: ${JSON.stringify(body)}`);
  return body;
}

async function state(playerId) {
  const { status, body } = await api(
    `/api/state?playerId=${encodeURIComponent(playerId)}`,
  );
  assert(status === 200 && body?.player, `state: ${JSON.stringify(body)}`);
  return body;
}

async function setupLab(name) {
  const lab = await join(name);
  await grant(lab.player.id, { metal: 80_000, crystal: 80_000, deuterium: 40_000 });
  const labUp = await api("/api/upgrade", {
    method: "POST",
    body: JSON.stringify({ playerId: lab.player.id, buildingId: "researchLab" }),
  });
  assert(labUp.status === 200, `lab upgrade: ${JSON.stringify(labUp.body)}`);
  await until("lab level 1", async () => {
    const view = await state(lab.player.id);
    return (view.planet.buildings.researchLab ?? 0) >= 1 ? view : null;
  });
  return lab;
}

async function until(label, pred, ms = 60_000) {
  const activeClock = createActiveWaitClock();
  let last;
  while (activeClock.elapsed() < ms) {
    last = await pred();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout: ${label}`);
}

async function noOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  assert(!overflow, `${label} overflows horizontally`);
}

async function logResearchWaitFailure(page, tag, error) {
  let diagnostics;
  try {
    diagnostics = await page.evaluate(() => {
      const isVisible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" &&
          rect.width > 0 && rect.height > 0;
      };
      const button = document.querySelector(
        '[data-testid="research-btn-shieldingTech"]',
      );
      return {
        shieldingTech: button
          ? {
              text: button.textContent,
              dataLocked: button.getAttribute("data-locked"),
              disabled: button.getAttribute("disabled"),
              disabledProperty:
                button instanceof HTMLButtonElement ? button.disabled : null,
              title: button.getAttribute("title"),
            }
          : "missing",
        visibleFlashNoticeText: [
          ...document.querySelectorAll(
            '[data-testid^="flash-"], [role="status"], [role="alert"]',
          ),
        ]
          .filter(isVisible)
          .map((element) => element.innerText),
        activeNavPage: {
          link: document.querySelector("a[data-nav].active")?.getAttribute("data-nav") ??
            "missing",
          dropdown: document.querySelector("[data-nav-select]")?.value ?? "missing",
        },
      };
    });
  } catch (diagnosticError) {
    console.error("PLAYTEST_RESEARCH_DIAGNOSTICS_READ_FAIL", diagnosticError);
  }
  console.error(
    "PLAYTEST_RESEARCH_WAIT_DIAGNOSTICS",
    JSON.stringify({ url: page.url(), ...diagnostics, error: String(error) }, null, 2),
  );
  try {
    const dir = path.resolve("ui-review-out-playtest");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `${tag}-research-wait-failure.png`),
      fullPage: true,
    });
  } catch (screenshotError) {
    console.error("PLAYTEST_RESEARCH_SCREENSHOT_FAIL", screenshotError);
  }
}

async function optionTexts(page) {
  return page.locator("#fleet-target option").allTextContents();
}

async function runViewport(browser, viewport, ids) {
  const page = await browser.newPage({ viewport });
  const tag = `${viewport.width}x${viewport.height}`;
  const stamp = `${Date.now().toString(36)}${viewport.width}`;
  try {
    await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="auth-form"]');
    await page.fill('[data-testid="auth-email"]', `playtest_${stamp}@example.com`);
    await page.fill('[data-testid="auth-password"]', "playtest99");
    await page.click('[data-testid="auth-signup-btn"]');
    await page.waitForSelector('[data-testid="account-email"]');
    assert(
      (await page.locator('[data-testid="auth-form"]').count()) === 0,
      `${tag} auth form still visible after signup`,
    );
    assert(
      (await page.locator('[data-testid="join-form"]').count()) === 1,
      `${tag} commander step missing after signup`,
    );
    const joinText = await page.locator("body").innerText();
    assert(!joinText.includes("Automation"), `${tag} developer automation text`);
    assert(!joinText.includes("commander="), `${tag} commander query hint`);
    assert(!joinText.includes("window.starhold"), `${tag} console helper hint`);
    await noOverflow(page, `${tag} join`);

    const buildingsUrl = `${WEB}/buildings?playerId=${encodeURIComponent(ids.solar.player.id)}`;
    await page.goto(buildingsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="upgrade-solarPlant"]');
    const solar = page.locator('[data-testid="upgrade-solarPlant"]');
    assert(await solar.isDisabled(), `${tag} solar upgrade still enabled`);
    assert(
      (await solar.innerText()).includes("Can't afford"),
      `${tag} solar label: ${await solar.innerText()}`,
    );
    let upgradePosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/upgrade")) {
        upgradePosts += 1;
      }
    });
    await solar.click({ force: true });
    await page.waitForTimeout(300);
    assert(upgradePosts === 0, `${tag} disabled upgrade still posted`);
    const buildingsText = await page.locator('[data-testid="building-mantleLoom"]').innerText();
    assert(!buildingsText.includes("fieldsCap"), `${tag} fieldsCap in Mantle Loom`);
    assert(buildingsText.includes("5 fields per level"), `${tag} mantle copy`);
    assert(!buildingsText.includes("_"), `${tag} underscore in Mantle Loom`);
    await noOverflow(page, `${tag} buildings`);

    const researchUrl = `${WEB}/research?playerId=${encodeURIComponent(ids.lab.player.id)}`;
    await page.goto(researchUrl, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(
        () =>
          (
            document.querySelector('[data-testid="research-btn-shieldingTech"]')
              ?.textContent ?? ""
          ).includes("Needs lab 6"),
        { timeout: 20_000 },
      );
    } catch (error) {
      await logResearchWaitFailure(page, tag, error);
      throw error;
    }
    const shield = page.locator('[data-testid="research-btn-shieldingTech"]');
    assert(await shield.isDisabled(), `${tag} shielding research enabled`);
    assert(
      (await shield.innerText()).includes("Needs lab 6"),
      `${tag} shielding label: ${await shield.innerText()}`,
    );
    let researchPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/research")) {
        researchPosts += 1;
      }
    });
    const fillers = [
      "energyTech",
      "combustionDrive",
      "weaponsTech",
      "armourTech",
      "espionageTech",
      "computerTech",
    ];
    let sawQueueFull = false;
    for (let attempt = 0; attempt < 8 && !sawQueueFull; attempt++) {
      let held = false;
      let lastBody = null;
      for (const researchId of fillers) {
        const queued = await api("/api/research", {
          method: "POST",
          body: JSON.stringify({
            playerId: ids.lab.player.id,
            researchId,
          }),
        });
        lastBody = queued.body;
        const queueError = String(queued.body?.error ?? "").toLowerCase();
        if (queued.status === 200 || (queued.status === 400 && queueError.includes("queue"))) {
          held = true;
          break;
        }
      }
      assert(held, `queue research: ${JSON.stringify(lastBody)}`);
      try {
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll('[data-testid^="research-btn-"]')].some(
              (btn) => (btn.textContent ?? "").includes("Queue full"),
            ),
          { timeout: 2_500 },
        );
      } catch {
        continue;
      }
      const full = page.locator('[data-testid^="research-btn-"]', { hasText: "Queue full" }).first();
      if ((await full.count()) === 0) continue;
      assert(await full.isDisabled(), `${tag} queue-full research still enabled`);
      const again = await api("/api/research", {
        method: "POST",
        body: JSON.stringify({
          playerId: ids.lab.player.id,
          researchId: "computerTech",
        }),
      });
      const blocked =
        again.status === 400 &&
        String(again.body?.error ?? "").toLowerCase().includes("queue");
      researchPosts = 0;
      await full.click({ force: true });
      await page.waitForTimeout(300);
      assert(researchPosts === 0, `${tag} queue-full research still posted`);
      if (blocked) sawQueueFull = true;
    }
    assert(sawQueueFull, `${tag} research queue never stayed full`);
    if (viewport.width === 1280) {
      const researchState = await state(ids.lab.player.id);
      const queuedResearch = researchState.player.researchQueue.map((item) => ({
        researchId: item.researchId,
        secondsRemaining: (item.completesAt - researchState.now) / 1_000,
      }));
      console.info("PLAYTEST_RESEARCH_QUEUE", JSON.stringify(queuedResearch));
    }
    await noOverflow(page, `${tag} research`);

    const fleetUrl = `${WEB}/fleet?playerId=${encodeURIComponent(ids.spy.player.id)}`;
    await page.goto(fleetUrl, { waitUntil: "domcontentloaded" });
    await fleetToStep2(page, { probe: 1 });
    await page.waitForSelector('[data-testid="fleet-mission"]');
    await page.selectOption('[data-testid="fleet-mission"]', "espionage");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#fleet-target option")].some((o) =>
        (o.textContent ?? "").startsWith("Spy "),
      ),
    );
    const spyOptions = await optionTexts(page);
    assert(
      spyOptions.some((t) => t.includes(`Spy ${ids.victimName}`)),
      `${tag} spy list: ${spyOptions.join(" | ")}`,
    );
    assert(
      !spyOptions.some((t) => t.includes("Attack")),
      `${tag} spy list says Attack: ${spyOptions.join(" | ")}`,
    );
    await page.selectOption('[data-testid="fleet-mission"]', "raid");
    await page.waitForSelector('[data-testid="fleet-targets-protected"]');
    const protectedText = await page.locator('[data-testid="fleet-targets-protected"]').innerText();
    assert(protectedText.includes("2.5k"), `${tag} protection copy: ${protectedText}`);
    const raidOptions = await optionTexts(page);
    assert(
      !raidOptions.some((t) => t.includes(ids.victimName)),
      `${tag} protected player in raid list: ${raidOptions.join(" | ")}`,
    );
    for (const other of [ids.solar, ids.lab, ids.econ]) {
      const name = other.player.name;
      assert(
        !raidOptions.some((t) => t.includes(name)),
        `${tag} protected ${name} in raid list: ${raidOptions.join(" | ")}`,
      );
    }
    await noOverflow(page, `${tag} fleet spy`);

    const messagesUrl = `${WEB}/messages?playerId=${encodeURIComponent(ids.spy.player.id)}`;
    await page.goto(messagesUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid^="spy-detail-"]');
    const summary = await page.locator('[data-testid="messages-summary"]').innerText();
    const combatCount = Number(summary.match(/(\d+) combat/)?.[1] ?? "0");
    const spyCount = Number(summary.match(/(\d+) spy/)?.[1] ?? "0");
    assert(spyCount >= 1, `${tag} spy count: ${summary}`);
    assert(combatCount === 0, `${tag} spy counted as combat: ${summary}`);
    const beforeCombat = await page.locator('[data-testid^="message-spy-"]').count();
    await page.click('[data-testid="inbox-filter-combat"]');
    await page.waitForSelector(
      '[data-testid="messages-panel"][data-inbox-filter="combat"]',
    );
    assert(
      (await page.locator('[data-testid^="message-spy-"]').count()) === 0,
      `${tag} spy row still in combat filter`,
    );
    await page.click('[data-testid="inbox-filter-spy"]');
    await page.waitForSelector(
      '[data-testid="messages-panel"][data-inbox-filter="spy"]',
    );
    await page.waitForSelector('[data-testid^="spy-detail-"]');
    assert(beforeCombat >= 1, `${tag} missing spy message`);
    const detail = page.locator('[data-testid^="spy-detail-"]').first();
    assert((await detail.getAttribute("open")) == null, `${tag} spy detail already open`);
    await detail.locator("summary").click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid^="spy-detail-"]');
      return el instanceof HTMLDetailsElement && el.open;
    });
    const detailText = await detail.innerText();
    assert(detailText.includes("Metal"), `${tag} spy detail: ${detailText}`);
    assert(!detailText.includes("solarPlant"), `${tag} internal key in spy detail`);
    await noOverflow(page, `${tag} messages`);

    const fleetReports = `${WEB}/fleet?playerId=${encodeURIComponent(ids.spy.player.id)}`;
    await page.goto(fleetReports, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="spy-reports"]');
    const reportText = await page.locator('[data-testid="spy-reports"]').innerText();
    assert(reportText.includes("Share with alliance"), `${tag} missing share button`);
    assert(!/\dShare/.test(reportText), `${tag} glued share label: ${reportText}`);
    await noOverflow(page, `${tag} spy share`);

    const seasonsUrl = `${WEB}/seasons?playerId=${encodeURIComponent(ids.econ.player.id)}`;
    await page.goto(seasonsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="season-economy-tip"]');
    const seasonText = await page.locator('[data-testid="season-board-economy"]').innerText();
    assert(seasonText.includes("1k"), `${tag} economy tooltip: ${seasonText}`);
    assert(
      seasonText.toLowerCase().includes("building") &&
        seasonText.toLowerCase().includes("research"),
      `${tag} economy scoring copy: ${seasonText}`,
    );
    const score = await page.locator('[data-testid="season-score-economy"]').innerText();
    const points = Number(score.match(/(\d[\d,]*)\s*$/)?.[1]?.replace(/,/g, "") ?? "0");
    assert(points >= 1, `${tag} economy score still 0: ${score}`);
    await noOverflow(page, `${tag} seasons`);
  } finally {
    await page.close();
  }
}

async function expectGraduatedTarget(browser, viewport, ids) {
  const page = await browser.newPage({ viewport });
  const tag = `${viewport.width}x${viewport.height} graduated`;
  try {
    const fleetUrl = `${WEB}/fleet?playerId=${encodeURIComponent(ids.spy.player.id)}`;
    await page.goto(fleetUrl, { waitUntil: "domcontentloaded" });
    await fleetToStep2(page, { probe: 1 });
    await page.waitForSelector('[data-testid="fleet-mission"]');
    await page.selectOption('[data-testid="fleet-mission"]', "raid");
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll("#fleet-target option")].some((o) =>
          (o.textContent ?? "").includes(`Attack ${name}`),
        ),
      ids.victimName,
    );
    const raidOptions = await optionTexts(page);
    assert(
      raidOptions.some((t) => t.includes(`Attack ${ids.victimName}`)),
      `${tag} missing attack option: ${raidOptions.join(" | ")}`,
    );
    for (const other of [ids.solar, ids.lab, ids.econ]) {
      assert(
        !raidOptions.some((t) => t.includes(other.player.name)),
        `${tag} still lists protected ${other.player.name}`,
      );
    }
    await page.selectOption('[data-testid="fleet-mission"]', "espionage");
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll("#fleet-target option")].some((o) =>
          (o.textContent ?? "").includes(`Spy ${name}`),
        ),
      ids.victimName,
    );
    const spyOptions = await optionTexts(page);
    assert(
      !spyOptions.some((t) => t.includes("Attack")),
      `${tag} spy list says Attack: ${spyOptions.join(" | ")}`,
    );
    await noOverflow(page, `${tag} fleet`);
  } finally {
    await page.close();
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const stamp = Date.now().toString(36).slice(-5);
  const solar = await join(`Sol${stamp}`);
  await grant(solar.player.id, { metal: 200_000, crystal: 80_000, deuterium: 20_000 });
  const up = await api("/api/upgrade", {
    method: "POST",
    body: JSON.stringify({ playerId: solar.player.id, buildingId: "solarPlant" }),
  });
  assert(up.status === 200, `solar upgrade: ${JSON.stringify(up.body)}`);
  await until("solar level 2", async () => {
    const view = await state(solar.player.id);
    return (view.planet.buildings.solarPlant ?? 0) >= 2 ? view : null;
  });
  await grant(solar.player.id, { metal: 0, crystal: 0, deuterium: 0 });

  const desktopLab = await setupLab(`LabD${stamp}`);
  const phoneLab = await setupLab(`LabP${stamp}`);

  const victimName = `New${stamp}`;
  const victim = await join(victimName);
  const spy = await join(`Spy${stamp}`);
  await grant(spy.player.id, { metal: 5_000, crystal: 5_000, deuterium: 5_000 }, { probe: 4 });
  const launch = await api("/api/launch-fleet", {
    method: "POST",
    body: JSON.stringify({
      playerId: spy.player.id,
      mission: "espionage",
      targetPlanetId: victim.planet.id,
      ships: { probe: 1 },
    }),
  });
  assert(launch.status === 200, `spy launch: ${JSON.stringify(launch.body)}`);
  await until(
    "spy report",
    async () => {
      const view = await state(spy.player.id);
      return (view.spyReports ?? []).length > 0 ? view : null;
    },
    180_000,
  );
  const ally = await api("/api/alliance/create", {
    method: "POST",
    body: JSON.stringify({
      playerId: spy.player.id,
      name: `Wing ${stamp}`,
      tag: stamp.slice(0, 4).toUpperCase(),
    }),
  });
  assert(ally.status === 200, `alliance: ${JSON.stringify(ally.body)}`);

  const econ = await join(`Eco${stamp}`);
  await grant(econ.player.id, { metal: 50_000, crystal: 10_000, deuterium: 1_000 });
  const vault = await api("/api/upgrade", {
    method: "POST",
    body: JSON.stringify({ playerId: econ.player.id, buildingId: "metalStorage" }),
  });
  assert(vault.status === 200, `vault: ${JSON.stringify(vault.body)}`);
  await until("economy point", async () => {
    const view = await state(econ.player.id);
    return (view.seasonLeaderboard?.scores?.economy ?? 0) >= 1 ? view : null;
  });

  const ids = { solar, lab: desktopLab, spy, victim, victimName, econ };
  const phoneIds = { ...ids, lab: phoneLab };
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    await runViewport(browser, { width: 1280, height: 800 }, ids);
    await runViewport(browser, { width: 390, height: 844 }, phoneIds);
    const grad = await api("/api/e2e/graduate-newbie", {
      method: "POST",
      body: JSON.stringify({ playerId: victim.player.id }),
    });
    assert(grad.status === 200, `graduate: ${JSON.stringify(grad.body)}`);
    await expectGraduatedTarget(browser, { width: 1280, height: 800 }, ids);
    await expectGraduatedTarget(browser, { width: 390, height: 844 }, phoneIds);
  } finally {
    await browser.close();
  }
  console.log("playtest bugfix e2e ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
