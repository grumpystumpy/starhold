import "./test-dom";
import assert from "node:assert/strict";
import { after, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { NOT_APPLIED_MESSAGE } from "./api";

const {
  doChangeClass,
  doChooseClass,
  doClaimDaily,
  doClaimGoal,
} = await import("./main-actions-starshards");
const { doSaveFleetPreset, doDeleteFleetPreset } = await import("./main-actions-fleet");
const { doRenamePlanet, doRelocateFortress } = await import("./main-actions-session");
const { root, session, setPaintImpl } = await import("./session");
const originalWindowSetTimeout = window.setTimeout;
const originalWindowClearTimeout = window.clearTimeout;
window.setTimeout = (() => 0) as typeof window.setTimeout;
window.clearTimeout = (() => {}) as typeof window.clearTimeout;
after(() => {
  window.setTimeout = originalWindowSetTimeout;
  window.clearTimeout = originalWindowClearTimeout;
});

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", research: {}, researchQueue: [] },
    planet: {
      id: "pl1",
      name: "Home",
      coords: { galaxy: 1, system: 4, slot: 1 },
      buildings: {},
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    galaxy: { galaxy: 1, system: 4 },
    fleets: [],
    ...overrides,
  } as unknown as PlayerView;
}

async function runFailedPost(action: () => Promise<void>, initial: PlayerView, refreshed: PlayerView) {
  session.view = initial;
  session.busy = false;
  session.error = null;
  session.notice = null;
  setPaintImpl(() => {});
  let posts = 0;
  let states = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).includes("/api/state")) {
      states += 1;
      return new Response(JSON.stringify(refreshed), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    posts += 1;
    return new Response("<html>Worker error</html>", { status: 503 });
  };
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(posts, 1);
  assert.equal(states, 1);
}

it("settles a daily claim after a 503 when the refreshed view shows it applied", async () => {
  const initial = view();
  const refreshed = view({
    player: { ...initial.player, lastDailyLoginUtc: "2026-10-19" },
  });
  await runFailedPost(doClaimDaily, initial, refreshed);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Daily Starshards claimed.");
  assert.deepEqual(session.view, refreshed);
});

it("reports a daily claim was not applied after a 503 when refreshed state is unchanged", async () => {
  const initial = view();
  await runFailedPost(doClaimDaily, initial, view());
  assert.equal(session.error, NOT_APPLIED_MESSAGE);
});

it("settles a goal claim when the refreshed player marks that goal claimed", async () => {
  const initial = view({
    goals: [{ id: "build", title: "Build", claimed: false }],
  } as Partial<PlayerView>);
  const refreshed = view({
    player: {
      ...initial.player,
      goals: { dailyKey: "2026-10-19", weeklyKey: "2026-W43", progress: {}, claimed: ["build"] },
    },
  });
  await runFailedPost(() => doClaimGoal("build"), initial, refreshed);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Claimed Build.");
});

it("settles choosing and changing class from the refreshed class id", async () => {
  const initial = view();
  const chosen = view({
    player: { ...initial.player, playerClass: { classId: "miner" } },
  });
  await runFailedPost(() => doChooseClass("miner"), initial, chosen);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Class chosen.");

  const changed = view({
    player: { ...initial.player, playerClass: { classId: "explorer" } },
  });
  await runFailedPost(() => doChangeClass("explorer"), initial, changed);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Class changed.");
});

it("settles a planet rename and fortress relocation from refreshed planet state", async () => {
  const initial = view();
  const renamed = view({ planet: { ...initial.planet, name: "New Home" } });
  await runFailedPost(() => doRenamePlanet("New Home"), initial, renamed);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Colony renamed to New Home.");

  const relocated = view({
    planet: { ...initial.planet, coords: { galaxy: 2, system: 8, slot: 1 } },
  });
  await runFailedPost(() => doRelocateFortress(2, 8), initial, relocated);
  assert.equal(session.error, null);
  assert.equal(session.notice, "Moving Fortress landed at 2:8:1.");
});

it("settles saving a new fleet preset when the refreshed view contains the preset", async () => {
  const initial = view();
  const refreshed = view({
    player: {
      ...initial.player,
      fleetPresets: [{ id: "custom-1", name: "Raid", intent: "custom", ships: {} }],
    },
  });
  const originalQuery = root.querySelector;
  root.querySelector = ((selector: string) => {
    if (selector === "#fleet-form") return { querySelector: () => null };
    if (selector === "#fleet-preset-name") return { value: "Raid" };
    if (selector === "#fleet-preset") return { value: "" };
    return null;
  }) as typeof root.querySelector;
  try {
    await runFailedPost(doSaveFleetPreset, initial, refreshed);
  } finally {
    root.querySelector = originalQuery;
  }
  assert.equal(session.error, null);
  assert.equal(session.notice, "Saved preset “Raid”.");
});

it("settles deleting a fleet preset when it is absent from the refreshed view", async () => {
  const initial = view({
    player: {
      id: "p1",
      research: {},
      researchQueue: [],
      fleetPresets: [{ id: "custom-1", name: "Raid", intent: "custom", ships: {} }],
    },
  });
  const refreshed = view();
  const originalQuery = root.querySelector;
  root.querySelector = ((selector: string) =>
    selector === "#fleet-preset" ? { value: "custom-1" } : null
  ) as typeof root.querySelector;
  try {
    await runFailedPost(doDeleteFleetPreset, initial, refreshed);
  } finally {
    root.querySelector = originalQuery;
  }
  assert.equal(session.error, null);
  assert.equal(session.notice, "Deleted preset “Raid”.");
});
