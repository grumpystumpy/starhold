import test from "node:test";
import assert from "node:assert/strict";
import { findPublicSourcemapIssues } from "./check-no-public-sourcemaps.mjs";

test("accepts shipped JavaScript without public source maps", () => {
  assert.deepEqual(
    findPublicSourcemapIssues([
      { path: "assets/app.js", content: "console.log('ready');" },
      { path: "assets/app.css", content: "body { color: white; }" },
    ]),
    [],
  );
});

test("reports public map files and sourceMappingURL comments", () => {
  assert.deepEqual(
    findPublicSourcemapIssues([
      { path: "assets/app.js", content: "console.log('ready');\n//# sourceMappingURL=app.js.map" },
      { path: "assets/app.js.map", content: "{}" },
    ]),
    [
      "assets/app.js contains a sourceMappingURL comment",
      "assets/app.js.map is a public source map",
    ],
  );
});
