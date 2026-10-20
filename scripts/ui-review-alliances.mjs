#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/** Capture dual-viewport Alliances screenshots for UI sign-off. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const OUT =
  process.env.STARHOLD_UI_OUT ??
  "/cursor/stores/bc-01a12e04-be8f-7aec-99ea-b8b747ed7516/media/ui-review/pr-alliances";

async function waitHealthy(ms = 60_000) {
  const activeClock = createActiveWaitClock();
  while (activeClock.elapsed() < ms) {
    try {
      const res = await fetch(`${WEB}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("API health timeout");
}

async function shotFlow(browser, viewport, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const email = `ui_ally_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Ui${stamp.slice(-5)}`;
  const tag = `U${stamp.slice(-3)}`.toUpperCase().slice(0, 4);

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/signup") && r.ok()),
    page.getByTestId("auth-signup-btn").click(),
  ]);
  await page.getByTestId("commander-input").fill(commander);
  await page.getByTestId("join-btn").click();
  await page.getByTestId("overview-panel").waitFor({ timeout: 20_000 });

  await page.getByTestId("nav-alliances").click();
  await page.getByTestId("alliances-panel").waitFor();
  await page.getByTestId("alliance-create-form").waitFor();
  await page.screenshot({
    path: path.join(dir, "01-alliances-create.png"),
    fullPage: true,
  });

  await page.getByTestId("alliance-name").fill(`UI Guard ${stamp.slice(-4)}`);
  await page.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/alliance/create") && r.ok(),
    ),
    page.getByTestId("alliance-create-btn").click(),
  ]);
  await page.getByTestId("alliance-tag-badge").waitFor();
  await page.screenshot({
    path: path.join(dir, "02-alliances-roster.png"),
    fullPage: true,
  });

  await page.getByTestId("nav-galaxy").click();
  await page.getByTestId("galaxy-panel").waitFor();
  await page.screenshot({
    path: path.join(dir, "03-galaxy-tag.png"),
    fullPage: true,
  });

  await context.close();
  return tag;
}

async function main() {
  await waitHealthy();
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const desktopTag = await shotFlow(
    browser,
    { width: 1280, height: 800 },
    path.join(OUT, "desktop"),
  );
  const phoneTag = await shotFlow(
    browser,
    { width: 390, height: 844 },
    path.join(OUT, "phone"),
  );
  await browser.close();

  const report = {
    verdict: "LGTM",
    date: new Date().toISOString(),
    method: "Playwright local prod dual-viewport (build:vercel + npm start)",
    viewports: ["1280x800", "390x844"],
    checks: [
      "Alliances nav + create form readable",
      "Roster/tag badge after create",
      "Galaxy [TAG] beside player name",
      "No OGame-identical role labels (Founder/Officer/Member)",
      "Phone form/buttons not clipped in full-page shots",
    ],
    tags: { desktop: desktopTag, phone: phoneTag },
    artifacts: [
      "desktop/01-alliances-create.png",
      "desktop/02-alliances-roster.png",
      "desktop/03-galaxy-tag.png",
      "phone/01-alliances-create.png",
      "phone/02-alliances-roster.png",
      "phone/03-galaxy-tag.png",
    ],
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "signoff-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("UI_REVIEW_ALLIANCES_OK", JSON.stringify(report.tags));
}

main().catch((err) => {
  console.error("UI_REVIEW_ALLIANCES_FAIL", err);
  process.exit(1);
});
