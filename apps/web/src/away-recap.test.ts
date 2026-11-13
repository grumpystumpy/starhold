import "./test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventLogEntry, PlayerView } from "@starhold/game";
import {
  awayRecapCounts,
  awayRecapIsEmpty,
  bindAwayRecapHide,
  lastVisitKey,
  readLastVisit,
  visitStamp,
  writeLastVisit,
  type VisitStorage,
} from "./away-recap";
import { pageHtml } from "./ui/render-pages";

function memoryStorage(): VisitStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => (rows.has(key) ? rows.get(key)! : null),
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

function entry(
  kind: EventLogEntry["kind"],
  createdAt: number,
  id: string,
): EventLogEntry {
  return {
    id,
    kind,
    createdAt,
    readAt: null,
    title: kind,
    body: kind,
  };
}

function viewWith(partial: {
  eventLog?: EventLogEntry[];
  reports?: PlayerView["reports"];
  spyReports?: PlayerView["spyReports"];
  expeditionReports?: PlayerView["expeditionReports"];
} = {}): PlayerView {
  return {
    player: {
      id: "p1",
      name: "Commander",
      cosmetics: {},
      research: {},
      eventLog: partial.eventLog ?? [],
    },
    planet: {
      id: "pl1",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 1 },
      buildings: { metalMine: 1 },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
    economy: {
      fields: { used: 1, cap: 100, remaining: 99 },
      positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
      productionPerHour: { metal: 100, crystal: 50, deuterium: 20 },
      energy: { factor: 1, produced: 100, used: 50 },
    },
    goals: [],
    reports: partial.reports ?? [],
    spyReports: partial.spyReports ?? [],
    expeditionReports: partial.expeditionReports ?? [],
  } as unknown as PlayerView;
}

describe("away recap counts", () => {
  it("counts newer fleet returns, raids, minis, and reports", () => {
    const view = viewWith({
      eventLog: [
        entry("fleetReturn", 100, "a"),
        entry("fleetReturn", 250, "b"),
        entry("raidAlert", 300, "c"),
        entry("miniNearby", 400, "d"),
        entry("buildComplete", 500, "e"),
        entry("fleetReturn", 50, "old"),
      ],
      reports: [{ id: "r1", at: 220 }, { id: "r0", at: 10 }] as PlayerView["reports"],
      spyReports: [{ id: "s1", at: 230 }] as PlayerView["spyReports"],
      expeditionReports: [{ id: "e1", at: 180 }] as PlayerView["expeditionReports"],
    });
    const counts = awayRecapCounts(view, 200);
    assert.deepEqual(counts, {
      fleetReturns: 1,
      raids: 1,
      minis: 1,
      unreadReports: 2,
    });
    assert.equal(awayRecapIsEmpty(counts), false);
  });

  it("is empty when nothing is newer than the last visit", () => {
    const view = viewWith({
      eventLog: [entry("fleetReturn", 100, "a"), entry("buildComplete", 900, "b")],
      reports: [{ id: "r1", at: 100 }] as PlayerView["reports"],
    });
    const counts = awayRecapCounts(view, 900);
    assert.deepEqual(counts, {
      fleetReturns: 0,
      raids: 0,
      minis: 0,
      unreadReports: 0,
    });
    assert.equal(awayRecapIsEmpty(counts), true);
  });

  it("treats a missing log and a bad stamp as nothing stored", () => {
    const view = viewWith({});
    assert.equal(awayRecapIsEmpty(awayRecapCounts(view, 0)), true);
    const storage = memoryStorage();
    storage.setItem(lastVisitKey("p1"), "nope");
    assert.equal(readLastVisit(storage, "p1"), 0);
    assert.equal(readLastVisit(storage, ""), 0);
    writeLastVisit(storage, "p1", 4_200.8);
    assert.equal(storage.getItem(lastVisitKey("p1")), "4200");
    writeLastVisit(storage, "p2", 9);
    assert.equal(storage.getItem(lastVisitKey("p2")), "9");
    assert.equal(storage.getItem(lastVisitKey("p1")), "4200");
    assert.equal(visitStamp(100, 250), 250);
    assert.equal(visitStamp(300, 100), 300);
    assert.equal(visitStamp(Number.NaN, null), 0);
  });
});

describe("away recap on overview", () => {
  it("renders a dismissible recap and hides it after the visit is stamped", () => {
    const previous = globalThis.localStorage;
    const storage = memoryStorage();
    globalThis.localStorage = storage as unknown as Storage;
    try {
      const view = viewWith({
        eventLog: [
          entry("fleetReturn", 300, "a"),
          entry("fleetReturn", 320, "b"),
          entry("raidAlert", 330, "c"),
          entry("miniNearby", 340, "d"),
          entry("buildComplete", 350, "e"),
        ],
        reports: [{ id: "r1", at: 310 }] as PlayerView["reports"],
        spyReports: [{ id: "s1", at: 315 }] as PlayerView["spyReports"],
        expeditionReports: [{ id: "x1", at: 10 }] as PlayerView["expeditionReports"],
      });

      const html = pageHtml("overview", view, false, null);
      assert.match(html, /data-testid="away-recap"/);
      assert.match(html, /While you were away/);
      assert.match(html, /data-testid="away-recap-fleets">2 fleets returned/);
      assert.match(html, /data-testid="away-recap-raids">1 raid</);
      assert.match(html, /data-testid="away-recap-minis">1 mini planet nearby/);
      assert.match(html, /data-testid="away-recap-unread">3 unread reports/);
      assert.match(html, /data-nav="messages"/);
      assert.match(html, /data-testid="away-recap-dismiss"/);
      assert.doesNotMatch(html, /buildComplete/);

      writeLastVisit(storage, "p1", 400);
      const hidden = pageHtml("overview", view, false, null);
      assert.doesNotMatch(hidden, /data-testid="away-recap"/);

      writeLastVisit(storage, "p1", 1_000);
      const current = viewWith({
        eventLog: [entry("miniNearby", 100, "a")],
      });
      const quiet = pageHtml("overview", current, false, null);
      assert.doesNotMatch(quiet, /data-testid="away-recap"/);
      assert.match(quiet, /data-testid="overview-panel"/);
    } finally {
      globalThis.localStorage = previous;
    }
  });
});

describe("away recap page hide", () => {
  it("writes the stamp only when the page is hidden and a commander is signed in", () => {
    const storage = memoryStorage();
    let player: string | null = "p1";
    let clock = 8_000;
    let handler: (() => void) | null = null;
    const doc = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener(_type: string, fn: () => void) {
        handler = fn;
      },
    };
    bindAwayRecapHide(
      doc as unknown as Document,
      storage,
      () => player,
      () => clock,
    );
    assert.ok(handler);
    handler!();
    assert.equal(storage.getItem(lastVisitKey("p1")), null);

    doc.visibilityState = "hidden";
    handler!();
    assert.equal(storage.getItem(lastVisitKey("p1")), "8000");

    player = null;
    clock = 9_000;
    handler!();
    assert.equal(storage.getItem(lastVisitKey("p1")), "8000");

    bindAwayRecapHide(
      doc as unknown as Document,
      storage,
      () => "p9",
      () => 1,
    );
    doc.visibilityState = "hidden";
    handler!();
    assert.equal(storage.getItem(lastVisitKey("p9")), null);
  });
});
