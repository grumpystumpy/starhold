/**
 * Public shell only. Never caches /api, cookies, or player state.
 * Does not reload the page. A newer worker waits until the next visit
 * unless the page itself reloads after the fleet screen is closed.
 */
export const CACHE_NAME = "starhold-shell-v1";
export const CACHE_PREFIX = "starhold-shell-";
export const MAX_CACHE_ENTRIES = 24;

const PRECACHE = [
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

/** @returns {"bypass" | "network-first" | "cache-first"} */
export function classifyRequest(rawUrl, origin) {
  let url;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return "bypass";
  }
  if (url.origin !== origin) return "bypass";
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return "bypass";
  if (path === "/" || path === "/index.html" || path === "/manifest.webmanifest") {
    return "network-first";
  }
  if (path.startsWith("/icons/") && path.endsWith(".png")) return "cache-first";
  if (/^\/assets\/[^/]+\.(js|css)$/.test(path)) return "cache-first";
  return "bypass";
}

/** One cache key for the document so query strings (player ids) are never stored. */
export function documentCacheUrl(origin) {
  return `${origin}/index.html`;
}

export function obsoleteCacheNames(names, current = CACHE_NAME) {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  let overflow = keys.length - MAX_CACHE_ENTRIES;
  for (const req of keys) {
    if (overflow <= 0) break;
    const path = new URL(req.url).pathname;
    if (path === "/index.html" || path === "/manifest.webmanifest") continue;
    if (path.startsWith("/icons/")) continue;
    await cache.delete(req);
    overflow -= 1;
  }
}

async function store(cache, key, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  if (response.headers.get("set-cookie")) return;
  await cache.put(key, response.clone());
  await trimCache(cache);
}

async function networkFirst(request, origin) {
  const cache = await caches.open(CACHE_NAME);
  const key = documentCacheUrl(origin);
  try {
    const response = await fetch(request);
    await store(cache, key, response);
    return response;
  } catch {
    const cached = (await cache.match(key)) ?? (await cache.match("/index.html"));
    if (cached) return cached;
    return new Response(
      "Offline. Starhold needs a connection and does not play from this device.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await store(cache, request, response);
  return response;
}

const workerGlobal = globalThis;
const inWorker =
  typeof workerGlobal.ServiceWorkerGlobalScope === "function" &&
  workerGlobal instanceof workerGlobal.ServiceWorkerGlobalScope;

if (inWorker) {
  const worker = workerGlobal;
  worker.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(PRECACHE))
        .then(() => worker.skipWaiting()),
    );
  });

  worker.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(obsoleteCacheNames(names).map((name) => caches.delete(name))),
      ),
    );
  });

  worker.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const kind = classifyRequest(request.url, worker.location.origin);
    if (kind === "bypass") return;
    if (kind === "network-first") {
      event.respondWith(networkFirst(request, worker.location.origin));
      return;
    }
    event.respondWith(cacheFirst(request));
  });
}
