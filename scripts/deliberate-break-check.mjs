#!/usr/bin/env node
/**
 * Proves focused tests fail when critical functions are deliberately broken.
 * Mutations are applied only in a hardlink temp copy. The working tree is not edited.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHECKS = [
  {
    name: "resource production",
    cwd: "packages/game",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "productionPerHour keeps base metal",
      "src/critical-guards.test.ts",
    ],
    file: "packages/game/src/formulas-build.ts",
    apply(text) {
      const from = "export function productionPerHour(";
      if (!text.includes(from)) throw new Error(`missing ${from}`);
      return text.replace(
        from,
        "export function productionPerHour(){return{metal:0,crystal:0,deuterium:0}}\nfunction productionPerHourBroken(",
      );
    },
  },
  {
    name: "combat damage",
    cwd: "packages/game",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "resolveCombat damages a smaller interceptor",
      "src/critical-guards.test.ts",
    ],
    file: "packages/game/src/formulas-combat.ts",
    apply(text) {
      const from = "export function resolveCombat(";
      if (!text.includes(from)) throw new Error(`missing ${from}`);
      return text.replace(
        from,
        "export function resolveCombat(){throw new Error(\"deliberate-break combat\")}\nfunction resolveCombatBroken(",
      );
    },
  },
  {
    name: "save normalize",
    cwd: "packages/game",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "loads a pre-row-save universe",
      "src/cross-version-save.test.ts",
    ],
    file: "packages/game/src/world-migrate.ts",
    apply(text) {
      const from = "export function migrateOrResetUniverse(";
      if (!text.includes(from)) throw new Error(`missing ${from}`);
      return text.replace(
        from,
        "export function migrateOrResetUniverse(){return{universe:null,didReset:true,archived:null}}\nfunction migrateOrResetUniverseBroken(",
      );
    },
  },
  {
    name: "auth password check",
    cwd: "apps/server",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "hashes and verifies passwords with scrypt",
      "src/accounts.test.ts",
    ],
    file: "apps/server/src/accounts.ts",
    apply(text) {
      const from = "export async function verifyPassword(";
      if (!text.includes(from)) throw new Error(`missing ${from}`);
      return text.replace(
        from,
        "export async function verifyPassword(){return true}\nasync function verifyPasswordBroken(",
      );
    },
  },
  {
    name: "queue guard",
    cwd: "packages/game",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "blocks construction on an occupied non-mini",
      "src/critical-guards.test.ts",
    ],
    file: "packages/game/src/world-queues.ts",
    apply(text) {
      const pattern =
        /return !\(isMiniPlanet\(planet\) && planet\.ownerPlayerId === playerId\);/g;
      const matches = text.match(pattern);
      if (!matches || matches.length !== 1) {
        throw new Error(`expected 1 occupation guard helper, found ${matches?.length ?? 0}`);
      }
      return text.replace(pattern, "return false;");
    },
  },
];

function copyRepo() {
  // /tmp is often a bind mount, and hardlinks cannot cross that boundary.
  const dir = mkdtempSync(path.join(path.dirname(repo), "starhold-break-"));
  const copied = spawnSync("cp", ["-al", `${repo}/.`, dir], { encoding: "utf8" });
  if (copied.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    const detail = (copied.stderr || "failed to hardlink-copy the repo").split("\n").slice(0, 8).join("\n");
    throw new Error(detail);
  }
  return dir;
}

/** Replace a hardlink with a private file so edits cannot touch the working tree. */
function detach(dir, rel) {
  const dest = path.join(dir, rel);
  const text = readFileSync(path.join(repo, rel), "utf8");
  unlinkSync(dest);
  writeFileSync(dest, text);
  return dest;
}

function runTests(dir, check) {
  return spawnSync(process.execPath, check.args, {
    cwd: path.join(dir, check.cwd),
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
}

function testCount(output) {
  const match = output.match(/tests (\d+)/);
  return match ? Number(match[1]) : 0;
}

function tail(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-30).join("\n");
}

const temp = copyRepo();
let failed = false;
try {
  for (const check of CHECKS) {
    const clean = runTests(temp, check);
    const cleanOut = `${clean.stdout ?? ""}\n${clean.stderr ?? ""}`;
    if (clean.status !== 0 || testCount(cleanOut) < 1) {
      console.error(`deliberate-break: clean ${check.name} did not pass\n${tail(clean)}`);
      failed = true;
      continue;
    }
    const dest = detach(temp, check.file);
    writeFileSync(dest, check.apply(readFileSync(dest, "utf8")));
    const broken = runTests(temp, check);
    const brokenOut = `${broken.stdout ?? ""}\n${broken.stderr ?? ""}`;
    writeFileSync(dest, readFileSync(path.join(repo, check.file), "utf8"));
    if (broken.status === 0 && testCount(brokenOut) > 0) {
      console.error(`deliberate-break: mutation survived: ${check.name}\n${tail(broken)}`);
      failed = true;
    } else {
      console.log(`deliberate-break: caught ${check.name} (exit ${broken.status})`);
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failed) {
  console.error("deliberate-break: FAIL");
  process.exit(1);
}
console.log("deliberate-break: all 5 mutations failed the suite");
