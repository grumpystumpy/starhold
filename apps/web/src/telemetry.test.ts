import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { fetchState, setApiFailureReporter, upgradeBuilding } from "./api";
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
        durationMs: 120,
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
        api_wait_ms: "120",
        level: "warning",
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

  it("lets posthog-js build a valid exception list", async () => {
    const globals = ["window", "document", "location", "fetch"] as const;
    const originalSetTimeout = globalThis.setTimeout;
    const originalSetInterval = globalThis.setInterval;
    globalThis.setTimeout = (() => 0) as typeof setTimeout;
    globalThis.setInterval = (() => 0) as typeof setInterval;
    const originalGlobals = new Map(
      globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    const requests: string[] = [];
    const location = new URL("https://starhold.test/");
    const createElement = () => {
      let parsedUrl = new URL(location);
      return {
        set href(value: string) {
          parsedUrl = new URL(value, location);
        },
        get href() {
          return parsedUrl.href;
        },
        get protocol() {
          return parsedUrl.protocol;
        },
        get hostname() {
          return parsedUrl.hostname;
        },
        get host() {
          return parsedUrl.host;
        },
        get port() {
          return parsedUrl.port;
        },
        get pathname() {
          return parsedUrl.pathname;
        },
        get search() {
          return parsedUrl.search;
        },
        get hash() {
          return parsedUrl.hash;
        },
        style: {},
      };
    };
    const browserWindow = {
      location,
      navigator: { userAgent: "Mozilla/5.0 Chrome/120.0", onLine: true },
      screen: { width: 1280, height: 720, colorDepth: 24, pixelDepth: 24 },
      addEventListener() {},
      removeEventListener() {},
      console,
    };
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: browserWindow },
      document: {
        configurable: true,
        value: {
          location,
          readyState: "complete",
          addEventListener() {},
          removeEventListener() {},
          documentElement: { clientWidth: 1280, clientHeight: 720 },
          createElement,
        },
      },
      location: { configurable: true, value: location },
      fetch: {
        configurable: true,
        value: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (typeof init?.body === "string") requests.push(init.body);
          return new Response("{}", { status: 200 });
        },
      },
    });

    let client: InstanceType<(typeof import("posthog-js"))["PostHog"]> | undefined;
    try {
      const { PostHog } = await import("posthog-js");
      client = new PostHog();
      client.init("phc_test", {
        api_host: "https://posthog.test",
        persistence: "memory",
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        disable_remote_config: true,
        disable_external_dependency_loading: true,
        advanced_disable_decide: true,
        advanced_disable_feature_flags: true,
        opt_out_useragent_filter: true,
        request_batching: false,
        transport: "fetch",
        disable_compression: true,
      });
      client.captureException(new Error("SDK exception test"));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await client?.shutdown();
      for (const name of globals) {
        const descriptor = originalGlobals.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      globalThis.setTimeout = originalSetTimeout;
      globalThis.setInterval = originalSetInterval;
    }

    const events = requests.flatMap((body) => {
      const payload = JSON.parse(body) as { batch?: Array<Record<string, unknown>> };
      return payload.batch ?? [];
    });
    const event = events.find((candidate) => (
      typeof candidate === "object"
      && candidate !== null
      && (candidate as Record<string, unknown>).event === "$exception"
    )) as Record<string, unknown> | undefined;
    assert.ok(event, "PostHog request queue should emit a $exception event");
    const properties = event.properties as Record<string, unknown>;
    const exception = properties.$exception_list as Array<{ type?: unknown; value?: unknown }> | undefined;
    assert.ok(Array.isArray(exception) && exception.length > 0);
    assert.equal(typeof exception[0]?.type, "string");
    assert.ok(exception[0].type);
    assert.equal(typeof exception[0]?.value, "string");
    assert.ok(exception[0].value);
    assert.equal("$exception_message" in properties, false);
    assert.equal("$exception_type" in properties, false);
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

  it("reports network and timeout at level warning with api_wait_ms tag", async () => {
    resetFailureStateForTests();
    const sentryCalls: Array<{ err: unknown; hint: unknown }> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => sentryCalls.push({ err, hint }),
    });
    try {
      await reportFailure(0, "Network error", {
        method: "GET",
        path: "/api/state",
        kind: "network",
        durationMs: 450,
      });
      // 3-in-a-row rule: first two state poll failures skipped
      assert.equal(sentryCalls.length, 0);

      await reportFailure(0, "Network error", {
        method: "GET",
        path: "/api/state",
        kind: "network",
        durationMs: 450,
      });
      assert.equal(sentryCalls.length, 0);

      await reportFailure(0, "Network error", {
        method: "GET",
        path: "/api/state",
        kind: "network",
        durationMs: 450,
      });
      assert.equal(sentryCalls.length, 1);
      assert.deepEqual(sentryCalls[0]?.hint, {
        level: "warning",
        tags: {
          api_status: "0",
          api_path: "/api/state",
          api_method: "GET",
          api_kind: "network",
          api_wait_ms: "450",
        },
        fingerprint: ["api", "GET", "/api/state", "0", "network"],
      });

      await reportFailure(0, "Timeout error", {
        method: "POST",
        path: "/api/upgrade",
        kind: "timeout",
        durationMs: 20000,
      });
      assert.equal(sentryCalls.length, 2);
      assert.deepEqual(sentryCalls[1]?.hint, {
        level: "warning",
        tags: {
          api_status: "0",
          api_path: "/api/upgrade",
          api_method: "POST",
          api_kind: "timeout",
          api_wait_ms: "20000",
        },
        fingerprint: ["api", "POST", "/api/upgrade", "0", "timeout"],
      });
    } finally {
      setTelemetrySinkForTests(null);
      resetFailureStateForTests();
    }
  });

  it("skips reporting if page was hidden during request", async () => {
    resetFailureStateForTests();
    const exceptions: unknown[] = [];
    setTelemetrySinkForTests({
      posthogException: (err) => exceptions.push(err),
    });
    try {
      const plan = planFailureReport(500, "Server error", {
        method: "POST",
        path: "/api/upgrade",
        kind: "server",
        wasHidden: true,
      });
      assert.equal(plan.skip, true);

      await reportFailure(500, "Server error", {
        method: "POST",
        path: "/api/upgrade",
        kind: "server",
        wasHidden: true,
      });
      assert.equal(exceptions.length, 0);
    } finally {
      setTelemetrySinkForTests(null);
      resetFailureStateForTests();
    }
  });

  it("end-to-end: real rejected fetch via credFetch produces warning event with api_wait_ms", async () => {
    resetFailureStateForTests();
    const sentryCalls: Array<{
      err: unknown;
      hint: { level: string; tags: Record<string, string>; fingerprint: string[] };
    }> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => sentryCalls.push({ err, hint }),
    });
    setApiFailureReporter((status, message, ctx) => {
      void reportFailure(status, message, ctx);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    try {
      await assert.rejects(() => upgradeBuilding("p1", "shipyard"));
      assert.equal(sentryCalls.length, 1);
      const call = sentryCalls[0]!;
      assert.equal(call.hint.level, "warning");
      assert.equal(call.hint.tags.api_status, "0");
      assert.equal(call.hint.tags.api_path, "/api/upgrade");
      assert.equal(call.hint.tags.api_method, "POST");
      assert.equal(call.hint.tags.api_kind, "network");
      assert.ok("api_wait_ms" in call.hint.tags);
      const waitMs = Number(call.hint.tags.api_wait_ms);
      assert.ok(!Number.isNaN(waitMs) && waitMs >= 0);
      assert.deepEqual(call.hint.fingerprint, ["api", "POST", "/api/upgrade", "0", "network"]);
    } finally {
      globalThis.fetch = originalFetch;
      setTelemetrySinkForTests(null);
      setApiFailureReporter(() => {});
      resetFailureStateForTests();
    }
  });

  it("end-to-end: request hidden in flight produces NO sink event", async () => {
    resetFailureStateForTests();
    const sentryCalls: Array<{ err: unknown; hint: unknown }> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => sentryCalls.push({ err, hint }),
    });
    setApiFailureReporter((status, message, ctx) => {
      void reportFailure(status, message, ctx);
    });

    const listeners = new Set<() => void>();
    const fakeDoc = {
      visibilityState: "visible" as "visible" | "hidden",
      addEventListener(event: string, fn: () => void) {
        if (event === "visibilitychange") listeners.add(fn);
      },
      removeEventListener(event: string, fn: () => void) {
        if (event === "visibilitychange") listeners.delete(fn);
      },
    };

    const originalDoc = globalThis.document;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDoc,
    });

    globalThis.fetch = async () => {
      fakeDoc.visibilityState = "hidden";
      for (const fn of listeners) fn();
      throw new TypeError("Failed to fetch");
    };

    try {
      await assert.rejects(() => upgradeBuilding("p1", "shipyard"));
      assert.equal(sentryCalls.length, 0);
    } finally {
      if (originalDoc !== undefined) {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDoc });
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
      globalThis.fetch = originalFetch;
      setTelemetrySinkForTests(null);
      setApiFailureReporter(() => {});
      resetFailureStateForTests();
    }
  });

  it("end-to-end: 3-in-a-row rule for GET /api/state holds through credFetch", async () => {
    resetFailureStateForTests();
    const sentryCalls: Array<{
      err: unknown;
      hint: { level: string; tags: Record<string, string>; fingerprint: string[] };
    }> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => sentryCalls.push({ err, hint }),
    });
    setApiFailureReporter((status, message, ctx) => {
      void reportFailure(status, message, ctx);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    try {
      await assert.rejects(() => fetchState("p1"));
      assert.equal(sentryCalls.length, 0);

      await assert.rejects(() => fetchState("p1"));
      assert.equal(sentryCalls.length, 0);

      await assert.rejects(() => fetchState("p1"));
      assert.equal(sentryCalls.length, 1);

      const call = sentryCalls[0]!;
      assert.equal(call.hint.level, "warning");
      assert.equal(call.hint.tags.api_status, "0");
      assert.equal(call.hint.tags.api_path, "/api/state");
      assert.equal(call.hint.tags.api_method, "GET");
      assert.equal(call.hint.tags.api_kind, "network");
      assert.ok("api_wait_ms" in call.hint.tags);
      assert.deepEqual(call.hint.fingerprint, ["api", "GET", "/api/state", "0", "network"]);
    } finally {
      globalThis.fetch = originalFetch;
      setTelemetrySinkForTests(null);
      setApiFailureReporter(() => {});
      resetFailureStateForTests();
    }
  });

  it("end-to-end: credFetch timeout produces warning event with api_wait_ms tag", async () => {
    resetFailureStateForTests();
    mock.timers.enable({ apis: ["setTimeout"] });
    const sentryCalls: Array<{
      err: unknown;
      hint: { level: string; tags: Record<string, string>; fingerprint: string[] };
    }> = [];
    setTelemetrySinkForTests({
      sentry: (err, hint) => sentryCalls.push({ err, hint }),
    });
    setApiFailureReporter((status, message, ctx) => {
      void reportFailure(status, message, ctx);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    };

    try {
      const promise = upgradeBuilding("p1", "shipyard");
      mock.timers.tick(20000);
      await assert.rejects(promise);
      assert.equal(sentryCalls.length, 1);
      const call = sentryCalls[0]!;
      assert.equal(call.hint.level, "warning");
      assert.equal(call.hint.tags.api_status, "0");
      assert.equal(call.hint.tags.api_path, "/api/upgrade");
      assert.equal(call.hint.tags.api_method, "POST");
      assert.equal(call.hint.tags.api_kind, "timeout");
      assert.ok("api_wait_ms" in call.hint.tags);
      const waitMs = Number(call.hint.tags.api_wait_ms);
      assert.ok(!Number.isNaN(waitMs) && waitMs >= 0);
      assert.deepEqual(call.hint.fingerprint, ["api", "POST", "/api/upgrade", "0", "timeout"]);
    } finally {
      globalThis.fetch = originalFetch;
      setTelemetrySinkForTests(null);
      setApiFailureReporter(() => {});
      resetFailureStateForTests();
      mock.timers.reset();
    }
  });
});
