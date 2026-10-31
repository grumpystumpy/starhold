import "./test-dom";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PlayerView } from "@starhold/game";
import {
  GET_TIMEOUT_MS,
  NOT_APPLIED_MESSAGE,
  OVERLOAD_MESSAGE,
  POST_TIMEOUT_MS,
  setApiFailureReporter,
} from "./api";

const { doUpgrade, doBuild, doBuildDefense, doResearch } = await import("./main-actions-build");
const { doActivateOfficer, doRaiseOfficer, doUnlockSkill } = await import(
  "./main-actions-starshards"
);
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

function starshardsView(options: {
  officerLevels?: Record<string, number>;
  officers?: Array<{ officerId: string; activatedAt: number; expiresAt: number }>;
  skillsUnlocked?: string[];
  skillLevels?: Record<string, number>;
} = {}): PlayerView {
  return {
    ...view([]),
    officerLevels: options.officerLevels ?? {},
    officers: options.officers ?? [],
    skillsUnlocked: options.skillsUnlocked ?? [],
    skillLevels: options.skillLevels ?? {},
  } as unknown as PlayerView;
}

describe("failed actions check state", () => {
  it("shows raise success when an HTML 503 state check sees the officer level increase, and posts once", async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    setApiFailureReporter(() => {});
    setPaintImpl(() => {});
    session.view = starshardsView({ officerLevels: { engineer: 1 } });
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/raise-officer")) {
        posts += 1;
        return new Response("<html>Error 1102</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify(starshardsView({ officerLevels: { engineer: 2 } })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doRaiseOfficer("engineer");
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Officer level raised.");
  });

  it("says not applied when a failed raise leaves the officer level unchanged", async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    setApiFailureReporter(() => {});
    setPaintImpl(() => {});
    session.view = starshardsView({ officerLevels: { engineer: 1 } });
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/raise-officer")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify(starshardsView({ officerLevels: { engineer: 1 } })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doRaiseOfficer("engineer");
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });

  it("recognizes a hired officer after an HTML 503 without reposting", async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    setApiFailureReporter(() => {});
    setPaintImpl(() => {});
    session.view = starshardsView();
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/activate-officer")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify(
            starshardsView({
              officerLevels: { engineer: 1 },
              officers: [{ officerId: "engineer", activatedAt: 10, expiresAt: 20 }],
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doActivateOfficer("engineer");
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Officer hired.");
  });

  it("recognizes an unlocked skill after an HTML 503 without reposting", async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    setApiFailureReporter(() => {});
    setPaintImpl(() => {});
    session.view = starshardsView();
    session.busy = false;
    session.error = null;
    session.notice = null;
    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/unlock-skill")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify(
            starshardsView({
              skillsUnlocked: ["eco_mines_1"],
              skillLevels: { eco_mines_1: 1 },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doUnlockSkill("eco_mines_1");
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Skill unlocked.");
  });

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

  it("retries state check after full 1.5s if check fails once with overload, then succeeds", async () => {
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
      assert.equal(states, 1);
      mock.timers.tick(1499);
      assert.equal(states, 1);
      mock.timers.tick(1);
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

  it("retries state check after full 1.5s if check fails once with network error, then succeeds", async () => {
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
          throw new TypeError("Failed to fetch");
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
      assert.equal(states, 1);
      mock.timers.tick(1499);
      assert.equal(states, 1);
      mock.timers.tick(1);
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

  it("retries state check after full 1.5s if check fails once with timeout, then succeeds", async () => {
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
        return Promise.resolve(new Response("<html>Error 503</html>", { status: 503 }));
      }
      if (url.includes("/api/state")) {
        states += 1;
        if (states === 1) {
          return new Promise<Response>((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            }
          });
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              view([{ id: "q1", buildingId: "shipyard", targetLevel: 2 }]),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doUpgrade("shipyard");
      await new Promise((r) => setImmediate(r));
      assert.equal(states, 1);
      mock.timers.tick(GET_TIMEOUT_MS);
      await new Promise((r) => setImmediate(r));
      assert.equal(states, 1);
      mock.timers.tick(1499);
      assert.equal(states, 1);
      mock.timers.tick(1);
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

  it("does not retry state check on non-retryable failure (e.g. 400), showing NOT_APPLIED_MESSAGE", async () => {
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
        return new Response(JSON.stringify({ error: "Invalid player ID." }), {
          status: 400,
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
      assert.equal(states, 1);
      mock.timers.tick(1499);
      assert.equal(states, 1);
      mock.timers.tick(1);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }
    assert.equal(posts, 1);
    assert.equal(states, 2);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });

  it("build-ship gets 503 while older batch finishes: reports applied if new batch saved, 1 POST made", async () => {
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [{ id: "q1", shipId: "scout", count: 5 }],
        defenseQueue: [],
        ships: { scout: 0 },
        defenses: {},
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/build-ship")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify({
            now: 1_700_000_000_000,
            player: { id: "p1", research: {}, researchQueue: [] },
            planet: {
              id: "pl1",
              buildings: {},
              buildQueue: [],
              shipQueue: [{ id: "q2", shipId: "scout", count: 10 }],
              defenseQueue: [],
              ships: { scout: 5 },
              defenses: {},
            },
            galaxy: { galaxy: 1, system: 4 },
            fleets: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doBuild("scout", 10);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued 10× Recon Drone/);
  });

  it("build-ship gets 503 while older batch finishes: reports not applied if new batch NOT saved, 1 POST made", async () => {
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [{ id: "q1", shipId: "scout", count: 5 }],
        defenseQueue: [],
        ships: { scout: 0 },
        defenses: {},
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/build-ship")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify({
            now: 1_700_000_000_000,
            player: { id: "p1", research: {}, researchQueue: [] },
            planet: {
              id: "pl1",
              buildings: {},
              buildQueue: [],
              shipQueue: [],
              defenseQueue: [],
              ships: { scout: 5 },
              defenses: {},
            },
            galaxy: { galaxy: 1, system: 4 },
            fleets: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doBuild("scout", 10);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });

  it("build-ship timeout (hang) checks state correctly without resending POST", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: { scout: 0 },
        defenses: {},
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (url.includes("/api/build-ship")) {
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
            JSON.stringify({
              now: 1_700_000_000_000,
              player: { id: "p1", research: {}, researchQueue: [] },
              planet: {
                id: "pl1",
                buildings: {},
                buildQueue: [],
                shipQueue: [{ id: "q1", shipId: "scout", count: 10 }],
                defenseQueue: [],
                ships: { scout: 0 },
                defenses: {},
              },
              galaxy: { galaxy: 1, system: 4 },
              fleets: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doBuild("scout", 10);
      mock.timers.tick(POST_TIMEOUT_MS);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued 10× Recon Drone/);
  });

  it("build-defense gets 503 while older batch finishes: reports applied if new batch saved, 1 POST made", async () => {
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [{ id: "dq1", defenseId: "laserBattery", count: 3 }],
        ships: {},
        defenses: { laserBattery: 0 },
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/build-defense")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify({
            now: 1_700_000_000_000,
            player: { id: "p1", research: {}, researchQueue: [] },
            planet: {
              id: "pl1",
              buildings: {},
              buildQueue: [],
              shipQueue: [],
              defenseQueue: [{ id: "dq2", defenseId: "laserBattery", count: 5 }],
              ships: {},
              defenses: { laserBattery: 3 },
            },
            galaxy: { galaxy: 1, system: 4 },
            fleets: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doBuildDefense("laserBattery", 5);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued 5× Light Laser Turret/);
  });

  it("build-defense gets 503 while older batch finishes: reports not applied if new batch NOT saved, 1 POST made", async () => {
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [{ id: "dq1", defenseId: "laserBattery", count: 3 }],
        ships: {},
        defenses: { laserBattery: 0 },
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/build-defense")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        return new Response(
          JSON.stringify({
            now: 1_700_000_000_000,
            player: { id: "p1", research: {}, researchQueue: [] },
            planet: {
              id: "pl1",
              buildings: {},
              buildQueue: [],
              shipQueue: [],
              defenseQueue: [],
              ships: {},
              defenses: { laserBattery: 3 },
            },
            galaxy: { galaxy: 1, system: 4 },
            fleets: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      await doBuildDefense("laserBattery", 5);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, NOT_APPLIED_MESSAGE);
  });

  it("build-defense timeout (hang) checks state correctly without resending POST", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    setPaintImpl(() => {});
    session.view = {
      now: 1_700_000_000_000,
      player: { id: "p1", research: {}, researchQueue: [] },
      planet: {
        id: "pl1",
        buildings: {},
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: {},
        defenses: { laserBattery: 0 },
      },
      galaxy: { galaxy: 1, system: 4 },
      fleets: [],
    } as unknown as PlayerView;
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (url.includes("/api/build-defense")) {
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
            JSON.stringify({
              now: 1_700_000_000_000,
              player: { id: "p1", research: {}, researchQueue: [] },
              planet: {
                id: "pl1",
                buildings: {},
                buildQueue: [],
                shipQueue: [],
                defenseQueue: [{ id: "dq1", defenseId: "laserBattery", count: 5 }],
                ships: {},
                defenses: { laserBattery: 0 },
              },
              galaxy: { galaxy: 1, system: 4 },
              fleets: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    try {
      const promise = doBuildDefense("laserBattery", 5);
      mock.timers.tick(POST_TIMEOUT_MS);
      await promise;
    } finally {
      globalThis.fetch = original;
      mock.timers.reset();
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /Queued 5× Light Laser Turret/);
  });
});
