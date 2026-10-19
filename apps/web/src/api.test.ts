import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  ApiError,
  fetchState,
  GET_TIMEOUT_MS,
  OVERLOAD_MESSAGE,
  parse,
  POST_TIMEOUT_MS,
  setApiFailureReporter,
  TIMEOUT_MESSAGE,
  upgradeBuilding,
  type ApiFailureContext,
} from "./api";

describe("safe JSON parse", () => {
  it("turns an HTML error page into overload, not a busy universe", async () => {
    const res = new Response("<html><title>Error 1102</title>exceeded resource limits</html>", {
      status: 503,
      headers: { "content-type": "text/html" },
    });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.retryable, true);
      assert.equal(err.status, 503);
      assert.equal(err.kind, "overload");
      assert.equal(err.message, OVERLOAD_MESSAGE);
      assert.doesNotMatch(err.message, /Universe busy/);
      assert.doesNotMatch(err.message, /expected pattern|SyntaxError|JSON\.parse|Unexpected token/i);
      return true;
    });
  });

  it("keeps a JSON busy error as busy", async () => {
    const res = new Response(
      JSON.stringify({ error: "Universe busy — retry in a moment." }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.kind, "busy");
      assert.equal(err.message, "Universe busy — retry in a moment.");
      return true;
    });
  });

  it("marks status 0 as network", async () => {
    const res = {
      ok: false,
      status: 0,
      url: "",
      text: async () => "",
      headers: new Headers(),
    } as Response;
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.kind, "network");
      assert.equal(err.status, 0);
      assert.doesNotMatch(err.message, /Universe busy/);
      return true;
    });
  });

  it("turns an empty body into a friendly error", async () => {
    const res = new Response("", { status: 200 });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.match(err.message, /unreadable response/i);
      assert.doesNotMatch(err.message, /expected pattern|SyntaxError/i);
      return true;
    });
  });

  it("keeps a JSON error message and marks 401 as not retryable", async () => {
    const res = new Response(JSON.stringify({ error: "Sign in required." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.retryable, false);
      assert.equal(err.kind, "client");
      assert.equal(err.message, "Sign in required.");
      return true;
    });
  });

  it("returns parsed JSON when the response is ok", async () => {
    const res = new Response(JSON.stringify({ ok: true, n: 2 }), { status: 200 });
    const body = await parse<{ ok: boolean; n: number }>(res);
    assert.deepEqual(body, { ok: true, n: 2 });
  });

  it("reports method, path without the query string, and kind", async () => {
    const seen: Array<{ status: number; message: string; ctx?: ApiFailureContext }> = [];
    setApiFailureReporter((status, message, ctx) => {
      seen.push({ status, message, ctx });
    });
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<html>Error 1102</html>", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    try {
      await assert.rejects(() => upgradeBuilding("p1", "shipyard"));
    } finally {
      globalThis.fetch = original;
      setApiFailureReporter(() => {});
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, 503);
    assert.equal(seen[0]?.ctx?.method, "POST");
    assert.equal(seen[0]?.ctx?.path, "/api/upgrade");
    assert.equal(seen[0]?.ctx?.kind, "overload");
    assert.doesNotMatch(seen[0]?.message ?? "", /Universe busy|\?/);
  });
});

describe("credFetch timeout", () => {
  it("a GET that never answers rejects with kind timeout at 15 s fake time", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const seen: Array<{ status: number; message: string; ctx?: ApiFailureContext }> = [];
    setApiFailureReporter((status, message, ctx) => {
      seen.push({ status, message, ctx });
    });
    const original = globalThis.fetch;
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
      const promise = fetchState("p1");
      mock.timers.tick(GET_TIMEOUT_MS);
      await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 0);
        assert.equal(err.kind, "timeout");
        assert.equal(err.retryable, true);
        assert.equal(err.message, TIMEOUT_MESSAGE);
        return true;
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.status, 0);
      assert.equal(seen[0]?.ctx?.method, "GET");
      assert.equal(seen[0]?.ctx?.path, "/api/state");
      assert.equal(seen[0]?.ctx?.kind, "timeout");
    } finally {
      globalThis.fetch = original;
      setApiFailureReporter(() => {});
      mock.timers.reset();
    }
  });

  it("a POST that never answers rejects with kind timeout at 20 s fake time", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const seen: Array<{ status: number; message: string; ctx?: ApiFailureContext }> = [];
    setApiFailureReporter((status, message, ctx) => {
      seen.push({ status, message, ctx });
    });
    const original = globalThis.fetch;
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
      mock.timers.tick(POST_TIMEOUT_MS);
      await assert.rejects(promise, (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 0);
        assert.equal(err.kind, "timeout");
        assert.equal(err.retryable, true);
        assert.equal(err.message, TIMEOUT_MESSAGE);
        return true;
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.status, 0);
      assert.equal(seen[0]?.ctx?.method, "POST");
      assert.equal(seen[0]?.ctx?.path, "/api/upgrade");
      assert.equal(seen[0]?.ctx?.kind, "timeout");
    } finally {
      globalThis.fetch = original;
      setApiFailureReporter(() => {});
      mock.timers.reset();
    }
  });
});
