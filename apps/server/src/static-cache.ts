/**
 * Cache policy for the Vite build. Hashed JS/CSS can stay immutable.
 * Planet art and SVG plates are not content-hashed, so they get a long
 * but finite cache. HTML and client routes must revalidate so a new
 * deploy is picked up. API responses are never cached (tick-on-read).
 */
export function staticCacheControl(pathname: string): string | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.startsWith("/api")) return "private, no-store";
  if (/^\/assets\/[^/]+\.(js|css)$/.test(path)) {
    return "public, max-age=31536000, immutable";
  }
  if (
    path.startsWith("/planet-art/") ||
    path.startsWith("/assets/") ||
    /\.(webp|svg|png|jpe?g|gif|ico|woff2)$/i.test(path)
  ) {
    return "public, max-age=2592000";
  }
  if (path === "/" || path.endsWith(".html") || !path.includes(".")) {
    return "public, max-age=0, must-revalidate";
  }
  return null;
}

/** Apply the static cache policy without dropping a body or status. */
export function withStaticCache(response: Response, pathname: string): Response {
  const value = staticCacheControl(pathname);
  if (!value) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
