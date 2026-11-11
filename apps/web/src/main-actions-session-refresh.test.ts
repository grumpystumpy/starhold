import "./test-dom";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import type { BuildQueueItem, DefenseQueueItem, PlayerView, ResearchQueueItem, ShipQueueItem } from "@starhold/game";
import { OVERLOAD_MESSAGE } from "./api";

const { POLL_RETRY_DELAY_MS, startPolling, stopPolling } = await import("./main-actions-session");
const { schedulePaint, session, setPaintImpl } = await import("./session");

type TimerJob = { at: number; callback: TimerHandler };

const originalSetTimeout = window.setTimeout;
const originalClearTimeout = window.clearTimeout;
const originalDateNow = Date.now;
const timers = new Map<number, TimerJob>();
let nextTimerId = 1;
let now = 1_700_000_000_000;

window.setTimeout = ((callback: TimerHandler, delay = 0) => {
  const id = nextTimerId++;
  timers.set(id, { at: now + Number(delay), callback });
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = ((id: number) => {
  timers.delete(id);
}) as typeof window.clearTimeout;
Date.now = () => now;

async function advanceBy(delay: number): Promise<void> {
  const target = now + delay;
  while (true) {
    const due = [...timers.entries()]
      .filter(([, job]) => job.at <= target)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    const [id, job] = due;
    timers.delete(id);
    now = job.at;
    if (typeof job.callback === "function") job.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  now = target;
}

function view(queues: {
  buildQueue?: Partial<BuildQueueItem>[];
  researchQueue?: Partial<ResearchQueueItem>[];
  shipQueue?: Partial<ShipQueueItem>[];
  defenseQueue?: Partial<DefenseQueueItem>[];
} = {}): PlayerView {
  return {
    now,
    player: {
      id: "p1",
      research: {},
      researchQueue: queues.researchQueue ?? [],
    },
    planet: {
      id: "pl1",
      buildings: {},
      buildQueue: queues.buildQueue ?? [],
      shipQueue: queues.shipQueue ?? [],
      defenseQueue: queues.defenseQueue ?? [],
      ships: {},
      defenses: {},
    },
    galaxy: { galaxy: 1, system: 1 },
    fleets: [],
  } as unknown as PlayerView;
}

function setView(next: PlayerView): void {
  session.view = next;
  schedulePaint();
}

function mockStateFetch(): { count: () => number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify(view()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    count: () => requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function reset(): void {
  stopPolling();
  timers.clear();
  now = 1_700_000_000_000;
  session.view = null;
  setPaintImpl(() => {});
}

after(() => {
  stopPolling();
  window.setTimeout = originalSetTimeout;
  window.clearTimeout = originalClearTimeout;
  Date.now = originalDateNow;
});

it("fetches once shortly after the earliest queue completion", async () => {
  reset();
  const fetch = mockStateFetch();
  try {
    setView(view({
      buildQueue: [{ completesAt: now + 4_000 }],
      researchQueue: [{ completesAt: now + 1_000 }],
      shipQueue: [{ completesAt: now + 2_000 }],
    }));
    await advanceBy(1_249);
    assert.equal(fetch.count(), 0);
    await advanceBy(1);
    assert.equal(fetch.count(), 1);
  } finally {
    fetch.restore();
  }
});

it("schedules a completion timer when only defenseQueue has items", async () => {
  reset();
  const fetch = mockStateFetch();
  try {
    setView(view({ defenseQueue: [{ id: "dq1", defenseId: "laserBattery", count: 4, completesAt: now + 1_000 }] }));
    await advanceBy(1_249);
    assert.equal(fetch.count(), 0);
    await advanceBy(1);
    assert.equal(fetch.count(), 1);
  } finally {
    fetch.restore();
  }
});

it("refreshes after research, ship, and defense items finish without notices", async () => {
  reset();
  const originalFetch = globalThis.fetch;
  let fetchStep = 0;

  const initialResearchItem = { id: "rq1", researchId: "energyTech", targetLevel: 5, completesAt: now + 1_000 };
  const initialShipItem = { id: "sq1", shipId: "interceptor", count: 10, completesAt: now + 2_000 };
  const initialDefenseItem = { id: "dq1", defenseId: "laserBattery", count: 4, completesAt: now + 3_000 };

  globalThis.fetch = async () => {
    fetchStep += 1;
    if (fetchStep === 1) {
      // Research finished
      return new Response(JSON.stringify(view({
        shipQueue: [initialShipItem],
        defenseQueue: [initialDefenseItem],
      })), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (fetchStep === 2) {
      // Ship finished
      return new Response(JSON.stringify(view({
        defenseQueue: [initialDefenseItem],
      })), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (fetchStep === 3) {
      // Defense finished
      return new Response(JSON.stringify(view({})), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(view({})), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    setView(view({
      researchQueue: [initialResearchItem],
      shipQueue: [initialShipItem],
      defenseQueue: [initialDefenseItem],
    }));

    // Advance to research completion
    await advanceBy(1_250);
    assert.equal(fetchStep, 1);
    assert.equal(session.notice, null);

    // Advance to ship completion
    await advanceBy(1_000);
    assert.equal(fetchStep, 2);
    assert.equal(session.notice, null);

    // Advance to defense completion
    await advanceBy(1_000);
    assert.equal(fetchStep, 3);
    assert.equal(session.notice, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("does not create a completion notice on subsequent poll or reload", async () => {
  reset();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify(view({})), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const researchItem = { id: "rq1", researchId: "energyTech", targetLevel: 5, completesAt: now + 1_000 };
    setView(view({ researchQueue: [researchItem] }));

    await advanceBy(1_250);
    assert.equal(session.notice, null);

    // Clear notice as if user or timer cleared flash
    session.notice = null;

    // Trigger another background refresh/poll
    const { silentRefresh } = await import("./main-actions-session");
    await silentRefresh("p1");

    // No completion notice should appear.
    assert.equal(session.notice, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("replaces the completion timer when rendered state changes", async () => {
  reset();
  const fetch = mockStateFetch();
  try {
    setView(view({ buildQueue: [{ completesAt: now + 1_000 }] }));
    await advanceBy(500);
    setView(view({ shipQueue: [{ completesAt: now + 2_000 }] }));
    await advanceBy(750);
    assert.equal(fetch.count(), 0);
    await advanceBy(1_499);
    assert.equal(fetch.count(), 0);
    await advanceBy(1);
    assert.equal(fetch.count(), 1);
  } finally {
    fetch.restore();
  }
});

it("schedules a completion timer when returning fleet arrivesAt completes", async () => {
  reset();
  const fetch = mockStateFetch();
  try {
    const fleetView = {
      ...view(),
      fleets: [
        {
          id: "f1",
          ownerPlayerId: "p1",
          phase: "returning",
          arrivesAt: now + 1_000,
        },
      ],
    };
    setView(fleetView as unknown as PlayerView);
    await advanceBy(1_249);
    assert.equal(fetch.count(), 0);
    await advanceBy(1);
    assert.equal(fetch.count(), 1);
  } finally {
    fetch.restore();
  }
});

it("does not schedule a completion timer when all queues are empty", () => {
  reset();
  setView(view());
  assert.equal(timers.size, 0);
});

it("clears the completion timer when polling stops", async () => {
  reset();
  const fetch = mockStateFetch();
  try {
    setView(view({ researchQueue: [{ completesAt: now + 1_000 }] }));
    stopPolling();
    await advanceBy(2_000);
    assert.equal(fetch.count(), 0);
  } finally {
    fetch.restore();
  }
});

it("pauses the 30s poll while hidden and refreshes when shown", async () => {
  reset();
  const tracked = mockStateFetch();
  const listeners = new Set<() => void>();
  let visibility: "visible" | "hidden" = "visible";
  const originalDoc = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get visibilityState() {
        return visibility;
      },
      addEventListener(event: string, fn: () => void) {
        if (event === "visibilitychange") listeners.add(fn);
      },
      removeEventListener(event: string, fn: () => void) {
        if (event === "visibilitychange") listeners.delete(fn);
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ prepend() {} }),
      documentElement: {},
    },
  });
  try {
    window.addEventListener = () => {};
    window.removeEventListener = () => {};
    session.view = view();
    startPolling("p1");
    await advanceBy(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(tracked.count(), 1);
    visibility = "hidden";
    for (const fn of listeners) fn();
    await advanceBy(60_000);
    assert.equal(tracked.count(), 1);
    visibility = "visible";
    for (const fn of listeners) fn();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(tracked.count(), 2);
    await advanceBy(30_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(tracked.count(), 3);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDoc,
    });
    tracked.restore();
    stopPolling();
  }
});

it("retries one 503 on the poll before showing the overload line", async () => {
  reset();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("<html>Error 1102</html>", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(JSON.stringify(view()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    session.view = view();
    session.error = null;
    const { silentRefresh } = await import("./main-actions-session");
    const pending = silentRefresh("p1");
    for (let i = 0; i < 8 && timers.size === 0; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await advanceBy(POLL_RETRY_DELAY_MS);
    await pending;
    assert.equal(calls, 2);
    assert.equal(session.error, null);
  } finally {
    globalThis.fetch = original;
  }
});

it("uses the overload message after a second 503 and not Server unreachable", async () => {
  reset();
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<html>Error 503</html>", {
      status: 503,
      headers: { "content-type": "text/html" },
    });
  try {
    session.view = view();
    session.error = null;
    const { silentRefresh } = await import("./main-actions-session");
    const pending = silentRefresh("p1");
    for (let i = 0; i < 8 && timers.size === 0; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await advanceBy(POLL_RETRY_DELAY_MS);
    await pending;
    assert.equal(session.error, OVERLOAD_MESSAGE);
    assert.equal(session.error?.includes("Server unreachable"), false);
  } finally {
    globalThis.fetch = original;
  }
});

it("fetches messages when that page opens", async () => {
  reset();
  const original = globalThis.fetch;
  let url = "";
  const win = window as unknown as {
    location: { href: string; pathname: string; search: string; hash: string };
    history: { replaceState: () => void; pushState: () => void };
  };
  const previousLocation = win.location;
  const previousHistory = win.history;
  win.location = {
    href: "http://localhost/overview",
    pathname: "/overview",
    search: "",
    hash: "",
  };
  win.history = { replaceState() {}, pushState() {} };
  globalThis.fetch = async (input) => {
    url = String(input);
    return new Response(JSON.stringify(view()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    session.view = view();
    const { navigateTo } = await import("./ui/router");
    navigateTo("messages");
    for (let i = 0; i < 8 && url === ""; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.match(url, /page=messages/);
  } finally {
    win.location = previousLocation;
    win.history = previousHistory;
    globalThis.fetch = original;
  }
});
