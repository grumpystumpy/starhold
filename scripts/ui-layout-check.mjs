#!/usr/bin/env node
import { createActiveWaitClock } from "./active-wait-clock.mjs";
/**
 * UI layout check: screenshots + bounding-box overlap/overflow detection.
 * Viewports: desktop 1280×800, phone 390×844.
 *
 * Env:
 *   STARHOLD_WEB   base URL (default http://127.0.0.1:3001)
 *   STARHOLD_API   API base (default STARHOLD_WEB)
 *   UI_REVIEW_OUT  artifact dir (default ./ui-review-out)
 *   UI_REVIEW_UPDATE_BASELINE  path to previous JSON report for screenshot-diff gate
 *   UI_REVIEW_FAIL_ON  comma list: overlap,overflow,forbidden,contrast (default all)
 *   UI_REVIEW_BASELINE_DIR  dir of baseline PNGs; new diffs fail when set
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const API = process.env.STARHOLD_API ?? WEB;
const OUT =
  process.env.UI_REVIEW_OUT ??
  path.resolve(process.cwd(), "ui-review-out");
const FAIL_ON = new Set(
  (process.env.UI_REVIEW_FAIL_ON ?? "overlap,overflow,forbidden,contrast")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const BASELINE_DIR = process.env.UI_REVIEW_BASELINE_DIR ?? "";
const MAX_DIFF_RATIO = Number(process.env.UI_REVIEW_MAX_DIFF_RATIO ?? "0.02");

const ROUTES = [
  "overview",
  "goals",
  "buildings",
  "defenses",
  "shipyard",
  "research",
  "fleet",
  "galaxy",
  "officers",
  "skills",
  "highscore",
  "alliances",
  "seasons",
  "messages",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

/** Round-2 contract: must not appear as user-facing labels. */
const FORBIDDEN_LABELS = [
  "Lunar Base",
  "Sensor Phalanx",
  "Jump Gate",
  "Death Star",
  "Colony Ship",
  "Outpost Cradle",
  "Swarm Mothership",
  "Spy Probe",
  "Laser Battery",
  "Shield Dome",
  "Energy Tech",
  "Combustion Drive",
  "Weapons Tech",
  "Armour Tech",
  "Shielding Tech",
  "Espionage Tech",
  "Astrophysics",
  "Computer Tech",
];

const SKIP_OVERLAP = new Set([
  "SCRIPT",
  "STYLE",
  "META",
  "LINK",
  "HEAD",
  "HTML",
  "BODY",
]);

async function waitHealthy(ms = 45_000) {
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
  throw new Error(`API health timeout (${API})`);
}

function rectsOverlap(a, b, slack = 1) {
  return !(
    a.right <= b.left + slack ||
    a.left >= b.right - slack ||
    a.bottom <= b.top + slack ||
    a.top >= b.bottom - slack
  );
}

