import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  installKind,
  isIosInstall,
  isStandalone,
  mayApplyAppUpdate,
  renderPwaChrome,
  shouldRegisterServiceWorker,
} from "./pwa-policy.js";
import {
  CACHE_NAME,
  CACHE_PREFIX,
  classifyRequest,
  documentCacheUrl,
  networkFirst,
  networkFirstCacheUrl,
  obsoleteCacheNames,
} from "../public/sw.js";

const ORIGIN = "https://starhold.example";

describe("install help", () => {
  it("hides when the app is already standalone, including the iOS flag", () => {
    assert.equal(isStandalone(true, false), true);
    assert.equal(isStandalone(false, true), true);
    assert.equal(isStandalone(false, false), false);
    assert.equal(
      installKind({ standalone: true, dismissed: false, ios: true, hasPrompt: true }),
      "hidden",
    );
  });

  it("stays dismissed and does not show an install button without a prompt", () => {
    assert.equal(
      installKind({ standalone: false, dismissed: true, ios: false, hasPrompt: true }),
      "hidden",
    );
    const manual = renderPwaChrome({
      kind: "manual",
      offline: "online",
      updateReady: false,
      fleetFormOpen: false,
    });
    assert.match(manual, /did not offer an install prompt/);
    assert.equal(manual.includes('data-pwa="install"'), false);
    assert.match(manual, /data-testid="pwa-install-dismiss"/);
  });

  it("explains Share → Add to Home Screen on iPhone and only then offers Android install", () => {
    assert.equal(isIosInstall("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari/605"), true);
    assert.equal(isIosInstall("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit Safari/605"), true);
    assert.equal(isIosInstall("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605", 5), true);
    assert.equal(isIosInstall("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605", 0), false);
    assert.equal(isIosInstall("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120"), false);
    const ios = renderPwaChrome({
      kind: installKind({ standalone: false, dismissed: false, ios: true, hasPrompt: true }),
      offline: "online",
      updateReady: false,
      fleetFormOpen: false,
    });
    assert.match(ios, /Share menu, then tap Add to Home Screen/);
    assert.equal(ios.includes('data-pwa="install"'), false);
    const android = renderPwaChrome({
      kind: "android",
      offline: "online",
      updateReady: false,
      fleetFormOpen: false,
    });
    assert.match(android, /data-testid="pwa-install-action"/);
    assert.match(android, /needs a connection to play/);
  });
});

describe("offline and updates", () => {
  it("says the game is not playable offline and does not reload over a fleet order", () => {
    const offline = renderPwaChrome({
      kind: "hidden",
      offline: "offline",
      updateReady: true,
      fleetFormOpen: true,
    });
    assert.match(offline, /not playable offline/);
    assert.match(offline, /not queued/);
    assert.match(offline, /will not reload while the fleet screen is open/);
    assert.equal(offline.includes('data-testid="pwa-update-apply"'), false);
    assert.equal(mayApplyAppUpdate(true), false);
    const ready = renderPwaChrome({
      kind: "hidden",
      offline: "recovered",
      updateReady: true,
      fleetFormOpen: false,
    });
    assert.match(ready, /Nothing was replayed/);
    assert.match(ready, /data-testid="pwa-update-apply"/);
    assert.equal(mayApplyAppUpdate(false), true);
  });

  it("registers a worker only for the production hashed bundle", () => {
    assert.equal(shouldRegisterServiceWorker("/assets/index-abc.js"), true);
    assert.equal(shouldRegisterServiceWorker("/src/main.ts"), false);
    assert.equal(shouldRegisterServiceWorker("/assets/ships/scout.svg"), false);
  });
});

