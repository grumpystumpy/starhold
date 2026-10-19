import test from "node:test";
import assert from "node:assert/strict";
import { sentryInjectArgs, sentryUploadArgs } from "./sentry-cli-args.mjs";

test("builds the Sentry source map debug ID injection arguments", () => {
  assert.deepEqual(sentryInjectArgs("/tmp/worker"), [
    "sentry-cli", "sourcemaps", "inject", "/tmp/worker",
  ]);
});

test("builds the Sentry source map upload arguments", () => {
  assert.deepEqual(sentryUploadArgs({ org: "starhold", project: "worker", outdir: "/tmp/worker" }), [
    "sentry-cli", "sourcemaps", "upload", "--org", "starhold", "--project", "worker", "/tmp/worker",
  ]);
});