function area(r) {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

async function collectLayoutIssues(page) {
  return page.evaluate(
    ({ skipTagList, forbidden }) => {
      const skipTags = new Set(skipTagList);
      const issues = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const candidates = [
        ...document.querySelectorAll(
          "a, button, h1, h2, h3, label, .nav-link, .planet-chip, .planet-chip-name, .item-thumb, .res, .queue, .panel, img.thumb, img.icon, .hint, .meta, [data-testid]",
        ),
      ].filter((el) => {
        if (skipTags.has(el.tagName)) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        if (Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        // Ignore off-screen sticky ghosts
        if (r.bottom < -20 || r.top > vh + 20) return false;
        return true;
      });

      const boxes = candidates.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          tag: el.tagName,
          testid: el.getAttribute("data-testid") || "",
          cls: (el.className && String(el.className).slice(0, 80)) || "",
          text: (el.innerText || el.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60),
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      });

      // Overflow: element extends past viewport or scroll parent content box badly
      for (const b of boxes) {
        if (b.right > vw + 2 || b.left < -2) {
          // Horizontal overflow of interactive/text chrome
          if (
            b.testid.startsWith("nav-") ||
            b.cls.includes("nav-link") ||
            b.cls.includes("planet-chip") ||
            b.cls.includes("res ") ||
            b.tag === "BUTTON" ||
            b.tag === "A"
          ) {
            issues.push({
              kind: "overflow",
              detail: `${b.testid || b.cls || b.tag} x=${b.left.toFixed(0)}..${b.right.toFixed(0)} vw=${vw}`,
              testid: b.testid,
            });
          }
        }
        // Truncation via ellipsis on labels that should be readable
        if (
          (b.cls.includes("planet-chip-name") ||
            b.cls.includes("label") ||
            b.testid.startsWith("building-level") ||
            b.testid.startsWith("nav-")) &&
          b.el.scrollWidth > b.el.clientWidth + 2
        ) {
          issues.push({
            kind: "truncated",
            detail: `${b.testid || b.cls}: "${b.text}"`,
            testid: b.testid,
          });
        }
      }

      // Pairwise overlap among siblings / chrome (skip nested containment)
      const interesting = boxes.filter(
        (b) =>
          b.testid ||
          b.cls.includes("nav-link") ||
          b.cls.includes("planet-chip") ||
          b.cls.includes("item-thumb") ||
          b.cls.includes("res") ||
          b.tag === "BUTTON" ||
          b.tag === "IMG",
      );

      function contains(a, b) {
        return (
          a.left <= b.left + 1 &&
          a.top <= b.top + 1 &&
          a.right >= b.right - 1 &&
          a.bottom >= b.bottom - 1
        );
      }

      for (let i = 0; i < interesting.length; i++) {
        for (let j = i + 1; j < interesting.length; j++) {
          const a = interesting[i];
          const b = interesting[j];
          if (contains(a, b) || contains(b, a)) continue;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          // Ignore image inside its labeled row (same parent item)
          if (
            (a.tag === "IMG" && b.el.contains?.(a.el) === false) ||
            (b.tag === "IMG" && a.el.contains?.(b.el) === false)
          ) {
            /* continue pairwise */
          }
          const overlapX =
            Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY =
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 4 && overlapY > 4) {
            const ovArea = overlapX * overlapY;
            const minArea = Math.min(
              a.width * a.height,
              b.width * b.height,
            );
            if (ovArea / minArea > 0.15) {
              // Text-over-image / image-over-text heuristics
              const imgText =
                (a.tag === "IMG" && b.text) || (b.tag === "IMG" && a.text);
              issues.push({
                kind: imgText ? "overlap-img-text" : "overlap",
                detail: `${a.testid || a.cls || a.tag} ∩ ${b.testid || b.cls || b.tag} (${Math.round(ovArea)}px)`,
                testid: a.testid || b.testid,
              });
            }
          }
        }
      }

      // Forbidden OGame-identical labels in visible text
      const bodyText = document.body?.innerText ?? "";
      for (const label of forbidden) {
        const matches =
          label === "Shield Dome"
            ? /(?<!(Small|Large)\s+)Shield Dome/.test(bodyText)
            : bodyText.includes(label);
        if (matches) {
          issues.push({
            kind: "forbidden",
            detail: `OGame-identical label visible: "${label}"`,
            testid: "",
          });
        }
      }

      // Low-contrast check on key text nodes (WCAG-ish relative luminance)
      function lum(c) {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      function parseRgb(str) {
        const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
      }
      function contrastRatio(fg, bg) {
        const L1 = lum(fg);
        const L2 = lum(bg);
        const hi = Math.max(L1, L2);
        const lo = Math.min(L1, L2);
        return (hi + 0.05) / (lo + 0.05);
      }

      const textEls = [
        ...document.querySelectorAll(
          ".nav-link, .res .label, .res .sub, .hint, .planet-chip-coords, .muted, .rail-title",
        ),
      ];
      for (const el of textEls) {
        const st = getComputedStyle(el);
        const fg = parseRgb(st.color);
        let bgEl = el;
        let bg = null;
        for (let i = 0; i < 8 && bgEl; i++) {
          bg = parseRgb(getComputedStyle(bgEl).backgroundColor);
          if (bg && !(bg[0] === 0 && bg[1] === 0 && bg[2] === 0 && getComputedStyle(bgEl).backgroundColor.includes("0)"))) {
            if (!getComputedStyle(bgEl).backgroundColor.includes("rgba(0, 0, 0, 0)")) {
              // accept non-transparent
              if (!/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(getComputedStyle(bgEl).backgroundColor)) {
                break;
              }
            }
          }
          bgEl = bgEl.parentElement;
          bg = null;
        }
        if (!fg || !bg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio < 3.0) {
          issues.push({
            kind: "contrast",
            detail: `${el.getAttribute("data-testid") || el.className} contrast ${ratio.toFixed(2)}:1`,
            testid: el.getAttribute("data-testid") || "",
          });
        }
      }

      // Icons without accessible name
      for (const img of document.querySelectorAll("img.icon, img.thumb")) {
        const alt = (img.getAttribute("alt") ?? "").trim();
        const labeled =
          alt ||
          img.closest("[title], [aria-label]") ||
          img.parentElement?.querySelector(".label, .planet-chip-name");
        if (!labeled && !alt) {
          // decorative empty alt is OK if sibling label exists
          const sib = img.parentElement?.textContent?.trim();
          if (!sib) {
            issues.push({
              kind: "icon-unlabeled",
              detail: `img without label near ${img.className}`,
              testid: "",
            });
          }
        }
      }

      return issues;
    },
    { skipTagList: [...SKIP_OVERLAP], forbidden: FORBIDDEN_LABELS },
  );
}

