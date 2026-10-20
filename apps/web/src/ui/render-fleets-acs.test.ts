import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { fleetComposer } from "./render-fleets-composer";
import { fleetDraftWithAcsPrefill } from "./render-fleets-draft";

function fleetView(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Alpha",
      research: {},
      fleetPresets: [],
    },
    planet: {
      id: "pl1",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 8 },
      ships: {},
      buildings: {},
    },
    roster: [],
    ownedPlanets: [],
    galaxy: {
      galaxy: 1,
      system: 1,
      slots: [],
      asteroids: [],
    },
    fleets: [],
    fleetSlotCap: 5,
    expeditionSlotCap: 2,
    universe: { speed: 1, fleetSpeed: 1 },
    alliance: { id: "ally_1", tag: "SOL" },
    openAcsGroups: [],
  } as unknown as PlayerView;
}

describe("Joint Strike fleet prefill", () => {
  it("arms raid, target coords, and Open ACS before the form exists", () => {
    const draft = fleetDraftWithAcsPrefill(null, {
      coords: { galaxy: 1, system: 1, slot: 1 },
      mission: "raid",
      note: "",
      openAcs: true,
    });
    const html = fleetComposer(fleetView(), false, draft);
    assert.match(html, /data-testid="mission-raid"[^>]*checked/);
    assert.match(html, /value="coords:1:1:1" selected/);
    assert.match(html, /data-testid="fleet-open-acs"[^>]*checked/);
  });
});

describe("fleet slot counters", () => {
  it("shows server expedition cap with and without the beacon bonus", () => {
    const view = fleetView();
    view.fleets = [
      { id: "f1", mission: "expedition" },
      { id: "f2", mission: "deploy" },
    ] as unknown as PlayerView["fleets"];
    const noBeacon = fleetComposer(view, false, null);
    assert.match(noBeacon, /Fleets 2\/5 · Expeditions 1\/2/);
    view.expeditionSlotCap = 3;
    const withBeacon = fleetComposer(view, false, null);
    assert.match(withBeacon, /Fleets 2\/5 · Expeditions 1\/3/);
  });
});
