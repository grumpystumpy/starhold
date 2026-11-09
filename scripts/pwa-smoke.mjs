#!/usr/bin/env node
/**
 * Production-build check for the installable shell.
 * Requires the API+static server on STARHOLD_WEB (default http://127.0.0.1:3001).
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_NAME, classifyRequest, documentCacheUrl } from "../apps/web/public/sw.js";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const NEXT_CACHE = "starhold-shell-v2";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/pwa");
const DIST_SW = path.join(ROOT, "apps/web/dist/sw.js");

function pngSize(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a png");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function expectAsset(pathname, contentType, size) {
  const res = await fetch(`${WEB}${pathname}`);
  if (!res.ok) throw new Error(`${pathname} ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes(contentType)) {
    throw new Error(`${pathname} content-type ${type}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (size) {
    const got = pngSize(buf);
    if (got.width !== size || got.height !== size) {
      throw new Error(`${pathname} ${got.width}x${got.height}`);
    }
  }
  return buf;
}

function bumpCacheName(source) {
  const needle = `export const CACHE_NAME = "${CACHE_NAME}";`;
  if (!source.includes(needle)) throw new Error("sw.js cache name anchor missing");
  return source.replace(needle, `export const CACHE_NAME = "${NEXT_CACHE}";`);
}

function assertCachedAllowlist(urls, origin, label) {
  const docKey = documentCacheUrl(origin);
  const manifestKey = `${origin}/manifest.webmanifest`;
  if (!urls.includes(docKey) || !urls.includes(manifestKey) || docKey === manifestKey) {
    throw new Error(`${label} isolated keys missing ${urls.join(",")}`);
  }
  let script = false;
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.search) throw new Error(`${label} cache key has query ${url}`);
    if (parsed.origin !== origin) throw new Error(`${label} cached foreign ${url}`);
    const kind = classifyRequest(url, origin);
    if (kind === "bypass") throw new Error(`${label} cached non-allowlisted ${url}`);
    if (parsed.pathname.startsWith("/api/") || parsed.pathname === "/api") {
      throw new Error(`${label} cached API ${url}`);
    }
    if (kind === "cache-first" && /^\/assets\/[^/]+\.js$/.test(parsed.pathname)) script = true;
  }
  if (!script) throw new Error(`${label} allowlist cache has no hashed script`);
}

async function proveOfflineShell(context, origin, label) {
  const shellPage = await context.newPage();
  try {
    await shellPage.goto(WEB, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const controlled = await shellPage.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!controlled) await shellPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await context.setOffline(true);
    const response = await shellPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    const status = response?.status() ?? 0;
    if (status !== 200) throw new Error(`${label} offline shell status ${status}`);
    const html = await shellPage.content();
    if (!html.includes('id="app"')) throw new Error(`${label} offline shell missing app root`);
    const probe = await shellPage.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const keys = (await cache.keys()).map((req) => req.url);
      const manifest = await cache.match("/manifest.webmanifest");
      const document = await cache.match("/index.html");
      const manifestText = manifest ? await manifest.text() : "";
      const documentText = document ? await document.text() : "";
      const scriptKey = keys.find((url) => /\/assets\/[^/]+\.js$/.test(new URL(url).pathname)) ?? "";
      const matched = scriptKey ? await cache.match(scriptKey, { ignoreVary: true }) : null;
      await cache.delete("/manifest.webmanifest");
      const miss = await fetch("/manifest.webmanifest");
      const missText = await miss.text();
      const stillDoc = await cache.match("/index.html");
      const stillDocText = stillDoc ? await stillDoc.text() : "";
      let apiResult = "threw";
      try {
        const api = await fetch("/api/health");
        apiResult = `${api.status}:${(await api.text()).slice(0, 40)}`;
      } catch {
        apiResult = "threw";
      }
      let stray = "threw";
      try {
        const extra = await fetch("/planet-art/lush/planet-lush-01.webp");
        stray = `${extra.status}:${(await extra.text()).slice(0, 24)}`;
      } catch {
        stray = "threw";
      }
      return {
        keys,
        manifestText: manifestText.slice(0, 80),
        documentHasApp: documentText.includes('id="app"'),
        scriptStatus: matched ? matched.status : 0,
        appBooted: typeof window.starhold === "object",
        missStatus: miss.status,
        missType: miss.headers.get("content-type") ?? "",
        missText: missText.slice(0, 180),
        documentSurvived: stillDocText.includes('id="app"'),
        apiResult,
        stray,
      };
    }, CACHE_NAME);
    if (!probe.documentHasApp || !probe.manifestText.startsWith("{") || probe.manifestText.includes("<")) {
      throw new Error(`${label} cache bodies crossed ${probe.manifestText}`);
    }
    if (probe.scriptStatus !== 200) {
      throw new Error(`${label} offline script status ${probe.scriptStatus} keys=${probe.keys.join(",")}`);
    }
    if (!probe.appBooted) throw new Error(`${label} offline shell did not boot the cached app`);
    if (
      probe.missStatus !== 503 ||
      !probe.missType.includes("text/plain") ||
      !probe.missText.startsWith("Offline.") ||
      probe.missText.includes("<")
    ) {
      throw new Error(`${label} manifest miss ${probe.missStatus} ${probe.missType} ${probe.missText}`);
    }
    if (!probe.documentSurvived) throw new Error(`${label} manifest miss overwrote the document`);
    if (probe.apiResult !== "threw") throw new Error(`${label} offline API served ${probe.apiResult}`);
    if (probe.stray !== "threw") throw new Error(`${label} non-allowlisted served ${probe.stray}`);
    assertCachedAllowlist(probe.keys, origin, `${label} offline`);
    await mkdir(OUT, { recursive: true });
    await shellPage.screenshot({ path: path.join(OUT, `offline-${label}.png`), fullPage: true });
  } finally {
    await context.setOffline(false);
    await shellPage.close();
  }
}

async function waitForCacheName(page, name) {
  const deadline = Date.now() + 15_000;
  let names = [];
  while (Date.now() < deadline) {
    names = await page.evaluate(() => caches.keys());
    if (names.includes(name)) return names;
    await page.waitForTimeout(200);
  }
  throw new Error(`cache ${name} missing, saw ${names.join(",") || "(none)"}`);
}

async function proveUpdateWithoutReload(page, label, identity) {
  let reloaded = false;
  const onNav = (frame) => {
    if (frame === page.mainFrame()) reloaded = true;
  };
  page.on("framenavigated", onNav);
  const original = await readFile(DIST_SW, "utf8");
  await writeFile(DIST_SW, bumpCacheName(original));
  try {
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) throw new Error("no service worker registration");
      await reg.update();
    });
    await waitForCacheName(page, NEXT_CACHE);
    await page.waitForSelector('[data-testid="pwa-update"]', { timeout: 10_000 });
    const note = await page.innerText('[data-testid="pwa-update"]');
    if (!/will not reload while the fleet screen is open/i.test(note)) {
      throw new Error(`${label} update copy: ${note}`);
    }
    if (await page.locator('[data-testid="pwa-update-apply"]').count()) {
      throw new Error(`${label} offered reload while the fleet screen is open`);
    }
    const after = await page.evaluate(() => {
      const state = window.starhold?.getState?.() ?? {};
      return {
        hold: window.__pwaHold ?? null,
        playerId: state.playerId ?? null,
        name: state.name ?? null,
        fleet: Boolean(document.querySelector("[data-testid='fleet-form']")),
        resources: Boolean(document.querySelector("[data-testid='resources']")),
      };
    });
    if (reloaded || after.hold !== 1) throw new Error(`${label} reloaded during cache update`);
    if (after.playerId !== identity.playerId || after.name !== identity.name || !after.fleet || !after.resources) {
      throw new Error(`${label} save reset during cache update ${JSON.stringify(after)}`);
    }
  } finally {
    page.off("framenavigated", onNav);
    await writeFile(DIST_SW, original);
  }
}

async function main() {
  const manifestRes = await fetch(`${WEB}/manifest.webmanifest`);
  if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`);
  const manifestType = manifestRes.headers.get("content-type") ?? "";
  if (!manifestType.includes("application/manifest+json")) {
    throw new Error(`manifest content-type ${manifestType}`);
  }
  const manifest = await manifestRes.json();
  if (
    manifest.id !== "/" ||
    manifest.name !== "Starhold" ||
    manifest.display !== "standalone" ||
    manifest.start_url !== "/" ||
    manifest.scope !== "/" ||
    manifest.theme_color !== "#0f1a24" ||
    manifest.background_color !== "#0f1a24"
  ) {
    throw new Error(`manifest identity ${JSON.stringify(manifest)}`);
  }
  const iconMarks = new Set((manifest.icons ?? []).map((icon) => `${icon.sizes}:${icon.purpose}`));
  if (!iconMarks.has("192x192:any") || !iconMarks.has("512x512:any") || !iconMarks.has("512x512:maskable")) {
    throw new Error(`manifest icons ${JSON.stringify(manifest.icons)}`);
  }
  await expectAsset("/icons/icon-192.png", "image/png", 192);
  await expectAsset("/icons/icon-512.png", "image/png", 512);
  await expectAsset("/icons/icon-512-maskable.png", "image/png", 512);
  await expectAsset("/icons/apple-touch-icon.png", "image/png", 180);
  const sw = await fetch(`${WEB}/sw.js`);
  if (!sw.ok) throw new Error(`sw ${sw.status}`);
  const swType = sw.headers.get("content-type") ?? "";
  if (!swType.includes("javascript")) throw new Error(`sw content-type ${swType}`);
  const swText = await sw.text();
  if (swText.includes("location.reload") || !swText.includes('path.startsWith("/api/")')) {
    throw new Error("sw.js drifted from the offline allowlist");
  }

  const require = createRequire(import.meta.url);
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const pages = [
    { name: "iphone", width: 390, height: 844 },
    { name: "android", width: 412, height: 915 },
    { name: "desktop", width: 1280, height: 800 },
  ];
  try {
    for (const vp of pages) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        serviceWorkers: "allow",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (/favicon|fonts\.googleapis|fonts\.gstatic/i.test(text)) return;
        errors.push(text);
      });
      await page.goto(WEB, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="pwa-install"]', { timeout: 10_000 });
      const installText = await page.innerText('[data-testid="pwa-install"]');
      if (await page.locator('[data-testid="pwa-install-action"]').count()) {
        throw new Error(`${vp.name} showed Install without a browser prompt`);
      }
      if (!/home screen/i.test(installText)) {
        throw new Error(`${vp.name} install copy: ${installText}`);
      }
      const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
      if (manifestHref !== "/manifest.webmanifest") {
        throw new Error(`manifest link ${manifestHref}`);
      }
      await page.click('[data-testid="pwa-install-dismiss"]');
      if (await page.locator('[data-testid="pwa-install"]').count()) {
        throw new Error(`${vp.name} dismiss left the install note up`);
      }
      await page.reload({ waitUntil: "networkidle" });
      if (await page.locator('[data-testid="pwa-install"]').count()) {
        throw new Error(`${vp.name} install note returned after dismiss`);
      }

      const stamp = Date.now().toString(36);
      const email = `pwa${stamp}@example.com`;
      const password = "starhold-pwa";
      const name = `Pwa${stamp.slice(-4)}`;
      await page.fill('[data-testid="auth-email"]', email);
      await page.fill('[data-testid="auth-password"]', password);
      await page.click('[data-testid="auth-signup-btn"]');
      await page.waitForSelector('[data-testid="account-email"]', { timeout: 15_000 });
      await page.fill('[data-testid="commander-input"]', name);
      await page.click('[data-testid="join-btn"]');
      await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="resources"]', { timeout: 15_000 });
      const resumed = await page.evaluate(() => window.starhold?.getState()?.name ?? null);
      if (resumed !== name) throw new Error(`${vp.name} resume ${resumed}`);

      await page.click('[data-testid="nav-fleet"]');
      await page.waitForSelector('[data-testid="fleet-form"], [data-testid="page-fleet"]', {
        timeout: 10_000,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) throw new Error(`${vp.name} horizontal overflow ${overflow}px`);

      const posts = [];
      page.on("request", (req) => {
        if (req.method() === "POST") posts.push(new URL(req.url()).pathname);
      });
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.waitForSelector('[data-testid="pwa-offline"]', { timeout: 5_000 });
      const offlineText = await page.innerText('[data-testid="pwa-offline"]');
      if (!/not playable offline/i.test(offlineText) || !/not queued/i.test(offlineText)) {
        throw new Error(`${vp.name} offline copy: ${offlineText}`);
      }
      await page.waitForTimeout(400);
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForSelector('[data-testid="pwa-online"]', { timeout: 5_000 });
      const back = await page.innerText('[data-testid="pwa-online"]');
      if (!/Nothing was replayed/i.test(back)) throw new Error(`${vp.name} recovery: ${back}`);
      if (posts.some((pathname) => pathname.startsWith("/api/"))) {
        throw new Error(`${vp.name} replayed ${posts.join(",")}`);
      }

      const shell = await page.evaluate(async () => {
        const ready = navigator.serviceWorker.ready;
        const timeout = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("service worker ready timeout")), 8000);
        });
        const reg = await Promise.race([ready, timeout]);
        const names = await caches.keys();
        const urls = [];
        for (const name of names) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) urls.push(req.url);
        }
        const cache = await caches.open("starhold-shell-v1");
        const manifest = await cache.match("/manifest.webmanifest");
        const document = await cache.match("/index.html");
        const manifestText = manifest ? (await manifest.text()).slice(0, 80) : "";
        const documentText = document ? (await document.text()).slice(0, 80) : "";
        return {
          scope: reg.scope,
          script: reg.active?.scriptURL ?? null,
          urls,
          manifestText,
          documentText,
        };
      });
      if (!shell.script?.endsWith("/sw.js")) throw new Error(`${vp.name} worker ${shell.script}`);
      if (shell.urls.some((url) => url.includes("/api/"))) {
        throw new Error(`${vp.name} cached API ${shell.urls.filter((url) => url.includes("/api/")).join(",")}`);
      }
      const manifestKey = shell.urls.find((url) => url.includes("/manifest.webmanifest"));
      const documentKey = shell.urls.find((url) => url.endsWith("/index.html"));
      if (!manifestKey || !documentKey || manifestKey === documentKey) {
        throw new Error(`${vp.name} cache keys ${shell.urls.join(",")}`);
      }
      if (!shell.manifestText.startsWith("{") || shell.manifestText.includes("<html")) {
        throw new Error(`${vp.name} manifest cache body ${shell.manifestText}`);
      }
      if (!shell.documentText.includes("<") || shell.documentText === shell.manifestText) {
        throw new Error(`${vp.name} document cache body ${shell.documentText}`);
      }
      const origin = new URL(page.url()).origin;
      assertCachedAllowlist(shell.urls, origin, vp.name);

      const identity = await page.evaluate(() => {
        const state = window.starhold?.getState?.() ?? {};
        window.__pwaHold = 1;
        return {
          playerId: state.playerId ?? null,
          name: state.name ?? null,
          fleet: Boolean(document.querySelector("[data-testid='fleet-form']")),
        };
      });
      if (!identity.playerId || identity.name !== name || !identity.fleet) {
        throw new Error(`${vp.name} save missing before offline shell ${JSON.stringify(identity)}`);
      }

      await proveOfflineShell(context, origin, vp.name);
      const afterShell = await page.evaluate(() => {
        const state = window.starhold?.getState?.() ?? {};
        return {
          hold: window.__pwaHold ?? null,
          playerId: state.playerId ?? null,
          name: state.name ?? null,
          fleet: Boolean(document.querySelector("[data-testid='fleet-form']")),
        };
      });
      if (afterShell.hold !== 1 || afterShell.playerId !== identity.playerId || afterShell.name !== identity.name) {
        throw new Error(`${vp.name} save reset during offline shell ${JSON.stringify(afterShell)}`);
      }
      if (!afterShell.fleet) throw new Error(`${vp.name} fleet screen closed during offline shell`);

      await proveUpdateWithoutReload(page, vp.name, identity);
      console.log(`${vp.name}: manifest, worker, offline shell, cache update, save kept`);

      await page.screenshot({
        path: path.join(OUT, `${vp.name}.png`),
        fullPage: true,
      });
      if (errors.length) throw new Error(`${vp.name} console:\n${errors.join("\n")}`);
      await context.close();
    }

    const standalone = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await standalone.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { get: () => true });
    });
    await page.goto(WEB, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="auth-login-btn"], [data-testid="resources"]', {
      timeout: 15_000,
    });
    if (await page.locator('[data-testid="pwa-install"]').count()) {
      throw new Error("standalone iOS still showed install help");
    }
    await standalone.close();
  } finally {
    await browser.close();
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(
    path.join(OUT, "smoke-ok.txt"),
    `PWA smoke OK ${new Date().toISOString()}\nphysical devices: UNVERIFIED\nchecks: manifest identity, service worker, offline allowlist shell, cache update without reload, isolated cache keys, save kept\n`,
  );
  console.log("PWA smoke OK");
  console.log("physical devices: UNVERIFIED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
