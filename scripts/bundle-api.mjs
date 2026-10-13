#!/usr/bin/env node
/**
 * Bundle Hono API + game into Vercel catch-all: api/[[...route]].js
 * Matches /api, /api/health, /api/join, … without path-stripping rewrites.
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "api");
const outFile = path.join(outDir, "[[...route]].js");
const gameEntry = path.join(root, "packages/game/src/index.ts");

fs.mkdirSync(outDir, { recursive: true });
// Remove legacy single-file entry so Vercel does not dual-route.
for (const stale of ["index.js", "index.ts", "index.mjs"]) {
  const p = path.join(outDir, stale);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "apps/server/src/vercel-entry.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
  alias: {
    "@starhold/game": gameEntry,
  },
  banner: {
    js: "/* starhold api bundle — scripts/bundle-api.mjs */\n",
  },
  footer: {
    js: "\nmodule.exports = module.exports.default;\n",
  },
});

console.log("Bundled", path.relative(root, outFile));
