import "./test-dom";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import type { PlayerView } from "@starhold/game";

const { stopPolling } = await import("./main-actions-session");
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
  buildQueue?: { completesAt: number }[];
  researchQueue?: { completesAt: number }[];
  shipQueue?: { completesAt: number }[];
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
      defenseQueue: [],
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
