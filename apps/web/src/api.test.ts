import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PlayerView } from "@starhold/game";
import {
  ApiError,
  applyDeletedMessages,
  fetchPublicCombatReport,
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
  it("fetches a public report without relying on a player session", async () => {
    const original = globalThis.fetch;
    let requestUrl = "";
    let credentials = "";
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      credentials = String(init?.credentials);
      return new Response(
        JSON.stringify({
          shareCode: "sh_public",
          attackerName: "A",
          defenderName: "B",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const report = await fetchPublicCombatReport("sh_public");
      assert.equal(report.shareCode, "sh_public");
      assert.equal(requestUrl, "/api/reports/sh_public");
      assert.equal(credentials, "include");
    } finally {
      globalThis.fetch = original;
    }
  });

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

describe("page-scoped state", () => {
  it("keeps omitted slices from the previous snapshot", async () => {
    const original = globalThis.fetch;
    let phase = 0;
    globalThis.fetch = async (input, init) => {
      phase += 1;
      const url = String(input);
      if (phase === 1) {
        assert.equal(url.includes("page="), false);
        return new Response(
          JSON.stringify({
            now: 1,
            player: { id: "scoped", eventLog: [{ id: "e", title: "Keep" }] },
            planet: { id: "pl", resources: { metal: 1, crystal: 0, deuterium: 0 } },
            galaxy: { galaxy: 1, system: 2, slots: [{ planetId: "pl" }] },
            reports: [{ id: "report-1" }],
            spyReports: [],
            expeditionReports: [],
            shopCatalog: { beam: { id: "beam" } },
            highscores: [{ playerId: "scoped" }],
            roster: [{ id: "scoped" }],
            allianceDirectory: [{ id: "ally" }],
            officerCatalog: [{ id: "eng" }],
            skillCatalog: [{ id: "sk" }],
          }),
          { status: 200, headers: { "content-type": "application/json", etag: "full" } },
        );
      }
      assert.match(url, /page=overview/);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      assert.equal(headers["If-None-Match"], "full");
      return new Response(
        JSON.stringify({
          now: 2,
          omitted: ["galaxy", "messages", "shop", "highscores", "roster", "alliances"],
          messagesOmitted: true,
          inboxUnread: 3,
          player: { id: "scoped", eventLog: [] },
          planet: { id: "pl", resources: { metal: 9, crystal: 0, deuterium: 0 } },
          galaxy: { galaxy: 1, system: 2, slots: [] },
          reports: [],
          spyReports: [],
          expeditionReports: [],
          shopCatalog: {},
          highscores: [],
          roster: [],
          allianceDirectory: [],
          catalogsOmitted: true,
        }),
        { status: 200, headers: { "content-type": "application/json", etag: "slim" } },
      );
    };
    try {
      const full = await fetchState("scoped-player");
      const slim = await fetchState("scoped-player", undefined, undefined, {
        page: "overview",
        base: full,
      });
      assert.equal(slim.galaxy.slots.length, 1);
      assert.equal(slim.player.eventLog?.[0]?.title, "Keep");
      assert.equal(slim.reports.length, 1);
      assert.equal(slim.messagesOmitted, true);
      assert.equal(slim.inboxUnread, 3);
      assert.equal(slim.planet.resources.metal, 9);
      assert.equal(Object.keys(slim.shopCatalog).length, 1);
      assert.equal(slim.highscores.length, 1);
      assert.equal(slim.roster.length, 1);
      assert.equal(slim.allianceDirectory.length, 1);
      assert.equal(slim.officerCatalog[0]?.id, "eng");
      assert.equal(slim.omitted, undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops a deleted category without a replacement view", () => {
    const view = {
      player: { id: "p", eventLog: [{ id: "a" }] },
      reports: [{ id: "r" }],
      spyReports: [{ id: "s" }],
      expeditionReports: [{ id: "e" }],
    } as unknown as PlayerView;
    const alerts = applyDeletedMessages(view, "alerts");
    assert.equal(alerts.player.eventLog?.length, 0);
    assert.equal(alerts.reports.length, 1);
    const all = applyDeletedMessages(view, "all");
    assert.equal(all.reports.length, 0);
    assert.equal(all.spyReports.length, 0);
    assert.equal(all.expeditionReports.length, 0);
    assert.equal(all.messagesOmitted, false);
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
      assert.equal(typeof seen[0]?.ctx?.durationMs, "number");
    } finally {
      globalThis.fetch = original;
      setApiFailureReporter(() => {});
      mock.timers.reset();
    }
  });

  it("tracks visibility state changes during credFetch", async () => {
    const seen: Array<{ status: number; message: string; ctx?: ApiFailureContext }> = [];
    setApiFailureReporter((status, message, ctx) => {
      seen.push({ status, message, ctx });
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
      // Simulate page hide while request is in flight
      fakeDoc.visibilityState = "hidden";
      for (const fn of listeners) fn();
      return new Response("<html>Error 500</html>", { status: 500 });
    };

    try {
      await assert.rejects(() => upgradeBuilding("p1", "shipyard"));
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.ctx?.wasHidden, true);
      assert.equal(typeof seen[0]?.ctx?.durationMs, "number");
    } finally {
      if (originalDoc !== undefined) {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDoc });
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
      globalThis.fetch = originalFetch;
      setApiFailureReporter(() => {});
    }
  });
});
