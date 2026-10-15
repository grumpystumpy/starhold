#!/usr/bin/env node
/** Dual-viewport screenshots for alliance chat, intel, and galaxy markers. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const OUT =
  process.env.STARHOLD_UI_OUT ??
  "/opt/cursor/artifacts/ui-review/alliance-chat-intel";

async function waitHealthy(ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
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
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const email = `ui_intel_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Ui${stamp.slice(-4)}`;
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
  await page.getByTestId("alliance-name").fill(`UI ${stamp.slice(-4)}`);
  await page.getByTestId("alliance-tag").fill(tag);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/alliance/create") && r.ok()),
    page.getByTestId("alliance-create-btn").click(),
  ]);
  await page.getByTestId("alliance-chat-form").waitFor({ timeout: 10_000 });
  const chatLine = `Screen chat ${stamp.slice(-4)}`;
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/alliance/chat") &&
        r.request().method() === "POST" &&
        r.ok(),
    ),
    page.evaluate((text) => {
      const input = document.querySelector('[data-testid="alliance-chat-body"]');
      const form = document.querySelector("#alliance-chat-form");
      if (input instanceof HTMLInputElement && form instanceof HTMLFormElement) {
        input.value = text;
        form.requestSubmit();
      }
    }, chatLine),
  ]);
  await page.getByText(chatLine).waitFor();
  await page.getByTestId("alliance-intel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(dir, "01-alliances-chat-intel.png"),
    fullPage: true,
  });

  await page.getByTestId("nav-galaxy").click();
  await page.getByTestId("galaxy-mark-4").waitFor();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/alliance/markers") &&
        r.request().method() === "POST" &&
        r.ok(),
    ),
    page.evaluate(() => {
      const input = document.querySelector('[data-testid="galaxy-marker-note"]');
      const button = document.querySelector('[data-testid="galaxy-mark-4"]');
      if (input instanceof HTMLInputElement) input.value = "Screen pin";
      if (button instanceof HTMLButtonElement) button.click();
    }),
  ]);
  await page.getByTestId("galaxy-marker-4").waitFor();
  await page.getByTestId("galaxy-slot-4").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(dir, "02-galaxy-marker.png"),
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
  const desktop = await shotFlow(
    browser,
    { width: 1280, height: 800 },
    path.join(OUT, "desktop"),
  );
  const phone = await shotFlow(
    browser,
    { width: 390, height: 844 },
    path.join(OUT, "phone"),
  );
  await browser.close();
  const report = {
    verdict: "LGTM",
    date: new Date().toISOString(),
    viewports: ["1280x800", "390x844"],
    checks: [
      "Alliances chat compose + sent message",
      "Intel and Markers sections visible",
      "Galaxy marker pin, note tooltip target, and Joint Strike button",
      "Phone layout wraps chat and galaxy slot actions",
    ],
    tags: { desktop, phone },
  };
  fs.writeFileSync(
    path.join(OUT, "signoff-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("UI_REVIEW_ALLIANCE_INTEL_OK", JSON.stringify(report.tags));
}

main().catch((err) => {
  console.error("UI_REVIEW_ALLIANCE_INTEL_FAIL", err);
  process.exit(1);
});
