#!/usr/bin/env node
/**
 * Local smoke: UI join (URL + typed + helper), upgrade level via click, build-ship,
 * P1 flashes, fleet mission (attack + loot report).
 * Requires: npm run dev (web :5173, api :3001) and playwright + chromium.
 *
 * Steps (manual equivalent):
 * 1. Open http://127.0.0.1:5173/?commander=Smoke
 *    or type a name / run window.starhold.join("Smoke")
 * 2. Click Upgrade on Shipyard — level must rise 0→1 (not silent no-op under 1s polls).
 *    While "Queue busy", click another Upgrade — red flash must survive ~2s of polls.
 * 3. Click Metal Vault when unaffordable — flash "Not enough resources."
 * 4. Bank to ≥220 metal, click Build on Scout — hangar scout increments.
 * 5. Second commander + UI Launch fleet (attack) → combat report with loot path.
 */
import { createRequire } from "node:module";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:5173";
const API = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";

async function waitHealthy(ms = 30_000) {
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
  const res = await fetch(`${API}${path}`, init);
  return res.json();
}

async function waitMetal(playerId, minMetal, ms = 360_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if (st.planet.resources.metal >= minMetal && !st.planet.buildQueue) {
      return st;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${minMetal} metal`);
}

async function apiSmoke() {
  const name = `Smoke${Date.now().toString(36).slice(-5)}`;
  const join = await apiJson("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!join.player?.id) throw new Error(`join failed: ${JSON.stringify(join)}`);
  const playerId = join.player.id;

  const up = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "shipyard" }),
  });
  if (up.error) throw new Error(`yard upgrade: ${up.error}`);

  const busy = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalMine" }),
  });
  if (busy.error !== "A building is already under construction.") {
    throw new Error(`expected double-queue error, got: ${JSON.stringify(busy)}`);
  }

  const vault = await apiJson("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId: "metalStorage" }),
  });
  // Vault either blocked by queue or unaffordable — both are valid reject strings.
  if (!vault.error) throw new Error("expected vault reject while poor/busy");

  await waitMetal(playerId, 220, 360_000);

  const ship = await apiJson("/api/build-ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, shipId: "scout", count: 1 }),
  });
  if (ship.error) throw new Error(`build scout: ${ship.error}`);

  let scoutReady = null;
  for (let i = 0; i < 30; i++) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if ((st.planet?.ships?.scout ?? 0) >= 1) {
      scoutReady = st;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!scoutReady) throw new Error("scout never entered hangar");

  // Fleets: second commander as fleet-mission target
  const victimName = `Vic${Date.now().toString(36).slice(-5)}`;
  const victim = await apiJson("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: victimName }),
  });
  if (!victim.player?.id || !victim.planet?.id) {
    throw new Error(`victim join failed: ${JSON.stringify(victim)}`);
  }

  const launch = await apiJson("/api/launch-fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      targetPlanetId: victim.planet.id,
      mission: "raid",
      ships: { scout: 1 },
    }),
  });
  if (launch.error) throw new Error(`launch fleet mission: ${launch.error}`);
  if (!Array.isArray(launch.fleets) || launch.fleets.length < 1) {
    throw new Error(`expected outbound fleet: ${JSON.stringify(launch.fleets)}`);
  }

  // Wait for resolve + return. ETA scales with map distance (crowded uni → longer).
  const outboundMs = Math.max(0, launch.fleets[0].arrivesAt - Date.now());
  const deadline = Date.now() + Math.max(90_000, outboundMs * 3 + 20_000);
  let reportSeen = false;
  let lootOk = false;
  while (Date.now() < deadline) {
    const st = await apiJson(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if ((st.reports?.length ?? 0) >= 1) {
      reportSeen = true;
      const r = st.reports[0];
      const lootTotal =
        (r.loot?.metal ?? 0) + (r.loot?.crystal ?? 0) + (r.loot?.deuterium ?? 0);
      // Empty-hangar target → attacker win; loot may be 0 if cargo tiny / stocks drained,
      // but report must exist with an outcome.
      lootOk = Boolean(r.outcome) && (lootTotal >= 0);
    }
    if (reportSeen && lootOk && (st.fleets?.length ?? 0) === 0) {
      console.log("API smoke OK", {
        name,
        playerId,
        scout: st.planet.ships.scout,
        reports: st.reports.length,
        loot: st.reports[0]?.loot,
      });
      return { name, playerId, victimName };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `fleet mission never resolved / returned (outboundEtaMs≈${outboundMs}, reportSeen=${reportSeen})`,
  );
}

async function goNav(page, id) {
  await page.click(`[data-testid="nav-${id}"]`);
  await page.waitForSelector(`[data-testid="page-${id}"]`, { timeout: 10_000 });
}

async function uiSmoke() {
  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const logs = [];

  // 1) URL commander join
  const urlName = `Url${Date.now().toString(36).slice(-4)}`;
  const page = await browser.newPage();
  await page.goto(`${WEB}/?commander=${encodeURIComponent(urlName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="side-nav"]', { timeout: 10_000 });
  await goNav(page, "highscore");
  await page.waitForSelector('[data-testid="highscores"]', { timeout: 10_000 });
  const hsRank = await page.locator('[data-testid="highscore-1"]').count();
  if (hsRank < 1) throw new Error("highscores missing rank #1");
  logs.push("ui-highscores");
  const galaxyHasMoon = await page.evaluate(() => {
    const st = window.starhold?.getState();
    const slots = st?.galaxy?.slots ?? [];
    return slots.length > 0 && slots.every((s) => typeof s.hasMoon === "boolean");
  });
  if (!galaxyHasMoon) throw new Error("galaxy slots missing hasMoon");
  logs.push("ui-galaxy-moon-field");
  const joined = await page.evaluate(() => window.starhold?.getState());
  if (joined?.name !== urlName) {
    throw new Error(`URL join failed: ${JSON.stringify(joined)}`);
  }
  logs.push(`url-join:${urlName}`);

  // 2) P0: Shipyard Upgrade click must raise L0→L1 under aggressive poll pressure.
  // Catalog id is `shipyard` (data-testid=upgrade-shipyard) — not metalMine/Ore.
  await goNav(page, "facilities");
  const yardLevelBefore = await page.textContent(
    '[data-testid="building-level-shipyard"]',
  );
  if (!yardLevelBefore?.includes("L0")) {
    throw new Error(`expected shipyard L0 before click, got: ${yardLevelBefore}`);
  }
  const yardBtn = page.locator('[data-testid="upgrade-shipyard"]');
  const yardAttr = await yardBtn.getAttribute("data-upgrade");
  if (yardAttr !== "shipyard") {
    throw new Error(`upgrade-shipyard data-upgrade mismatch: ${yardAttr}`);
  }

  // Hammer silent polls while clicking — reproduces 1s multi-client poll races
  // (must not use refresh(): that sets busy and can reject Upgrade).
  const pollHammer = await page.evaluateHandle(() => {
    const id = window.setInterval(() => {
      void window.starhold?.poll();
    }, 80);
    return id;
  });
  try {
    for (let i = 0; i < 8; i++) {
      await yardBtn.click({ timeout: 5_000 });
      await page.waitForTimeout(90);
      const leveled = await page.evaluate(() => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? "";
        const queue = document.querySelector('[data-testid="build-queue"]');
        const ok = document.querySelector('[data-testid="flash-ok"]');
        return (
          lvl.includes("L1") ||
          Boolean(queue?.textContent?.match(/Shipyard/i)) ||
          Boolean(ok?.textContent?.match(/Queued upgrade|Upgrade complete/i))
        );
      });
      if (leveled) break;
    }
  } finally {
    await page.evaluate((id) => window.clearInterval(id), pollHammer);
  }

  await page.waitForFunction(
    () => {
      const lvl =
        document.querySelector('[data-testid="building-level-shipyard"]')
          ?.textContent ?? "";
      const queue = document.querySelector('[data-testid="build-queue"]');
      const ok = document.querySelector('[data-testid="flash-ok"]');
      const st = window.starhold?.getState();
      return (
        lvl.includes("L1") ||
        (st?.buildings?.shipyard ?? 0) >= 1 ||
        Boolean(queue?.textContent?.match(/Shipyard/i)) ||
        Boolean(ok?.textContent?.match(/Queued upgrade|Upgrade complete/i))
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => {
      const lvl =
        document.querySelector('[data-testid="building-level-shipyard"]')
          ?.textContent ?? "";
      const queue = document.querySelector('[data-testid="build-queue"]');
      const st = window.starhold?.getState();
      return (lvl.includes("L1") || (st?.buildings?.shipyard ?? 0) >= 1) && !queue;
    },
    undefined,
    { timeout: 30_000 },
  );
  const yardLevelAfter = await page.textContent(
    '[data-testid="building-level-shipyard"]',
  );
  const yardState = await page.evaluate(
    () => window.starhold?.getState()?.buildings?.shipyard ?? 0,
  );
  if (!yardLevelAfter?.includes("L1") && yardState < 1) {
    throw new Error(
      `UI upgrade did not raise shipyard level (before=${yardLevelBefore}, after=${yardLevelAfter}, state=${yardState})`,
    );
  }
  logs.push("ui-upgrade-shipyard-level-under-poll-hammer");

  // 3) P1 double-queue flash + persistence across polls (yard already L1 — upgrade solar)
  await goNav(page, "resources");
  await page.click('[data-testid="upgrade-solarPlant"]');
  await page.waitForSelector('[data-testid="flash-ok"], [data-testid="build-queue"]', {
    timeout: 10_000,
  });
  await page.click('[data-testid="upgrade-metalMine"]');
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const errText = await page.textContent('[data-testid="flash-error"]');
  if (!errText?.includes("already under construction")) {
    throw new Error(`bad double-queue flash: ${errText}`);
  }
  await page.waitForTimeout(2500);
  if ((await page.locator('[data-testid="flash-error"]').count()) < 1) {
    throw new Error("flash cleared by polls too early");
  }
  logs.push("p1-double-queue-flash");

  // 4) Unaffordable vault (after dismissing prior flash via new click)
  await page.click('[data-testid="upgrade-metalStorage"]');
  await page.waitForSelector('[data-testid="flash-error"]', { timeout: 10_000 });
  const vaultErr = await page.textContent('[data-testid="flash-error"]');
  if (
    !vaultErr?.includes("Not enough resources") &&
    !vaultErr?.includes("already under construction")
  ) {
    throw new Error(`bad vault flash: ${vaultErr}`);
  }
  logs.push("p1-unaffordable-or-busy-flash");

  // 5) Typed join (fresh page — input must accept fill)
  const typedPage = await browser.newPage();
  await typedPage.goto(WEB, { waitUntil: "networkidle" });
  await typedPage.waitForSelector('[data-testid="commander-constORDoin (U= `;

 Name = `Url${Date.now().toString(36).slicdle" });
  awaitawait page.click('[data-testid="commander-codle" });
  awaitust  page.click('[data-testid="command,});
  t: 10_000 });lt typedPa);
  await"commVaite page.click('[data-testid="commander-coror");lt (ya);
  t)
  ) {
    throw h pagewaite bies �URL joinwai}`workidle" });
  await typedPage.wait300t: 10_000 });l2t typedPa);
  await"commVaite page.click('[data-testid="commander-coror");l2t (ya);
  t)
  ) {
    throw h pagewin (Uble vaue {
  inwai2}`workidle" });
  awaitawait page.click('[da/ 5)-btnander-codle" });
  awaitawait page.waitForSelector('[data-testid="resources"]', { timeout: 15}`);
  }
  );
  s.push(`);
  n:${urlName6) H+ typL commander jo + tconst typedPage = await browser.newPage( + tconst typedPage.goto(WEB, { waitUntil: "networkider jo + ter  const H+ tName = `Url${Date.now().toString(36).slicdle" } + tconstawait pag000 })(ntion(
    (busy");ame / run window.stan{vault,o + ter  coer.newPage( + tconstawait page.waitForSelector('[data-testid="resources"]', { timeout: 15}`);
  }
   + ters.push(` + ter  con:${urlName7)etal, cnew Ers("alrlder 1tence across polls (yard syncn
  conoin (fresyped jta-testid).error}`);
l,   const ClkName = `Url${Date.now().toString(36).slicdle" });
  await page.goto(`${WEB}/?commander=${encodeUR;
l,   coent(urlName)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="rt: 10_000 });
  await goNav(page, "facilamePrefclicIard Upgh(`$  tryoss p( } fet fP0 ag}

.syncsyped jrn { nqueuti-cunder-)w } = view;der-2 pollHammer = await page.evaluateHem 0.55nst id = window.setInterval(() => {
      void window.starhold?.poll100tipyard ??d;
  });
 urces");
  await page.click('[data-testid="upgrade-shipy00 },
  );
  await page.waitForFununction(
    () => {
        const lvl =
          document.querySelector('[data-testid="building-level-shipyard"]')
            ?.textContent ?? ");
        return (
          lvl.includes("L1") ||(
    () => window.starhold?.getState()?.buildings?.shipyardomplete/i))
       ts[0]?.l    },
    undedefined,
    { timeout: 3tate})`,;
    }
  } finally {
    await page.evaluate((id) => window.clearIntw;der-2 pollHammer);
  );
  await godAttr !== ;s)}`);
  }
u{
  etal, ck BuilA bu  // 4) Un setskill tr000 },
  );
  await page.waitForFunction(
    () => {
 bconstst queue = document.querySelector('[data-tes, shipuild-queue"]');
 d="up  consconst lvl =
        document.querySelector('[daid="d="up"] .waite')           ?.textC0"d-queue"]');
 d="upnstNumber(te.now(d="up  co)   llaing/,/g go")rTimeout(90);
  abepnstbco
          ?.textContent ?? "";
      const queue = document.querySelector('[data-testid="build-queue"]');
  {
  const queue = document.querySelector('[da {
 stid="build-queue");
        return||
     bco resourceurces     cesourceurces {
  cesourceurces abep        lvl.ll tr" resourceurce.resource220omplete/i))
      );
    },
    undefined,
    {8 timeout: 30_0 new click)
  await page.click('[data-tes, shipuild-qu },
  );
  await page.waitForFunction(
    () => {
   // Emonst queue = document.queourceurcege.locator('[data-test, shipu Hint:e-o}

  ld'sages-stub",
  ?? "";
  const queue = document.querySelector('[da {
 stid="build-queue"]');
      const ok = document.querySelector('[data-testid="flash-ok"]');
 nnstNumber(ta-tes
          ?.text0ld-queue");
    npyard ?? ||
      ) ?? ||
        Boolean(ok?.textConte, shi|I_ART.|nt?.made ci))
      );
    },
    undefined,
    { timeout: 15_0-qu },
  );
  await page.waitForFunction(
    () => {
   // Emonst queue = document.queourceurcege.locator('[data-test, shipu Hint:e-o}

  ld'sages-stub",
  ??);
    Number(ta-tes
          ?.text0lpyard) && !queue;
    },
    undefined,
    { timeout: 30_000  );
  }
  logta-tes, ship5_0-qu },
  );
  await page.wait1500t: 10_000 }notrinOrH // EmoorFunc0);
  if ((await page.locator('[data-testid="fh-error"]'yard ?? 0) >Number(vaultErr = await page.textContent('[data-test, shipu Hint:e-o}

  ld')lpyard) &&ror"]notrinOrH // ElaxyHasMoon) throw lo}`);
l,  feed0.65Uble va.staing hasMoon");
  ta-tesfeed0.65stid${urlName8)here. Cion cque// Fleets: secondgar cIanew Errt missi    `flegar portSe/eporuiSmoke() (man  const RivName = `Url${Date.now().toString(36).slice(-4)} (manconst typedPage = await browser.newPage( (mancons await page.goto(`${WEB}/?commander=${encodeUR (man  coent(urlName)}`, {
    waitUntil: "networkidle",
  } (mancons await page.waitForSelector('[data-testid="resources"]', { timeout: 15}`);
  }
   (mans.push(` (man  con:${urlNvaultErr = reload(.goto(WEB, { waitUntil: "networkider jo as
      <honst hsRank = await page.locator('[data-testid="rtscore-1"]').coun! as
      <h)  } finally {
    await page.goto(`${WEB}/?commander=${encodeUR;
l,   coent(urlNameme)}`, {
    waitUntil: "netwo    );
   ",
  });
  await page.waitForSelector('[data-testid="rt: 10}mmer);
  );
  await go
    case)leets ?? [];const hsRank = await page.locator('[data-testid="recomm"rtscore-1"]').coun];coif (hsRank < 1) throw ta-testid="recom  <p alaxy sl"t: 10_000 });
  await goNav(page, "resonstORDomg clnst hsRank = await page.locator('[data-testidd="upgrade- imglanet-rtscore-1"]').counomg clif (hsRank < 1) throw ror !== "omg cnnd elaxy sl"t: 10_000 });
  await goapi/lalStorage"]');
  await page.waitForSelector('[dataande } f="resources"]', { timeout: 15}`);
  }
 ataande } f-{WE-artd${urlNamecIanew ErrprefclrL jope bus missi    `fl,esh(rd anet.s subm }

  m new click)
  await page.click('[da    `fl- missuild-qu },
  );
  ust  page.click('[dataandecore-s, shipui go1 "resources");
  await page.click('[daJson("/api/latalStorage"]');
  await page.waitForSelector('[data-testlderd="flash-ok"], [data-testid="ld-queue"]', {
    timeout: 10_00  );
  }
  logmmander as fl-Json("d${urlName
  }

  /ttack) → com(    `fle/ Wait for resolr win], lln; lror(${fle)-qu },
  );
  await page.waitForFunction(
    () => {
 ];
  constconst ok = document.querySelector('[dattack)-];
  cod="flash-ok"]');
      const st = window.starhold?.getState();
      return  lootOk expeditludes("L1") ||
     if ((st.reports?.lengthomplete/i))
      );
    },
    undefined,
    {2 timeout: 30_000 },
      `fl const yardState = await page.evaluate(() => {
    const st = windw.starhold?.getState();     const r =?. st.repor[0];
     nsconst l(r?
        (r.loot?.metal? ?? 0) + (r.loot?.crystal? ?? 0) + (r.loot?.deuterium  });
   
s.scout,
        reports:(st.reports?.sages-st Boolea: l?  Boolearts?eetDra.length,
 ra.lengtf");

  /ootOk && (st.fleets?.etwo    "boolean");
 (    `fl consorts = view.0]').c.play    `fl conso Boolean(= urlName) {
    throw nIP1 flashes, flehighscorets = join failed: ${JSON    `fl consgify(joined)}`);
  }
  new Elogmmander as fl-ets = jaiti  `fl conso Boolea}:h,
 aiti  `fl consoh,
 }`t: 15_0-qu },
  ge = awaclo}ld?.get0) {
      coUole.log("API }`);ath}`, init){});
  }: 10_0usy");

 nction w)0.0.1:51web   const st functio0.0.1:51ub   const u functio0.0.1:
      c
    body: JSON.sok({ hea (web,1ub },?eetDr 2 ci)           