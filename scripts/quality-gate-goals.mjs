#!/usr/bin/env node
/**
 * Quality gate for daily/weekly goals — local production build only.
 * signup → login → persist → Overview goals → e2e progress → claim.
 *
 * Requires: build:vercel, server :3001 with SESSION_SECRET + STARHOLD_E2E=1.
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;

async function waitHealthy(ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
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
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const email = `gate_goals_${stamp}@example.com`;
  const password = `GateTest1!${stamp}`;
  const commander = `Gl${stamp.slice(-5)}`;
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
  const playerId = await page.evaluate(
    () => window.starhold?.getState()?.playerId,
  );
  if (!playerId) throw new Error("missing playerId");
  logs.push("joined");

  await page.getByTestId("goals-panel").waitFor({ timeout: 10_000 });
  await page.getByTestId("goal-dailyPirateWins").waitFor({ timeout: 5_000 });
  logs.push("goals_visible");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("goals-panel").waitFor({ timeout: 20_000 });
  logs.push("persist_reload");

  const note = await apiJson("/api/e2e/note-goal", {
    method: "POST",
    body: JSON.stringify({
      playerId,
      metric: "pirateWin",
      amount: 3,
    }),
  });
  if (!note.ok) {
    throw new Error(
      `e2e note-goal required (STARHOLD_E2E=1): ${note.status} ${JSON.stringify(note.data)}`,
    );
  }
  logs.push("e2e_note_goal");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("goals-panel").waitFor({ timeout: 15_000 });
  const claimBtn = page.getByTestId("claim-goal-dailyPirateWins");
  await claimBtn.waitFor({ timeout: 10_000 });
  const label = await claimBtn.textContent();
  if (!/Claim/i.test(label ?? "") || (await claimBtn.isDisabled())) {
    throw new Error(`expected claimable pirate goal, got: ${label}`);
  }
  await claimBtn.click();
  await page.getByTestId("flash-ok").waitFor({ timeout: 10_000 });
  logs.push("claim_ok");

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
  console.log("QUALITY_GATE_GOALS_OK", logs.join(","));
}

main().catch((err) => {
  console.error("QUALITY_GATE_GOALS_FAIL", err);
  process.exit(1);
});
