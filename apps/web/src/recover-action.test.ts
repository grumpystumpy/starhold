import "./test-dom";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PlayerView } from "@starhold/game";
import { NOT_APPLIED_MESSAGE, OVERLOAD_MESSAGE, POST_TIMEOUT_MS } from "./api";

const { doUpgrade } = await import("./main-actions-build");
const { session, setPaintImpl } = await import("./session");

function view(queue: Array<{ id: string; buildingId: string; targetLevel: number }>): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", research: {}, researchQueue: [] },
    planet: {
      id: "pl1",
      buildings: { shipyard: 1 },
      buildQueue: queue,
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    galaxy: { galaxy: 1, system: 4 },
    fleets: [],
  } as unknown as PlayerView;
}

describe("failed actions check state", () => {
  it("shows success when the queued item is already saved, and posts once", async () => {
    const paints: string[] = [];
    setPaintImpl(() => {
      paints.push(`${session.error ?? ""}|${session.notice ?? ""}`);
    });
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    let phase = "idle";
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Response("<html>Error 1102</html>", {
          status: 503,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.includes("/api/state")) {
        if (phase === "action") {
          states += 1;
          const headers = (init?.headers ?? {}) as Record<string, string>;
          assert.equal(headers["If-None-Match"], undefined);
        }
        return new Response(
          JSON.stringify(
            view([{ id: "q1", buildingId: "shipyard", targetLevel: 2 }]),
          ),
          { status: 200, headers: { "content-type": "application/json", etag: "v1" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      phase = "action";
      await doUpgrade("shipyard");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued upgrade/);
    assert.ok(paints.some((line) => line.includes(OVERLOAD_MESSAGE)));
  });

  it("says the order was not applied when state has no new item, and posts once", async () => {
    setPaintImpl(() => {});
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(JSON.stringify(view([])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doUpgrade("shipyard");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });

  it("does not fetch state after a 400", async () => {
    setPaintImpl(() => {});
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Response(JSON.stringify({ error: "Not enough metal." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response("{}", { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doUpgrade("shipyard");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(posts, 1);
    assert.equal(states, 0);
    assert.equal(session.error, "Not enough metal.");
  });

  it("a timed-out POST mutation gives exactly 1 state read, 0 re-sent POSTs, and the correct applied result", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    setPaintImpl(() => {});
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              view([{ id: "q1", buildingId: "shipyard", targetLevel: 2 }]),
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doUpgrade("shipyard");
      mock.timers.tick(POST_TIMEOUT_MS);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued upgrade/);
  });

  it("retries state check after 1.5s if check fails once with overload, then succeeds", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    setPaintImpl(() => {});
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        if (states === 1) {
          return new Response("<html>Error 503</html>", { status: 503 });
        }
        return new Response(
          JSON.stringify(
            view([{ id: "q1", buildingId: "shipyard", targetLevel: 2 }]),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doUpgrade("shipyard");
      await new Promise((r) => setImmediate(r));
      mock.timers.tick(1500);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 2);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued upgrade/);
  });

  it("shows 'Not applied — tap again' when state check fails twice", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    setPaintImpl(() => {});
    session.view = view([]);
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/upgrade")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doUpgrade("shipyard");
      await new Promise((r) => setImmediate(r));
      mock.timers.tick(1500);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 2);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });
});
