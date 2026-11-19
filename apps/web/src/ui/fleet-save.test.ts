import "../test-dom";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createUniverse,
  FLEET_SAVE_MIN_LEAD_MS,
  joinUniverse,
  playerView,
  type FleetMission,
  type PlayerView,
} from "@starhold/game";
import { doDismissFleetSave } from "../main-actions-fleet";
import { doOpenFleetSave } from "../main-actions-session";
import { root, session, setPaintImpl } from "../session";
import {
  dismissFleetSave,
  resetFleetSaveDismissals,
} from "./fleet-save-dismiss";
import { fleetComposer } from "./render-fleets-composer";
import {
  blankFleetDraft,
  fleetDraftForFleetSave,
} from "./render-fleets-draft";
import { fleetDraftForPage } from "./render-app";
import { eventsBannerHtml } from "./render-events";

const NOW = 1_700_000_000_000;

function fleet(id: string): FleetMission {
  return {
    id,
    ownerPlayerId: "npc_pirates",
    originPlanetId: "",
    originPirateBaseId: "pir-1",
    targetPlanetId: "home",
    targetPlayerId: "p1",
    targetCoords: { galaxy: 1, system: 2, slot: 4 },
    mission: "raid",
    ships: {},
    cargo: { metal: 0, crystal: 0, deuterium: 0 },
    departedAt: NOW,
    arrivesAt: NOW + 120_000,
    phase: "outbound",
    reportId: null,
  };
}

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: NOW,
    player: { id: "p1", name: "Saver", research: {}, researchQueue: [] },
    planet: {
      id: "home",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 2, slot: 4 },
      ships: { scout: 4 },
      resources: { metal: 0, crystal: 0, deuterium: 500 },
      buildings: {},
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    },
    universe: { id: "u", name: "U", speed: 1, fleetSpeed: 1 },
    ownedPlanets: [
      {
        id: "home",
        name: "Home",
        coords: { galaxy: 1, system: 2, slot: 4 },
        isHome: true,
        isActive: true,
        isMoon: false,
        isMini: false,
        jumpGateLevel: 0,
        researchLab: 0,
      },
    ],
    galaxy: { galaxy: 1, system: 2, slots: [] },
    fleets: [],
    fleetSlotCap: 1,
    expeditionSlotCap: 1,
    roster: [],
    hostileInbound: [],
    ...overrides,
  } as PlayerView;
}

afterEach(() => {
  resetFleetSaveDismissals();
  session.view = null;
  session.pendingFleetSaveDraft = null;
  session.busy = false;
  session.error = null;
  session.notice = null;
  session.activePage = "overview";
  setPaintImpl(() => {});
});

