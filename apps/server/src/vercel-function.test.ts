import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { staticCacheControl } from "./static-cache.js";
import {
  isIgnorableChange,
  vercelBuildDecision,
} from "../../../scripts/vercel-ignore-build.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("vercel functions pattern matches the committed api stub the build overwrites", () => {
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  const ignored = gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  assert.equal(ignored.includes("api/index.js"), false);

  const vercel = JSON.parse(
    fs.readFileSync(path.join(root, "vercel.json"), "utf8"),
  ) as {
    ignoreCommand?: string;
    crons?: unknown;
    images?: unknown;
    git?: { deploymentEnabled?: Record<string, boolean> | boolean };
    headers?: { source: string; headers: { key: string; value: string }[] }[];
    functions?: Record<string, { maxDuration?: number; memory?: number }>;
  };
  assert.deepEqual(Object.keys(vercel.functions ?? {}), ["api/index.js"]);
  assert.equal(vercel.functions?.["api/index.js"]?.maxDuration, 30);
  assert.equal(vercel.functions?.["api/index.js"]?.memory, undefined);
  assert.equal(vercel.crons, undefined);
  assert.equal(vercel.images, undefined);
  assert.equal(vercel.ignoreCommand, "node scripts/vercel-ignore-build.mjs");
  assert.equal(vercel.git?.deploymentEnabled && typeof vercel.git.deploymentEnabled === "object"
    ? vercel.git.deploymentEnabled.main
    : undefined, true);
  assert.equal(
    vercel.git?.deploymentEnabled && typeof vercel.git.deploymentEnabled === "object"
      ? vercel.git.deploymentEnabled["*"]
      : undefined,
    false,
  );
  const cacheHeader = (source: string) =>
    vercel.headers?.find((rule) => rule.source === source)?.headers.find(
      (header) => header.key === "Cache-Control",
    )?.value;
  assert.equal(cacheHeader("/api/(.*)"), "private, no-store");
  assert.equal(
    cacheHeader("/assets/:file.js"),
    staticCacheControl("/assets/index-abc123.js"),
  );
  assert.equal(
    cacheHeader("/assets/:dir/(.*)"),
    staticCacheControl("/assets/buildings/metal-mine.svg"),
  );
  assert.equal(
    cacheHeader("/planet-art/(.*)"),
    staticCacheControl("/planet-art/lush/planet-lush-01.webp"),
  );
  assert.equal(cacheHeader("/"), staticCacheControl("/"));
  assert.equal(cacheHeader("/fleet"), staticCacheControl("/fleet"));

  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.match(pkg.scripts?.["vercel-build"] ?? "", /bundle-api\.mjs/);
  assert.match(pkg.scripts?.["build:vercel"] ?? "", /bundle-api\.mjs/);

  const api = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  const isStub = api.includes("STARHOLD_API_STUB");
  const isBundle = api.includes("starhold api bundle");
  assert.equal(isStub || isBundle, true);
  if (isStub) {
    assert.match(api, /module\.exports\s*=/);
    assert.equal(api.includes("starhold api bundle"), false);
  } else {
    assert.equal(api.includes("STARHOLD_API_STUB"), false);
  }
});

test("ignore command builds only production main when the game changed", () => {
  assert.equal(isIgnorableChange("docs/vercel-deploy.md"), true);
  assert.equal(isIgnorableChange("README.md"), true);
  assert.equal(isIgnorableChange(".github/workflows/ci.yml"), true);
  assert.equal(isIgnorableChange("apps/web/src/ui/nav.test.ts"), true);
  assert.equal(isIgnorableChange("scripts/smoke-ui.mjs"), true);
  assert.equal(isIgnorableChange("scripts/bundle-api.mjs"), false);
  assert.equal(isIgnorableChange("apps/web/src/main.ts"), false);
  assert.equal(isIgnorableChange("vercel.json"), false);

  assert.equal(
    vercelBuildDecision({ vercelEnv: "preview", commitRef: "feature" }).skip,
    true,
  );
  assert.equal(
    vercelBuildDecision({ vercelEnv: "production", commitRef: "feature" }).skip,
    true,
  );
  assert.equal(
    vercelBuildDecision({
      vercelEnv: "production",
      commitRef: "main",
      changedFiles: [
        "docs/process.md",
        ".github/workflows/ci.yml",
        "scripts/smoke-ui.mjs",
        "packages/game/src/world.test.ts",
      ],
    }).skip,
    true,
  );
  assert.equal(
    vercelBuildDecision({
      vercelEnv: "production",
      commitRef: "main",
      changedFiles: ["docs/process.md", "scripts/bundle-api.mjs"],
    }).skip,
    false,
  );
  assert.equal(
    vercelBuildDecision({
      vercelEnv: "production",
      commitRef: "main",
      changedFiles: ["apps/web/src/main.ts"],
    }).skip,
    false,
  );
  assert.equal(
    vercelBuildDecision({
      vercelEnv: "production",
      commitRef: "main",
      diffFailed: true,
      changedFiles: null,
    }).skip,
    false,
  );
  assert.equal(
    vercelBuildDecision({
      vercelEnv: "production",
      commitRef: "main",
      changedFiles: [],
    }).skip,
    true,
  );

  const preview = spawnSync(
    process.execPath,
    [path.join(root, "scripts/vercel-ignore-build.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "cursor/some-pr",
      },
      encoding: "utf8",
    },
  );
  assert.equal(preview.status, 0);

  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.equal(/vercel\s+deploy/i.test(ci), false);
  assert.equal(ci.includes("VERCEL_TOKEN"), false);
  assert.equal(ci.includes("hooks.vercel.com"), false);

  const serverSrc = path.join(root, "apps/server/src");
  const sources = fs
    .readdirSync(serverSrc)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  for (const name of sources) {
    const text = fs.readFileSync(path.join(serverSrc, name), "utf8");
    assert.equal(text.includes("setInterval"), false, name);
    assert.equal(/node-cron|waitUntil\(/.test(text), false, name);
  }
});
