/**
 * Playwright against `wrangler dev --local`.
 * Signup, login, build, fleet launch, refresh at 1280×800 and 390×844.
 *
 *   STARHOLD_WEB=http://127.0.0.1:8787 node scripts/workers-e2e.mjs
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:8787";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

async function waitHealthy() {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`${WEB}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("worker health timeout");
}

async function runViewport(width, height) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  const stamp = Date.now().toString(36);
  const email = `cf${stamp}@example.com`;
  const password = "starhold-cf";
  const name = `Cf${stamp.slice(-4)}`;
  try {
    await page.goto(WEB, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="auth-email"]', { timeout: 20_000 });
    await page.fill('[data-testid="auth-email"]', email);
    await page.fill('[data-testid="auth-password"]', password);
    await page.click('[data-testid="auth-signup-btn"]');
    await page.waitForSelector('[data-testid="account-email"]', { timeout: 20_000 });

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="auth-email"]', { timeout: 20_000 });
    await page.fill('[data-testid="auth-email"]', email);
    await page.fill('[data-testid="auth-password"]', password);
    await page.click('[data-testid="auth-login-btn"]');
    await page.waitForSelector('[data-testid="account-email"]', { timeout: 20_000 });

    await page.fill('[data-testid="commander-input"]', name);
    await page.click('[data-testid="join-btn"]');
    await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });

    await page.click('[data-testid="nav-buildings"]');
    await page.click('[data-testid="upgrade-metalMine"]');
    await page.waitForSelector(
      '[data-testid="flash-ok"], [data-testid="build-queue"]',
      { timeout: 15_000 },
    );

    const playerId = await page.evaluate(() => window.starhold.getState().playerId);
    if (!playerId) throw new Error("missing player after join");
    const grant = await fetch(`${WEB}/api/e2e/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        ships: { scout: 1 },
        resources: { metal: 5000, crystal: 5000, deuterium: 5000 },
      }),
    });
    if (!grant.ok) throw new Error(`grant failed ${grant.status}`);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
    await page.click('[data-testid="nav-fleet"]');
    await page.waitForSelector('[data-testid="fleet-form"]', { timeout: 15_000 });
    const expedition = page.locator('[data-testid="mission-expedition"]');
    if (await expedition.count()) await expedition.first().click();
    await page.fill('[data-testid="fleet-count-scout"]', "1");
    await page.click('[data-testid="launch-fleet"]');
    await page.waitForSelector(
      '[data-testid="fleets-live"], [data-testid="flash-ok"]',
      { timeout: 15_000 },
    );
    const launchErr = await page.locator('[data-testid="flash-error"]').count();
    if (launchErr > 0) {
      throw new Error(
        `fleet launch: ${await page.textContent('[data-testid="flash-error"]')}`,
      );
    }

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
    const after = await page.evaluate(() => window.starhold.getState());
    if (after.playerId !== playerId) {
      throw new Error(`refresh lost player ${playerId} -> ${after.playerId}`);
    }
    if ((after.fleets?.length ?? 0) < 1 && (after.name ?? "") !== name) {
      throw new Error(`refresh lost commander state ${JSON.stringify(after?.name)}`);
    }
    console.log(`ok ${width}x${height} ${name}`);
  } finally {
    await browser.close();
  }
}

await waitHealthy();
await runViewport(1280, 800);
await runViewport(390, 844);
console.log("workers e2e ok");
