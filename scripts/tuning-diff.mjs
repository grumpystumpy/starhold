#!/usr/bin/env node
/**
 * Diff packages/game/src/data/tuning.ts balance values vs a base ref (default: origin/main).
 * Prints markdown suitable for a PR comment.
 *
 * Usage:
 *   node scripts/tuning-diff.mjs
 *   node scripts/tuning-diff.mjs --base origin/main --head HEAD
 *   BASE_REF=origin/main HEAD_REF=HEAD node scripts/tuning-diff.mjs
 *
 * Env:
 *   TUNING_DIFF_OUT — write markdown to this path as well as stdout
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const TUNING_PATH = "packages/game/src/data/tuning.ts";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const BASE_REF = arg("--base", process.env.BASE_REF ?? "origin/main");
const HEAD_REF = arg("--head", process.env.HEAD_REF ?? "HEAD");

function gitShow(ref, filePath) {
  try {
    return execFileSync("git", ["show", `${ref}:${filePath}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function bundleToTemp(source, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `starhold-tuning-${label}-`));
  const srcFile = path.join(dir, "tuning.ts");
  const outFile = path.join(dir, "tuning.mjs");
  // Stub types so esbuild can resolve the type-only import.
  writeFileSync(
    path.join(dir, "types.js"),
    "export {};\n",
    "utf8",
  );
  const rewritten = source.replace(
    /from\s+["']\.\.\/types\.js["']/,
    'from "./types.js"',
  );
  writeFileSync(srcFile, rewritten, "utf8");
  const require = createRequire(import.meta.url);
  let esbuild;
  try {
    esbuild = require("esbuild");
  } catch {
    throw new Error("esbuild required (devDependency of starhold root)");
  }
  const result = esbuild.buildSync({
    entryPoints: [srcFile],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: true,
    logLevel: "silent",
  });
  if (result.errors?.length) {
    throw new Error(`esbuild failed for ${label}: ${JSON.stringify(result.errors)}`);
  }
  return { dir, outFile };
}

function flatten(value, prefix, out) {
  if (value == null || typeof value === "function") return;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    out[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    out[prefix] = JSON.stringify(value);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flatten(v, next, out);
    }
  }
}

async function snapshotFromSource(source, label) {
  if (source == null) return null;
  const { dir, outFile } = bundleToTemp(source, label);
  try {
    const mod = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`);
    const out = {};
    for (const [key, val] of Object.entries(mod)) {
      if (key === "default") continue;
      flatten(val, key, out);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function formatVal(v) {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

function buildMarkdown(baseSnap, headSnap, baseRef, headRef) {
  const lines = [];
  lines.push("<!-- starhold-tuning-diff -->");
  lines.push(`## Tuning diff vs \`${baseRef}\``);
  lines.push("");
  lines.push(`Head \`${headRef}\` vs base \`${baseRef}\` · \`${TUNING_PATH}\`.`);
  lines.push("");

  if (!baseSnap && !headSnap) {
    lines.push("_File missing on both sides._");
    return lines.join("\n");
  }
  if (!baseSnap) {
    lines.push("_Base has no tuning.ts — treating as all-new on head._");
    lines.push("");
  }
  if (!headSnap) {
    lines.push("_Head deleted tuning.ts._");
    return lines.join("\n");
  }

  const base = baseSnap ?? {};
  const head = headSnap;
  const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
  const added = [];
  const removed = [];
  const changed = [];

  for (const k of [...keys].sort()) {
    const a = base[k];
    const b = head[k];
    if (a === undefined && b !== undefined) added.push([k, b]);
    else if (a !== undefined && b === undefined) removed.push([k, a]);
    else if (String(a) !== String(b)) changed.push([k, a, b]);
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    lines.push("**No tuning value changes** vs base.");
    return lines.join("\n");
  }

  lines.push(
    `| | count |\n|---|---:|\n| changed | ${changed.length} |\n| added | ${added.length} |\n| removed | ${removed.length} |`,
  );
  lines.push("");

  const MAX = 80;
  if (changed.length) {
    lines.push("### Changed");
    lines.push("");
    lines.push("| key | base | head |");
    lines.push("|-----|------|------|");
    for (const [k, a, b] of changed.slice(0, MAX)) {
      lines.push(`| \`${k}\` | ${formatVal(a)} | ${formatVal(b)} |`);
    }
    if (changed.length > MAX) {
      lines.push(`| … | _${changed.length - MAX} more_ | |`);
    }
    lines.push("");
  }
  if (added.length) {
    lines.push("### Added");
    lines.push("");
    lines.push("| key | head |");
    lines.push("|-----|------|");
    for (const [k, b] of added.slice(0, MAX)) {
      lines.push(`| \`${k}\` | ${formatVal(b)} |`);
    }
    if (added.length > MAX) {
      lines.push(`| … | _${added.length - MAX} more_ |`);
    }
    lines.push("");
  }
  if (removed.length) {
    lines.push("### Removed");
    lines.push("");
    lines.push("| key | base |");
    lines.push("|-----|------|");
    for (const [k, a] of removed.slice(0, MAX)) {
      lines.push(`| \`${k}\` | ${formatVal(a)} |`);
    }
    if (removed.length > MAX) {
      lines.push(`| … | _${removed.length - MAX} more_ |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  // Ensure base ref exists locally when possible.
  if (BASE_REF.startsWith("origin/")) {
    const branch = BASE_REF.replace(/^origin\//, "");
    spawnSync(
      "git",
      ["fetch", "--no-tags", "--depth=1", "origin", `${branch}:refs/remotes/origin/${branch}`],
      {
        cwd: ROOT,
        stdio: "ignore",
      },
    );
  }

  let headSource;
  if (HEAD_REF === "HEAD" || HEAD_REF === "WORKTREE") {
    headSource = readFileSync(path.join(ROOT, TUNING_PATH), "utf8");
  } else {
    headSource = gitShow(HEAD_REF, TUNING_PATH);
  }
  const baseSource = gitShow(BASE_REF, TUNING_PATH);

  const [baseSnap, headSnap] = await Promise.all([
    snapshotFromSource(baseSource, "base"),
    snapshotFromSource(headSource, "head"),
  ]);

  const md = buildMarkdown(baseSnap, headSnap, BASE_REF, HEAD_REF);
  process.stdout.write(md + "\n");
  if (process.env.TUNING_DIFF_OUT) {
    writeFileSync(process.env.TUNING_DIFF_OUT, md + "\n", "utf8");
  }

  const changed =
    md.includes("### Changed") ||
    md.includes("### Added") ||
    md.includes("### Removed");
  process.exitCode = 0;
  if (process.env.TUNING_DIFF_FAIL_ON_CHANGE === "1" && changed) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("tuning-diff failed:", err);
  process.exit(1);
});
