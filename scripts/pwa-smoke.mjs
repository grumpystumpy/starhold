#!/usr/bin/env node
/**
 * Production-build check for the installable shell.
 * Requires the API+static server on STARHOLD_WEB (default http://127.0.0.1:3001).
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.STARHOLD_WEB ?? "http://127.0.0.1:3001";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs/pwa",
);

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

async function main() {
  const manifestRes = await fetch(`${WEB}/manifest.webmanifest`);
  if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`);
  const manifestType = manifestRes.headers.get("content-type") ?? "";
  if (!manifestType.includes("application/manifest+json")) {
    throw new Error(`manifest content-type ${manifestType}`);
  }
  const manifest = await manifestRes.json();
  if (manifest.display !== "standalone" || manifest.start_url !== "/" || manifest.scope !== "/") {
    throw new Error(`manifest identity ${JSON.stringify(manifest)}`);
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
        return {
          scope: reg.scope,
          script: reg.active?.scriptURL ?? null,
          urls,
        };
      });
      if (!shell.script?.endsWith("/sw.js")) throw new Error(`${vp.name} worker ${shell.script}`);
      if (shell.urls.some((url) => url.includes("/api/"))) {
        throw new Error(`${vp.name} cached API ${shell.urls.filter((url) => url.includes("/api/")).join(",")}`);
      }

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
    `PWA smoke OK ${new Date().toISOString()}\nphysical devices: UNVERIFIED\n`,
  );
  console.log("PWA smoke OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
