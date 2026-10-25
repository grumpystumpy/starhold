import test from "node:test";
import assert from "node:assert/strict";
import { findLintIssues, FORBIDDEN_PATTERNS } from "./lint-check.mjs";

test("accepts clean source files without forbidden patterns", () => {
  const files = [
    { path: "packages/game/src/world.ts", content: "export function hello() { return 'world'; }" },
    { path: "apps/server/src/index.ts", content: "const x = 42;" },
  ];
  assert.deepEqual(findLintIssues(files), []);
});

test("reports forbidden pattern violations", () => {
  for (const pattern of FORBIDDEN_PATTERNS) {
    const files = [
      { path: "packages/game/src/test.ts", content: `// line 1\nconst x = 1; ${pattern}` },
    ];
    const issues = findLintIssues(files);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes(`Found forbidden pattern '${pattern}'`), `Expected issue for pattern ${pattern}`);
  }
});
