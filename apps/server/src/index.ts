import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { storageMode } from "./store.js";

const app = createApp();

// Optional: serve Vite production build from the same port (local / non-Vercel hosts).
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 3001);
console.log(`Starhold API listening on http://localhost:${port}`);
console.log(`Storage: ${storageMode()}`);
serve({ fetch: app.fetch, port });
