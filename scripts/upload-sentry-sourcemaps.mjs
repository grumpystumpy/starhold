/**
 * Upload Worker source maps when Sentry auth is configured.
 * Exits 0 when SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT is missing.
 * The web client uploads its own maps from the Vite plugin during the web build.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.SENTRY_AUTH_TOKEN?.trim();
const org = process.env.SENTRY_ORG?.trim();
const project = process.env.SENTRY_PROJECT?.trim();

if (!token || !org || !project) {
  console.log(
    "sentry: SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT unset; skipping source map upload",
  );
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(path.join(tmpdir(), "starhold-worker-"));
const dry = spawnSync(
  "npx",
  ["wrangler", "deploy", "--dry-run", "--outdir", out],
  { stdio: "inherit", cwd: root },
);
if (dry.status !== 0) {
  console.error("sentry: wrangler dry-run failed; Worker source maps were not uploaded");
  process.exit(dry.status ?? 1);
}

const upload = spawnSync(
  "npx",
  [
    "sentry-cli",
    "sourcemaps",
    "upload",
    "--org",
    org,
    "--project",
    project,
    out,
  ],
  { stdio: "inherit", cwd: root, env: process.env },
);
process.exit(upload.status ?? 1);
