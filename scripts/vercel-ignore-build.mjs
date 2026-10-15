#!/usr/bin/env node
/**
 * Vercel Ignored Build Step.
 * Exit 0 → skip the deployment. Exit 1 → build.
 * (Vercel inverts the usual shell convention.)
 *
 * Builds only production deploys of `main`, and skips those when every
 * changed file is docs, tests, CI, or scripts (except the API bundler).
 * If the diff cannot be read, fail open and build so a real game commit
 * is never dropped.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @param {string} file */
export function isIgnorableChange(file) {
  const path = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.startsWith("docs/")) return true;
  if (path.startsWith(".github/")) return true;
  if (path.startsWith(".cursor/")) return true;
  if (path.endsWith(".md")) return true;
  if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(path)) return true;
  if (path.startsWith("scripts/") && path !== "scripts/bundle-api.mjs") {
    return true;
  }
  return false;
}

/**
 * @param {{
 *   vercelEnv?: string,
 *   commitRef?: string,
 *   diffFailed?: boolean,
 *   changedFiles?: string[] | null,
 * }} input
 * @returns {{ skip: boolean, reason: string }}
 */
export function vercelBuildDecision(input) {
  const vercelEnv = input.vercelEnv ?? "";
  const ref = input.commitRef ?? "";
  if (!vercelEnv && !ref) {
    return { skip: false, reason: "not a Vercel build; fail open" };
  }
  if (vercelEnv && vercelEnv !== "production") {
    return { skip: true, reason: `non-production env ${vercelEnv}` };
  }
  if (ref && ref !== "main") {
    return { skip: true, reason: `branch ${ref} is not main` };
  }
  if (input.diffFailed || input.changedFiles == null) {
    return { skip: false, reason: "could not read git diff; building" };
  }
  if (input.changedFiles.length === 0) {
    return {
      skip: true,
      reason: "no file changes since the previous production deployment",
    };
  }
  const ship = input.changedFiles.filter((file) => !isIgnorableChange(file));
  if (ship.length === 0) {
    return {
      skip: true,
      reason: "only docs, tests, CI, or scripts changed",
    };
  }
  return { skip: false, reason: `ship ${ship.slice(0, 12).join(", ")}` };
}

/**
 * @param {string | undefined} previousSha
 * @param {string} headSha
 * @returns {{ diffFailed: boolean, changedFiles: string[] | null }}
 */
export function changedFilesSince(previousSha, headSha) {
  if (!previousSha) {
    return { diffFailed: true, changedFiles: null };
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${previousSha}^{commit}`], {
      stdio: "ignore",
    });
    const out = execFileSync(
      "git",
      ["diff", "--name-only", previousSha, headSha],
      { encoding: "utf8" },
    );
    const changedFiles = out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { diffFailed: false, changedFiles };
  } catch {
    return { diffFailed: true, changedFiles: null };
  }
}

function runCli() {
  const env = process.env;
  const diff = changedFilesSince(
    env.VERCEL_GIT_PREVIOUS_SHA?.trim(),
    env.VERCEL_GIT_COMMIT_SHA?.trim() || "HEAD",
  );
  const decision = vercelBuildDecision({
    vercelEnv: env.VERCEL_ENV?.trim(),
    commitRef: env.VERCEL_GIT_COMMIT_REF?.trim(),
    diffFailed: diff.diffFailed,
    changedFiles: diff.changedFiles,
  });
  console.log(
    decision.skip
      ? `vercel-ignore: skip (${decision.reason})`
      : `vercel-ignore: build (${decision.reason})`,
  );
  process.exit(decision.skip ? 0 : 1);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runCli();
}
