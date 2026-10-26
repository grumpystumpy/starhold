import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FleetMission, PlayerView } from "@starhold/game";
import {
  eventPresentation,
  eventsBannerHtml,
  formatEventCountdown,
  startEventsCountdown,
  stopEventsCountdown,
  watchFleetLaunches,
} from "./render-events";

function fleet(overrides: Partial<FleetMission> = {}): FleetMission {
  return {
    id: "f1",
    ownerPlayerId: "p1",
    originPlanetId: "home",
    targetPlanetId: null,
    targetPlayerId: null,
    targetCoords: { galaxy: 1, system: 4, slot: 8 },
    mission: "raid",
    ships: {},
    cargo: { metal: 0, crystal: 0, deuterium: 0 },
    departedAt: 1_700_000_000_000,
    arrivesAt: 1_700_000_060_000,
    phase: "outbound",
    reportId: null,
    ...overrides,
  };
}

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1" } as PlayerView["player"],
    planet: {} as PlayerView["planet"],
    ownedPlanets: [
      {
        id: "home",
        coords: { galaxy: 1, system: 2, slot: 3 },
      },
    ] as PlayerView["ownedPlanets"],
    fleets: [],
    hostileInbound: [],
    roster: [],
    ...overrides,
  } as PlayerView;
}

afterEach(() => {
  stopEventsCountdown();
});

describe("events banner", () => {
  it("formats a compact, non-negative countdown", () => {
    assert.equal(formatEventCountdown(1_700_000_061_000, 1_700_000_000_000), "1m 01s");
    assert.equal(formatEventCountdown(1_700_000_000_000, 1_700_000_001_000), "0s");
  });

  it("assigns outgoing, returning, and hostile incoming presentation", () => {
    assert.equal(eventPresentation(fleet(), false).className, "event-outgoing");
    assert.equal(
      eventPresentation(fleet({ phase: "returning" }), false).className,
      "event-returning",
    );
    assert.equal(eventPresentation(fleet(), true).className, "event-hostile");
  });

  it("renders own fleet route, arrival countdown, and a blank jump target", () => {
    const html = eventsBannerHtml(
      view({
        fleets: [
          fleet(),
          fleet({ id: "returning", phase: "returning" }),
          fleet({ id: "jump", mission: "jump", targetCoords: { galaxy: 1, system: 9, slot: 0 } }),
        ],
      }),
      1_700_000_000_000,
    );

    assert.match(html, /data-testid="events-banner"/);
    assert.match(html, /data-testid="events-dropdown"/);
    assert.match(html, /data-testid="events-dropdown-summary"/);
    assert.match(html, /data-testid="event-soonest"/);
    assert.match(html, /data-testid="events-dropdown-list"/);
    assert.match(html, /coord-link/);
    assert.match(html, /1:2:3/);
    assert.match(html, /1:4:8/);
    assert.match(html, /event-outgoing/);
    assert.match(html, /event-returning/);
    assert.match(html, /Raid/);
    assert.match(html, /data-event-countdown/);
    assert.match(html, /Jump/);
    assert.doesNotMatch(html, /1:9:0/);
  });

  it("refetches once when a fleet arrives, despite repeated timer ticks", () => {
    const countdown = { textContent: "" };
    const fleetRow = {
      dataset: { eventId: "f1", eventArrivesAt: "1700000001000" },
      querySelector: () => countdown,
    };
    let tick: (() => void) | undefined;
    let refreshes = 0;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNow = Date.now;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setInterval: (callback: () => void) => {
          tick = callback;
          return 7;
        },
        clearInterval: () => {},
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => [fleetRow] },
    });
    Date.now = () => 1_700_000_000_000;

    try {
      startEventsCountdown(view({ fleets: [fleet()] }), () => {
        refreshes += 1;
      });
      assert.ok(tick);
      tick();
      Date.now = () => 1_700_000_001_000;
      tick();
      tick();
      assert.equal(countdown.textContent, "0s");
      assert.equal(refreshes, 1);
    } finally {
      Date.now = originalNow;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("refetches only once when a new owned fleet is observed", () => {
    const initial = view();
    const refresh = { calls: 0 };
    const notify = () => {
      refresh.calls += 1;
    };

    watchFleetLaunches(initial, notify);
    const launched = view({ fleets: [fleet()] });
    watchFleetLaunches(launched, notify);
    watchFleetLaunches(launched, notify);

    assert.equal(refresh.calls, 1);
  });
});
