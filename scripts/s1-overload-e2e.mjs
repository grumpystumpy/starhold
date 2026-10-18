/**
 * Local production check for S1.
 * Expects the API and the Vite build on http://127.0.0.1:3001.
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");

const base = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const email = `s1-${Date.now().toString(36)}@example.com`;
const password = "hunter2xx";
const commander = `S1${Date.now().toString(36).slice(-4)}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const upgradePosts = [];
page.on("request", (req) => {
  if (req.method() === "POST" && new URL(req.url()).pathname === "/api/upgrade") {
    upgradePosts.push(req.url());
  }
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-signup-btn").click();
  await page.getByTestId("account-email").waitFor();
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.waitForFunction(() => window.starhold.getState().playerId);

  const playerId = await page.evaluate(() => window.starhold.getState().playerId);
  const grant = await fetch(`${base}/api/e2e/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      resources: { metal: 9_000_000, crystal: 9_000_000, deuterium: 9_000_000 },
      buildings: { shipyard: 2, researchLab: 2 },
    }),
  });
  if (!grant.ok) throw new Error(`grant ${grant.status} ${await grant.text()}`);
  await page.evaluate(() => window.starhold.refresh());
  await page.waitForFunction(
    () => (window.starhold.getState().buildings?.shipyard ?? 0) >= 2,
  );

  let holding = false;
  const waiters = [];
  await page.route("**/api/upgrade", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    holding = true;
    await route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "<html><title>Error 1102</title>Worker exceeded resource limits</html>",
    });
  });
  await page.route("**/api/state*", async (route) => {
    if (holding) await new Promise((resolve) => waiters.push(resolve));
    await route.continue();
  });

  const beforePosts = upgradePosts.length;
  await page.goto(`${base}/buildings`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("upgrade-metalMine").click();
  await page.waitForFunction(
    () => (window.starhold.getState().notice ?? "").includes("Checking whether your order"),
    null,
    { timeout: 10_000 },
  );
  holding = false;
  for (const resolve of waiters.splice(0)) resolve();
  await page.waitForFunction(
    () => window.starhold.getState().error === "Not applied — tap again.",
    null,
    { timeout: 10_000 },
  );
  const failedPosts = upgradePosts.length - beforePosts;
  if (failedPosts !== 1) throw new Error(`expected 1 upgrade POST, saw ${failedPosts}`);

  await page.unroute("**/api/upgrade");
  await page.unroute("**/api/state*");
  await page.getByTestId("upgrade-metalMine").click();
  await page.waitForFunction(
    () => (window.starhold.getState().notice ?? "").includes("Queued upgrade"),
    null,
    { timeout: 10_000 },
  );

  await page.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("research-btn-energyTech").click();
  await page.waitForFunction(
    () => (window.starhold.getState().notice ?? "").includes("Researching"),
    null,
    { timeout: 10_000 },
  );

  await page.goto(`${base}/shipyard`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("build-scout").click();
  await page.waitForFunction(
    () => (window.starhold.getState().notice ?? "").includes("Queued"),
    null,
    { timeout: 10_000 },
  );

  await page.evaluate(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    localStorage.removeItem("starhold.playerId");
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("auth-email").waitFor();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-login-btn").click();
  await page.waitForFunction(
    (name) => window.starhold.getState().name === name,
    commander,
    { timeout: 10_000 },
  );
  console.log("s1 e2e ok");
} finally {
  await browser.close();
}
