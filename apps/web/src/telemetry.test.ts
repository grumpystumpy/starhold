import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostHog } from "posthog-js";
import {
  planFailureReport,
  reportFailure,
  resetFailureStateForTests,
  setTelemetrySinkForTests,
} from "./telemetry";

describe("api failure telemetry", () => {
  it("sends exception objects with scrubbed messages and diagnostic properties", async () => {
    resetFailureStateForTests();
    const exceptions: Array<{ err: unknown; props: Record<string, unknown> }> = [];
    setTelemetrySinkForTests({
      posthogException: (err, props) => exceptions.push({ err, props }),
    });
    try {
      await reportFailure(503, "The server is overloaded.", {
        method: "POST",
        path: "/api/upgrade?playerId=secret",
        kind: "overload",
      });
      await reportFailure(0, "pilot@example.com could not connect", {
        method: "POST",
        path: "/api/login",
        kind: "network",
      });
      const statePoll = { method: "GET", path: "/api/state?playerId=p1", kind: "overload" as const };
      await reportFailure(503, "state poll failed", statePoll);
      await reportFailure(503, "state poll failed", statePoll);
      await reportFailure(503, "state poll failed", statePoll);
    } finally {
      setTelemetrySinkForTests(null);
      resetFailureStateForTests();
    }

    assert.equal(exceptions.length, 3);
    assert.deepEqual(
      exceptions.map(({ err }) => err instanceof Error ? err.message : null),
      ["The server is overloaded.", "Request failed.", "state poll failed"],
    );
    assert.deepEqual(exceptions.map(({ props }) => props), [
      {
        api_status: "503",
        api_path: "/api/upgrade",
        api_method: "POST",
        api_kind: "overload",
        level: "warning",
        $exception_fingerprint: "api:POST:/api/upgrade:503:overload",
      },
      {
        api_status: "0",
        api_path: "/api/login",
        api_method: "POST",
        api_kind: "network",
        level: "error",
        $exception_fingerprint: "api:POST:/api/login:0:network",
      },
      {
        api_status: "503",
        api_path: "/api/state",
        api_method: "GET",
        api_kind: "overload",
        level: "warning",
        $exception_fingerprint: "api:GET:/api/state:503:overload",
      },
    ]);
  });

  it("lets posthog-js build a valid exception list", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalSetInterval = globalThis.setInterval;
    globalThis.setTimeout = (() => 0) as typeof setTimeout;
    globalThis.setInterval = (() => 0) as typeof setInterval;
    const client = new PostHog();
    const events: Array<{ event: string; properties?: Record<string, unknown> }> = [];
    try {
      client.init("phc_test", {
        api_host: "https://posthog.test",
        persistence: "memory",
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        disable_remote_config: true,
      });
      client.capture = (event, properties) => {
        events.push({ event, properties });
        return undefined;
      };
      client.captureException(new Error("SDK exception test"));
    } finally {
      client._handle_unload();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.setInterval = originalSetInterval;
    }

    const event = events.find(({ event }) => event === "$exception");
    const exception = event?.properties?.$exception_list as Array<{ type?: string; value?: string }> | undefined;
    assert.ok(exception?.[0]?.type);
    assert.ok(exception?.[0]?.value);
  });

  it("keeps client failures and the first two state poll failures quiet", async () => {
    resetFailureStateForTests();
    const exceptions: unknown[] = [];
    setTelemetrySinkForTests({
      posthogException: (err) => exceptions.push(err),
    });
    try {
      const ctx = { method: "GET", path: "/api/state?playerId=p1", kind: "overload" as const };
      await reportFailure(503, "hiccup", ctx);
      await reportFailure(503, "hiccup", ctx);
      assert.equal(exceptions.length, 0);
      await reportFailure(400, "nope", { method: "POST", path: "/api/upgrade", kind: "client" });
      assert.equal(exceptions.length, 0);
      assert.equal(planFailureReport(200, "ok", { method: "GET", path: "/api/state", kind: "client" }).skip, true);
    } finally {
      setTelemetrySinkForTests(null);
      resetFailureStateForTests();
    }
  });
});
