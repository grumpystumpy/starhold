#!/usr/bin/env node
/**
 * Local prod Playwright for playtest bugs 11–17.
 * Desktop 1280×800 and phone 390×844.
 *
 *   STARHOLD_WEB / STARHOLD_API  default http://127.0.0.1:3001
 * Server needs STARHOLD_E2E=1.
 */
import { createRequire } from "node:module";

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

async function grant(playerId, extra) {
  const { status, body } = await api("/api/e2e/grant", {
    method: "POST",
    body: JSON.stringify({ playerId, ...extra }),
  });
  assert(status === 200, `grant: ${JSON.stringify(body)}`);
  return body;
}

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

async function runViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const tag = `${viewport.width}x${viewport.height}`;
  const stamp = `${Date.now().toString(36)}${viewport.width}`;
  try {
    const alphaName = `Ada ${stamp.slice(-4)}`;
    const bravoName = `Bea ${stamp.slice(-4)}`;
    await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="auth-form"]', { timeout: 20_000 });
    await page.fill('[data-testid="auth-email"]', `bugs11_${stamp}@example.com`);
    await page.fill('[data-testid="auth-password"]', "playtest99");
    await page.click('[data-testid="auth-signup-btn"]');
    await page.waitForSelector('[data-testid="commander-input"]');
    await page.fill('[data-testid="commander-input"]', alphaName);
    await page.click('[data-testid="join-btn"]');
    await page.waitForSelector('[data-testid="game-shell"]');
    const playerId = await page.evaluate(() => window.starhold.getState().playerId);
    assert(playerId, `${tag} missing player`);

    const rival = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ name: bravoName }),
    });
    assert(rival.status === 200 && rival.body?.player?.id, `${tag} rival join`);

    await grant(playerId, {
      resources: { metal: 5_000_000, crystal: 5_000_000, deuterium: 5_000_000 },
      buildings: { shipyard: 1 },
      starshards: 800,
      colonySlot: 15,
      inbox: true,
    });

    await page.goto(`${WEB}/buildings?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="upgrade-rigFoundry"]');
    const foundry = page.locator('[data-testid="upgrade-rigFoundry"]');
    assert(await foundry.isDisabled(), `${tag} rig foundry should be locked`);
    assert((await foundry.innerText()).includes("Locked"), `${tag} locked label`);
    const vault = page.locator('[data-testid="building-metalStorage"]');
    const vaultText = await vault.innerText();
    assert(vaultText.includes("30,000"), `${tag} vault tooltip/description: ${vaultText}`);
    assert(vaultText.includes("60,000"), `${tag} next vault cap missing`);
    const cap = await page.locator('[data-testid="res-metal"] .sub').innerText();
    assert(cap.includes("30,000") || cap.includes("60,000"), `${tag} metal cap ${cap}`);

    const solar = page.locator('[data-testid="upgrade-solarPlant"]');
    const solarLabel = await solar.innerText();
    assert(
      !solarLabel.includes("Locked"),
      `${tag} affordable solar should not say Locked (${solarLabel})`,
    );

    await page.goto(`${WEB}/defenses?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    const qty = page.locator('[data-testid="defense-count-needleTurret"]');
    await qty.waitFor();
    await page.evaluate(() => window.scrollTo(0, 360));
    await qty.click();
    await qty.fill("7");
    const before = await page.evaluate(() => ({
      y: window.scrollY,
      active: document.activeElement?.getAttribute("data-testid"),
      value: document.querySelector('[data-testid="defense-count-needleTurret"]')?.value,
      top: document
        .querySelector('[data-testid="defense-count-needleTurret"]')
        ?.getBoundingClientRect().top,
    }));
    assert(before.active === "defense-count-needleTurret", `${tag} focus before poll`);
    assert(before.value === "7", `${tag} value before poll`);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.starhold.poll());
      await page.waitForTimeout(250);
    }
    const after = await page.evaluate(() => ({
      y: window.scrollY,
      active: document.activeElement?.getAttribute("data-testid"),
      value: document.querySelector('[data-testid="defense-count-needleTurret"]')?.value,
      top: document
        .querySelector('[data-testid="defense-count-needleTurret"]')
        ?.getBoundingClientRect().top,
    }));
    assert(after.value === "7", `${tag} quantity lost across polls: ${after.value}`);
    assert(
      after.active === "defense-count-needleTurret",
      `${tag} focus lost across polls: ${after.active}`,
    );
    assert(Math.abs(after.y - before.y) < 8, `${tag} scroll jumped ${before.y} -> ${after.y}`);
    assert(
      Math.abs(after.top - before.top) < 8,
      `${tag} quantity field shifted ${before.top} -> ${after.top}`,
    );

    await page.goto(`${WEB}/highscore?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="highscores-list"]');
    const rows = await page.locator("#highscores-list li, [data-testid='highscores-list'] li").count();
    let state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if ((state.body.ownedPlanets ?? []).length < 2) {
      await grant(playerId, { colonySlot: 3 });
      state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    }
    assert(
      (state.body.ownedPlanets ?? []).length >= 2,
      `${tag} colony was not created`,
    );
    const board = state.body.highscores ?? [];
    assert(rows === board.length, `${tag} highscore rows ${rows} != ${board.length}`);
    const ids = await page.locator("[data-player-id]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-player-id")),
    );
    const unique = new Set(ids);
    assert(unique.size === ids.length, `${tag} duplicate highscore players`);
    const text = await page.locator("#page-main").innerText();
    assert(!text.includes("Far Holding"), `${tag} colony listed on highscores`);
    const self = board.find((row) => row.playerId === playerId);
    assert(self, `${tag} missing self on board`);
    assert(text.includes(self.planetName), `${tag} home planet name missing`);
    assert(
      text.includes(`${self.coords.galaxy}:${self.coords.system}:${self.coords.slot}`),
      `${tag} home coords missing`,
    );

    await page.goto(`${WEB}/messages?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="delete-all-alerts"]');
    await page.click('[data-testid="delete-all-alerts"]');
    await page.waitForSelector('[data-testid="delete-confirm-alerts"]');
    assert(
      (await page.locator('[data-testid="message-fleetReturn-evt"], [data-testid^="message-fleetReturn-"]').count()) > 0,
      `${tag} alert vanished before confirm`,
    );
    await page.click('[data-testid="delete-all-alerts-confirm"]');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="message-fleetReturn-"]').length === 0,
    );
    assert(
      (await page.locator('[data-testid^="message-combat-"]').count()) > 0,
      `${tag} combat removed with alerts`,
    );
    const afterDelete = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    const alertsLeft = (afterDelete.body.player.eventLog ?? []).length;
    assert(alertsLeft === 0, `${tag} alerts still on server (${alertsLeft})`);
    assert(
      (afterDelete.body.reports ?? []).length > 0,
      `${tag} combat report deleted with alerts`,
    );

    await page.goto(`${WEB}/skills?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="skill-level-eco_mines_1"]');
    let levelText = await page.locator('[data-testid="skill-level-eco_mines_1"]').innerText();
    assert(levelText.includes("Level 0"), `${tag} skill start ${levelText}`);
    await page.click('[data-testid="unlock-skill-eco_mines_1"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="skill-level-eco_mines_1"]')
          ?.textContent?.includes("Level 1"),
    );
    await page.click('[data-testid="unlock-skill-eco_mines_1"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="skill-level-eco_mines_1"]')
          ?.textContent?.includes("Level 2"),
    );
    const skillsText = await page.locator('[data-testid="skills-panel"]').innerText();
    assert(!skillsText.includes("eco_mines"), `${tag} skill id visible`);
    assert(!skillsText.includes("_"), `${tag} underscore in skills text`);

    await page.goto(`${WEB}/officers?playerId=${encodeURIComponent(playerId)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('[data-testid="officer-level-engineer"]');
    await page.click('[data-testid="activate-officer-engineer"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="officer-level-engineer"]')
          ?.textContent?.includes("Level 1"),
    );
    await page.click('[data-testid="raise-officer-engineer"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="officer-level-engineer"]')
          ?.textContent?.includes("Level 2"),
    );
    const saved = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    assert(saved.body.skillLevels?.eco_mines_1 === 2, `${tag} skill level not saved`);
    assert(saved.body.officerLevels?.engineer === 2, `${tag} officer level not saved`);
    const officerText = await page.locator('[data-testid="officers-panel"]').innerText();
    assert(!officerText.includes("_"), `${tag} underscore in officer text`);

    console.log(`ok ${tag}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      await runViewport(browser, viewport);
    }
  } finally {
    await browser.close();
  }
  console.log("PLAYTEST_11_17_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
