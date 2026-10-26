import "./test-dom";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import type { BuildQueueItem, DefenseQueueItem, PlayerView, ResearchQueueItem, ShipQueueItem } from "@starhold/game";

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

it("shows exact completion notices when research, ship, and defense items finish", async () => {
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
    assert.equal(session.notice, "Research complete: Power Discipline → level 5");

    // Advance to ship completion
    await advanceBy(1_000);
    assert.equal(session.notice, "Shipyard: Interceptor × 10 finished");

    // Advance to defense completion
    await advanceBy(1_000);
    assert.equal(session.notice, "Defense: Light Laser × 4 finished");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("does not repeat completion notice on subsequent poll or reload", async () => {
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
    assert.equal(session.notice, "Research complete: Power Discipline → level 5");

    // Clear notice as if user or timer cleared flash
    session.notice = null;

    // Trigger another background refresh/poll
    const { silentRefresh } = await import("./main-actions-session");
    await silentRefresh("p1");

    // Notice should NOT reappear
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
