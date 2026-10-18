import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planFailureReport,
  reportFailure,
  resetFailureStateForTests,
  setTelemetrySinkForTests,
} from "./telemetry";

describe("api failure telemetry", () => {
  it("reports busy and overload as warnings with a stable fingerprint", async () => {
    resetFailureStateForTests();
    const events: Array<{ message: string; hint: { level: string; tags: Record<string, string>; fingerprint: string[] } }> = [];
    const props: Array<Record<string, unknown>> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => {
        events.push({ message: err instanceof Error ? err.message : "", hint });
      },
      posthog: (_event, body) => props.push(body),
    });
    try {
      await reportFailure(503, "Universe busy — retry in a moment.", {
        method: "POST",
        path: "/api/upgrade?playerId=secret",
        kind: "busy",
      });
      await reportFailure(503, "The server hiccuped. Checking whether your order went through…", {
        method: "POST",
        path: "/api/upgrade",
        kind: "overload",
      });
      await reportFailure(500, "Boom", {
        method: "POST",
        path: "/api/upgrade",
        kind: "server",
      });
      await reportFailure(500, "pilot@example.com failed", {
        method: "POST",
        path: "/api/upgrade",
        kind: "server",
      });
    } finally {
      setTelemetrySinkForTests(null);
    }
    assert.equal(events.length, 4);
    assert.equal(events[0]?.hint.level, "warning");
    assert.deepEqual(events[0]?.hint.fingerprint, ["api", "POST", "/api/upgrade", "503", "busy"]);
    assert.equal(events[0]?.hint.tags.api_path, "/api/upgrade");
    assert.equal(events[0]?.hint.tags.api_method, "POST");
    assert.equal(events[0]?.hint.tags.api_kind, "busy");
    assert.equal(events[1]?.hint.level, "warning");
    assert.deepEqual(events[1]?.hint.fingerprint, ["api", "POST", "/api/upgrade", "503", "overload"]);
    assert.equal(events[2]?.hint.level, "error");
    assert.equal(events[3]?.message, "Request failed.");
    assert.equal(props[0]?.api_kind, "busy");
    assert.equal(props[0]?.level, "warning");
    assert.equal(props[1]?.api_kind, "overload");
    assert.equal(props[3]?.$exception_message, "Request failed.");
    const quiet = planFailureReport(400, "nope", { method: "POST", path: "/api/upgrade", kind: "client" });
    assert.equal(quiet.skip, true);
  });

  it("stays quiet until three state polls fail in a row", async () => {
    resetFailureStateForTests();
    let calls = 0;
    setTelemetrySinkForTests({ sentry: () => { calls += 1; } });
    try {
      const ctx = { method: "GET", path: "/api/state?playerId=p1", kind: "overload" as const };
      await reportFailure(503, "hiccup", ctx);
      await reportFailure(503, "hiccup", ctx);
      assert.equal(calls, 0);
      await reportFailure(503, "hiccup", ctx);
      assert.equal(calls, 1);
      assert.equal(planFailureReport(200, "ok", { method: "GET", path: "/api/state", kind: "client" }).skip, true);
    } finally {
      setTelemetrySinkForTests(null);
      resetFailureStateForTests();
    }
  });
});
