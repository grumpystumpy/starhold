#!/usr/bin/env node
/**
 * Bundle Hono API + game into Vercel serverless: api/index.js
 *
 * Overwrites the committed api/index.js stub. Vercel matches
 * vercel.json `functions` against that committed file before the build.
 * @vercel/node does not run `buildCommand` for api/ files; it runs the
 * root `vercel-build` script (this file) after download and before tracing.
 *
 * Nested paths like /api/auth/me need a rewrite to /api (see vercel.json).
 * The optional catch-all api/[[...route]].js only matched one segment on
 * this Hobby project ( /api/health ok, /api/auth/me → platform NOT_FOUND ).
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "api");
const outFile = path.join(outDir, "index.js");
const gameEntry = path.join(root, "packages/game/src/index.ts");

fs.mkdirSync(outDir, { recursive: true });
// Remove catch-all / legacy names so Vercel does not dual-route.
for (const stale of ["[[...route]].js", "index.ts", "index.mjs"]) {
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

const bundled = fs.readFileSync(outFile, "utf8");
if (!bundled.includes("starhold api bundle")) {
  console.error("api/index.js is missing the bundle banner");
  process.exit(1);
}
if (bundled.includes("STARHOLD_API_STUB")) {
  console.error("api/index.js still contains the committed stub marker");
  process.exit(1);
}

console.log("Bundled", path.relative(root, outFile));
