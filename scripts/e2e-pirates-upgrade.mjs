#!/usr/bin/env node
/**
 * Quality-gate Playwright: signup → login → cookie persist + pirate upgrade surface.
 * Expects local prod serve: npm run build:vercel && PORT=3001 SESSION_SECRET=... npm start
 * Env: STARHOLD_WEB / STARHOLD_API (default http://127.0.0.1:3001), SESSION_SECRET set on server.
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";
const require = createRequire(import.meta.url);

async function waitHealthy(ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        return body;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("API health timeout");
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) {
    return raw.map((c) => c.split(";")[0]).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single.split(",").map((p) => p.split(";")[0].trim()).filter((p) => p.includes("=")).join("; ");
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
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, cookie: cookieFrom(res) };
}

async function apiAuthFlow() {
  const stamp = Date.now().toString(36);
  const email = `pirate-gate-${stamp}@example.com`;
  const password = `GatePass-${stamp}-xx`;

  const signup = await api("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (signup.res.status !== 200) {
    throw new Error(`signup failed: ${signup.res.status} ${JSON.stringify(signup.body)}`);
  }
  if (!signup.cookie.includes("starhold_session=")) {
    throw new Error(`signup missing session cookie: ${signup.cookie}`);
  }
  const cookie = signup.cookie;

  const me1 = await api("/api/auth/me", { headers: { Cookie: cookie } });
  if (me1.res.status !== 200 || me1.body?.account?.email !== email) {
    throw new Error(`auth/me after signup failed: ${JSON.stringify(me1.body)}`);
  }

  const join = await api("/api/auth/join", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: `PirateGate${stamp.slice(-4)}` }),
  });
  if (join.res.status !== 200 || !join.body?.player?.id) {
    throw new Error(`auth/join failed: ${JSON.stringify(join.body)}`);
  }
  const playerId = join.body.player.id;

  const me2 = await api("/api/auth/me", { headers: { Cookie: cookie } });
  if (me2.body?.account?.playerId !== playerId) {
    throw new Error(`persist fail after join: ${JSON.stringify(me2.body)}`);
  }

  // Fresh login must resume same commander.
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (login.res.status !== 200) {
    throw new Error(`login failed: ${JSON.stringify(login.body)}`);
  }
  const loginCookie = login.cookie || cookie;
  if (login.body?.account?.playerId !== playerId) {
    throw new Error(`login did not resume player: ${JSON.stringify(login.body)}`);
  }
  const me3 = await api("/api/auth/me", { headers: { Cookie: loginCookie } });
  if (me3.body?.account?.playerId !== playerId || me3.body?.view?.player?.id !== playerId) {
    throw new Error(`cookie persist fail after login: ${JSON.stringify(me3.body)}`);
  }

  return { email, password, cookie: loginCookie, playerId, view: me3.body.view };
}

async function pirateUpgradeApi(playerId, cookie) {
  const state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`, {
    headers: { Cookie: cookie },
  });
  if (state.res.status !== 200) {
    throw new Error(`state failed: ${JSON.stringify(state.body)}`);
  }
  const galaxy = state.body?.galaxy;
  const pirate = galaxy?.pirateBase;
  // May be null if home system has no pirate — browse via API join space or health-side.
  // Force a known universe tick by reading galaxy for a system that has pirates.
  // Seed density ~1/40; scan a few systems from player home.
  let found = pirate;
  const home = state.body?.planet?.coords ?? state.body?.player?.homeCoords;
  if (!found && home) {
    outer: for (
      let gal = Number(home.galaxy) || 1;
      gal <= Math.min(10, (Number(home.galaxy) || 1) + 2);
      gal++
    ) {
      for (let s = 1; s <= MAP_SCAN; s++) {
        const g = await api(
          `/api/state?playerId=${encodeURIComponent(playerId)}&galaxy=${gal}&system=${s}`,
          { headers: { Cookie: cookie } },
        );
        if (g.body?.galaxy?.pirateBase) {
          found = g.body.galaxy.pirateBase;
          break outer;
        }
      }
    }
  }
  if (!found) {
    // Fallback: createUniverse path already seeded; use internal join view galaxy fields
    throw new Error("no pirate base found in scan — seed density unexpected");
  }
  if (found.level == null && found.tier == null) {
    throw new Error(`pirate missing level/tier: ${JSON.stringify(found)}`);
  }
  const level = found.level ?? found.tier;
  if (typeof level !== "number" || level < 0) {
    throw new Error(`bad pirate level: ${JSON.stringify(found)}`);
  }
  return found;
}

const MAP_SCAN = 399;

async function uiAuthAndPirate(browser) {
  const page = await browser.newPage();
  const stamp = Date.now().toString(36);
  const email = `ui-pirate-${stamp}@example.com`;
  const password = `UiGate-${stamp}-xx`;

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="auth-signup-btn"]', { timeout: 30_000 });

  await page.fill('[data-testid="auth-email"]', email);
  await page.fill('[data-testid="auth-password"]', password);
  await page.click('[data-testid="auth-signup-btn"]');
  await page.waitForSelector('[data-testid="account-email"]', { timeout: 30_000 });

  await page.fill('[data-testid="commander-input"]', `UiPirate${stamp.slice(-4)}`);
  await page.click('[data-testid="join-btn"]');
  await page.waitForSelector(".level-label", { timeout: 45_000 });

  // Cookie persist: reload and still authed in shell
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".level-label", { timeout: 30_000 });

  // Open Galaxy and step systems until pirate Lv row appears.
  await page.locator('[data-testid="nav-galaxy"]').click();
  await page.waitForSelector('[data-testid="galaxy-panel"]', { timeout: 15_000 });

  let pirateText = "";
  for (let i = 0; i < 250; i++) {
    const row = page.locator('[data-testid="galaxy-pirate"]');
    if (await row.count()) {
      pirateText = (await row.first().innerText()).trim();
      break;
    }
    const next = page.locator('[data-testid="galaxy-next"]');
    await next.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-testid="galaxy-next"]');
      return btn instanceof HTMLButtonElement && !btn.disabled;
    });
    const before = await page.locator('[data-testid="galaxy-label"]').innerText();
    await next.click();
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-testid="galaxy-label"]');
        return el && el.textContent && el.textContent.trim() !== prev;
      },
      before,
      { timeout: 10_000 },
    );
  }
  if (!pirateText) {
    throw new Error("ui: browsed systems without galaxy-pirate row");
  }
  if (!/Lv\s*\d+/i.test(pirateText)) {
    throw new Error(`galaxy pirate missing Lv label: ${pirateText}`);
  }
  console.log("ui pirate ok", pirateText);

  await page.close();
  return { email };
}

async function main() {
  const health = await waitHealthy();
  console.log("health", health);

  const auth = await apiAuthFlow();
  console.log("auth ok", auth.playerId);

  const pirate = await pirateUpgradeApi(auth.playerId, auth.cookie);
  console.log("pirate api ok", {
    id: pirate.id,
    level: pirate.level ?? pirate.tier,
    threatHint: pirate.threatHint,
  });

  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    console.log("playwright not installed — API gate passed; skip UI");
    return;
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    await uiAuthAndPirate(browser);
    console.log("ui auth+pirate ok");
  } finally {
    await browser.close();
  }
  console.log("GATE_PASS e2e-pirates-upgrade");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