describe("service worker allowlist", () => {
  it("never caches API, auth, or private query documents", () => {
    assert.equal(classifyRequest(`${ORIGIN}/api/state?playerId=secret`, ORIGIN), "bypass");
    assert.equal(classifyRequest(`${ORIGIN}/api/auth/login`, ORIGIN), "bypass");
    assert.equal(classifyRequest(`${ORIGIN}/api/auth/me`, ORIGIN), "bypass");
    assert.equal(classifyRequest("https://fonts.googleapis.com/css2?family=x", ORIGIN), "bypass");
    assert.equal(classifyRequest(`${ORIGIN}/planet-art/lush/planet-lush-01.webp`, ORIGIN), "bypass");
    assert.equal(classifyRequest(`${ORIGIN}/`, ORIGIN), "network-first");
    assert.equal(classifyRequest(`${ORIGIN}/manifest.webmanifest`, ORIGIN), "network-first");
    assert.equal(classifyRequest(`${ORIGIN}/icons/icon-192.png`, ORIGIN), "cache-first");
    assert.equal(classifyRequest(`${ORIGIN}/assets/index-abc123.js`, ORIGIN), "cache-first");
    assert.equal(classifyRequest(`${ORIGIN}/assets/index-abc123.css`, ORIGIN), "cache-first");
    assert.equal(classifyRequest(`${ORIGIN}/assets/ships/scout.svg`, ORIGIN), "bypass");
    assert.equal(documentCacheUrl(ORIGIN), `${ORIGIN}/index.html`);
    assert.equal(CACHE_NAME.startsWith(CACHE_PREFIX), true);
    assert.deepEqual(obsoleteCacheNames(["starhold-shell-v0", CACHE_NAME, "other-app"]), [
      "starhold-shell-v0",
    ]);
    const source = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
    assert.equal(source.includes("location.reload"), false);
    assert.equal(source.includes("clients.claim"), false);
    assert.match(source, /\/api\//);
  });

  it("isolates manifest responses from cached HTML and skips cookie-setting responses", async () => {
    const entries = new Map();
    const cacheKey = (request) =>
      new URL(request instanceof Request ? request.url : String(request), ORIGIN).href;
    const cache = {
      match: async (request) => entries.get(cacheKey(request))?.clone(),
      put: async (request, response) => entries.set(cacheKey(request), response.clone()),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      delete: async (request) => entries.delete(cacheKey(request)),
    };
    const htmlKey = documentCacheUrl(ORIGIN);
    const html = new Response("cached HTML", { headers: { "Content-Type": "text/html" } });
    const manifestUrl = `${ORIGIN}/manifest.webmanifest?version=2`;
    const manifestKey = `${ORIGIN}/manifest.webmanifest`;
    entries.set(htmlKey, html);

    const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { open: async () => cache },
    });
    try {
      globalThis.fetch = async () => {
        const response = new Response("manifest response with cookie", {
          headers: { "Set-Cookie": "test-cookie=redacted" },
        });
        Object.defineProperty(response, "type", { value: "basic" });
        return response;
      };
      assert.equal(networkFirstCacheUrl(manifestUrl, ORIGIN), manifestKey);
      assert.equal(networkFirstCacheUrl(`${ORIGIN}/?playerId=private`, ORIGIN), htmlKey);
      await networkFirst(new Request(manifestUrl), ORIGIN);
      assert.equal(await (await cache.match(htmlKey)).text(), "cached HTML");
      assert.equal(await cache.match(manifestKey), undefined);

      globalThis.fetch = async () => {
        const response = new Response("fresh manifest");
        Object.defineProperty(response, "type", { value: "basic" });
        return response;
      };
      await networkFirst(new Request(manifestUrl), ORIGIN);
      assert.equal(await (await cache.match(htmlKey)).text(), "cached HTML");
      assert.equal(await (await cache.match(manifestKey)).text(), "fresh manifest");

      await cache.delete(manifestKey);
      globalThis.fetch = async () => {
        throw new Error("offline");
      };
      const offlineManifest = await networkFirst(new Request(manifestUrl), ORIGIN);
      assert.equal(offlineManifest.status, 503);
      assert.equal(
        await offlineManifest.text(),
        "Offline. Starhold needs a connection and does not play from this device.",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
      else Reflect.deleteProperty(globalThis, "caches");
    }
  });

  it("ships a linked manifest with 192 and 512 icons", () => {
    const manifestPath = fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      id: string;
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      background_color: string;
      theme_color: string;
      icons: { src: string; sizes: string; purpose: string; type: string }[];
    };
    assert.equal(manifest.id, "/");
    assert.equal(manifest.name, "Starhold");
    assert.equal(manifest.short_name, "Starhold");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.display, "standalone");
    assert.match(manifest.background_color, /^#[0-9a-fA-F]{6}$/);
    assert.match(manifest.theme_color, /^#[0-9a-fA-F]{6}$/);
    const any192 = manifest.icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
    const any512 = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
    const maskable = manifest.icons.find((icon) => icon.purpose === "maskable");
    assert.equal(any192?.src, "/icons/icon-192.png");
    assert.equal(any512?.src, "/icons/icon-512.png");
    assert.equal(maskable?.sizes, "512x512");
    assert.equal(maskable?.src, "/icons/icon-512-maskable.png");
    for (const icon of manifest.icons) {
      assert.equal(icon.type, "image/png");
      const bytes = readFileSync(fileURLToPath(new URL(`../public${icon.src}`, import.meta.url)));
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split("x")[0]));
      assert.equal(bytes.readUInt32BE(20), Number(icon.sizes.split("x")[1]));
    }
    const apple = readFileSync(
      fileURLToPath(new URL("../public/icons/apple-touch-icon.png", import.meta.url)),
    );
    assert.equal(apple.readUInt32BE(16), 180);
    assert.equal(apple.readUInt32BE(20), 180);
  });
});
