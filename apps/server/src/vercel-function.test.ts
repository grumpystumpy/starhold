import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  ) as { functions?: Record<string, { maxDuration?: number; memory?: number }> };
  assert.deepEqual(Object.keys(vercel.functions ?? {}), ["api/index.js"]);
  assert.equal(vercel.functions?.["api/index.js"]?.maxDuration, 30);
  assert.equal(vercel.functions?.["api/index.js"]?.memory, 1024);

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