function pngHash(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Crude pixel diff ratio for equal-sized PNGs (raw byte delta). */
function roughDiffRatio(a, b) {
  if (a.length !== b.length) return 1;
  let diff = 0;
  const step = 16; // sample every 16th byte for speed
  let samples = 0;
  for (let i = 0; i < a.length; i += step) {
    samples++;
    if (a[i] !== b[i]) diff++;
  }
  return samples === 0 ? 0 : diff / samples;
}

async function goRoute(page, route, playerId) {
  const url = `${WEB}/${route}?playerId=${encodeURIComponent(playerId)}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForSelector('[data-testid="resources"]', { timeout: 20_000 });
  await page.waitForSelector(`[data-testid="page-${route}"]`, {
    timeout: 15_000,
  });
  // settle layout / fonts
  await page.waitForTimeout(350);
}

/** Hide volatile session text so screenshot baselines stay stable across runs. */
async function maskVolatile(page) {
  await page.evaluate(() => {
    const hide = [
      "[data-flash-slot]",
      ".flash",
      "[data-testid='planet-coords']",
      ".planet-chip-name",
      ".planet-chip-coords",
      ".res .value",
      ".res .sub",
      ".xp-text",
      ".level-label",
      "[data-testid='starshards-balance']",
      "[data-testid='highscores']",
    ];
    for (const sel of hide) {
      for (const el of document.querySelectorAll(sel)) {
        el.style.visibility = "hidden";
      }
    }
  });
}

async function main() {
  await waitHealthy();
  await mkdir(OUT, { recursive: true });
  for (const vp of VIEWPORTS) {
    await mkdir(path.join(OUT, vp.name), { recursive: true });
  }

  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });

  const name = `UiRev${Date.now().toString(36).slice(-5)}`;
  const joinRes = await fetch(`${API}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const join = await joinRes.json();
  if (!join.player?.id) {
    throw new Error(`join failed: ${JSON.stringify(join)}`);
  }
  const playerId = join.player.id;

  const report = {
    ok: true,
    web: WEB,
    playerId,
    name,
    at: new Date().toISOString(),
    viewports: {},
    failures: [],
    screenshotDiffs: [],
  };

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    report.viewports[vp.name] = {};

    for (const route of ROUTES) {
      const key = `${vp.name}/${route}`;
      try {
        await goRoute(page, route, playerId);
        const issues = await collectLayoutIssues(page);
        await maskVolatile(page);
        const shotPath = path.join(OUT, vp.name, `${route}.png`);
        const buf = await page.screenshot({
          path: shotPath,
          fullPage: true,
        });
        // galaxy moon view: try clicking first moon cell if present
        if (route === "galaxy") {
          const moonBtn = page.locator(
            '[data-testid*="moon"], button:has-text("Moon"), .has-moon',
          );
          if ((await moonBtn.count()) > 0) {
            try {
              await moonBtn.first().click({ timeout: 2000 });
              await page.waitForTimeout(300);
              const moonShot = path.join(OUT, vp.name, "galaxy-moon.png");
              await page.screenshot({ path: moonShot, fullPage: true });
            } catch {
              /* optional */
            }
          }
        }

        const deduped = [];
        const seen = new Set();
        for (const iss of issues) {
          const sig = `${iss.kind}|${iss.detail}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          deduped.push(iss);
        }

        report.viewports[vp.name][route] = {
          screenshot: shotPath,
          hash: pngHash(buf),
          issues: deduped,
        };

        if (BASELINE_DIR) {
          const basePath = path.join(BASELINE_DIR, vp.name, `${route}.png`);
          try {
            await access(basePath);
            const baseBuf = await readFile(basePath);
            const ratio = roughDiffRatio(buf, baseBuf);
            if (ratio > MAX_DIFF_RATIO) {
              report.screenshotDiffs.push({
                key,
                ratio,
                baseline: basePath,
                current: shotPath,
              });
            }
          } catch {
            // no baseline yet — record as new
            report.screenshotDiffs.push({
              key,
              ratio: 1,
              missingBaseline: true,
              current: shotPath,
            });
          }
        }

        for (const iss of deduped) {
          if (FAIL_ON.has(iss.kind) || (iss.kind === "overlap-img-text" && FAIL_ON.has("overlap"))) {
            report.failures.push({ viewport: vp.name, route, ...iss });
          }
        }
      } catch (err) {
        report.failures.push({
          viewport: vp.name,
          route,
          kind: "nav-error",
          detail: String(err?.message ?? err),
        });
        report.viewports[vp.name][route] = {
          error: String(err?.message ?? err),
        };
      }
    }
    await page.close();
  }

  // Screenshot-diff failures when baseline dir is set
  if (BASELINE_DIR) {
    for (const d of report.screenshotDiffs) {
      if (d.missingBaseline) continue; // first run seeds; don't fail CI until baselines committed
      report.failures.push({
        viewport: d.key.split("/")[0],
        route: d.key.split("/")[1],
        kind: "screenshot-diff",
        detail: `diff ratio ${(d.ratio * 100).toFixed(1)}% > ${MAX_DIFF_RATIO * 100}%`,
      });
    }
  }

  report.ok = report.failures.length === 0;
  const reportPath = path.join(OUT, "layout-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  // Human-readable summary
  const lines = [
    `# UI layout check`,
    ``,
    `- web: ${WEB}`,
    `- player: ${name} (${playerId})`,
    `- ok: ${report.ok}`,
    `- failures: ${report.failures.length}`,
    ``,
  ];
  for (const f of report.failures.slice(0, 80)) {
    lines.push(`- **${f.kind}** ${f.viewport}/${f.route}: ${f.detail}`);
  }
  await writeFile(path.join(OUT, "layout-report.md"), lines.join("\n"));

  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, failures: report.failures.length, out: OUT, reportPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