describe("fleet save reminder", () => {
  it("renders Send fleet away on the strip and hides a dismissed or imminent attack", () => {
    const inbound = fleet("raid-9");
    const html = eventsBannerHtml(
      view({
        hostileInbound: [inbound],
        fleetSave: [
          {
            attackId: "raid-9",
            originPlanetId: "home",
            mission: "deploy",
            ships: { scout: 4 },
            targetPlanetId: "colony",
            targetCoords: null,
            arrivesAt: inbound.arrivesAt,
          },
        ],
      }),
      NOW,
    );
    assert.match(html, /data-testid="fleet-save-raid-9"/);
    assert.match(html, /Send fleet away/);
    assert.match(html, /data-testid="fleet-save-dismiss-raid-9"/);
    assert.match(html, /data-testid="event-soonest"/);

    dismissFleetSave("raid-9");
    const hidden = eventsBannerHtml(
      view({
        hostileInbound: [inbound],
        fleetSave: [
          {
            attackId: "raid-9",
            originPlanetId: "home",
            mission: "deploy",
            ships: { scout: 4 },
            targetPlanetId: "colony",
            targetCoords: null,
            arrivesAt: inbound.arrivesAt,
          },
        ],
      }),
      NOW,
    );
    assert.doesNotMatch(hidden, /fleet-save-raid-9/);

    const late = eventsBannerHtml(
      view({
        hostileInbound: [inbound],
        fleetSave: [
          {
            attackId: "raid-9",
            originPlanetId: "home",
            mission: "deploy",
            ships: { scout: 4 },
            targetPlanetId: "colony",
            targetCoords: null,
            arrivesAt: inbound.arrivesAt,
          },
        ],
      }),
      inbound.arrivesAt - FLEET_SAVE_MIN_LEAD_MS,
    );
    assert.doesNotMatch(late, /Send fleet away/);
  });

  it("prefills deploy on the fleet page and does not send", () => {
    const draft = fleetDraftForFleetSave({
      mission: "deploy",
      ships: { scout: 4, cruiser: 1 },
      targetPlanetId: "colony",
      targetCoords: null,
    });
    assert.equal(draft.mission, "deploy");
    assert.equal(draft.step, 2);
    assert.equal(draft.targetPlanetId, "colony");
    assert.deepEqual(draft.counts, { scout: 4, cruiser: 1 });

    session.pendingFleetSaveDraft = draft;
    const consumed = fleetDraftForPage(root, "fleet");
    assert.equal(consumed?.targetPlanetId, "colony");
    assert.equal(session.pendingFleetSaveDraft, null);
    assert.equal(fleetDraftForPage(root, "overview"), null);
  });

  it("offers an expedition to deep space and labels the ambush", () => {
    const draft = fleetDraftForFleetSave({
      mission: "expedition",
      ships: { scout: 2 },
      targetPlanetId: null,
      targetCoords: { galaxy: 1, system: 2, slot: 16 },
    });
    const html = fleetComposer(view(), false, draft);
    assert.match(html, /Deep space 1:2:16/);
    assert.match(html, /value="coords:1:2:16" selected/);
    assert.match(html, /value="2" data-fleet-count="scout"/);
    assert.match(html, /data-testid="fleet-send-review"/);
    assert.equal(draft.mission, "expedition");
    assert.equal(draft.step, 2);
    const banner = eventsBannerHtml(
      view({
        hostileInbound: [fleet("raid-9")],
        fleetSave: [
          {
            attackId: "raid-9",
            originPlanetId: "home",
            mission: "expedition",
            ships: { scout: 2 },
            targetPlanetId: null,
            targetCoords: { galaxy: 1, system: 2, slot: 16 },
            arrivesAt: NOW + 120_000,
          },
        ],
      }),
      NOW,
    );
    assert.match(banner, /data-testid="fleet-save-raid-9"/);
    assert.match(banner, /data-testid="fleet-save-note-raid-9"/);
    assert.match(banner, /Expedition\. Expeditions can meet ambushes\./);
    assert.deepEqual(blankFleetDraft().counts, {});
  });

  it("shows no button when a one-world commander cannot send an expedition", () => {
    const universe = createUniverse("No Expedition Slot", 8);
    const joined = joinUniverse(universe, "Solo", NOW);
    joined.planet.ships.scout = 3;
    const home = joined.planet;
    universe.fleets.out = {
      id: "out",
      ownerPlayerId: joined.player.id,
      originPlanetId: home.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...home.coords, slot: 16 },
      mission: "expedition",
      ships: {},
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: NOW,
      arrivesAt: NOW + 90_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets.incoming = {
      id: "incoming",
      ownerPlayerId: "npc_pirates",
      originPlanetId: "",
      originPirateBaseId: "pir-1",
      targetPlanetId: home.id,
      targetPlayerId: joined.player.id,
      targetCoords: { ...home.coords },
      mission: "raid",
      ships: {},
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: NOW,
      arrivesAt: NOW + 120_000,
      phase: "outbound",
      reportId: null,
    };
    const seen = playerView(universe, joined.player.id, NOW);
    const html = eventsBannerHtml(seen, seen.now);
    assert.match(html, /Hostile incoming/);
    assert.equal(seen.fleetSave, undefined);
    assert.doesNotMatch(html, /data-testid="fleet-save-/);
    assert.doesNotMatch(html, /Send fleet away/);
  });

  it("opens the fleet page from the reminder without launching", async () => {
    Object.assign(window, {
      location: {
        href: "http://starhold.local/overview",
        pathname: "/overview",
        search: "",
        hash: "",
      },
      history: { pushState() {}, replaceState() {} },
    });
    session.view = view({
      fleetSave: [
        {
          attackId: "raid-9",
          originPlanetId: "home",
          mission: "deploy",
          ships: { scout: 4 },
          targetPlanetId: "colony",
          targetCoords: null,
          arrivesAt: NOW + 120_000,
        },
      ],
    });
    session.activePage = "overview";
    await doOpenFleetSave("raid-9");
    assert.equal(session.activePage, "fleet");
    assert.equal(session.pendingFleetSaveDraft?.mission, "deploy");
    assert.equal(session.pendingFleetSaveDraft?.targetPlanetId, "colony");
    assert.deepEqual(session.pendingFleetSaveDraft?.counts, { scout: 4 });
    assert.match(session.notice ?? "", /Review the save/);
    doDismissFleetSave("raid-9");
    assert.equal(
      eventsBannerHtml(
        view({
          hostileInbound: [fleet("raid-9")],
          fleetSave: session.view.fleetSave,
        }),
        NOW,
      ).includes("fleet-save-raid-9"),
      false,
    );
  });
});
