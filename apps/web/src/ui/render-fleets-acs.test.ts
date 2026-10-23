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
    view.fleetSlotCap = 6;
    view.expeditionSlotCap = 3;
    const withBeacon = fleetComposer(view, false, null);
    assert.match(withBeacon, /Fleets 2\/6 · Expeditions 1\/3/);
  });
});

describe("newbie protection launch warning", () => {
  it("warns protected players before attacking another player, but not spying or raiding pirates", () => {
    const view = fleetView();
    view.roster = [
      {
        id: "p1",
        name: "Alpha",
        planetId: "pl1",
        pointsHint: 100,
        coords: { galaxy: 1, system: 1, slot: 8 },
      },
      {
        id: "p2",
        name: "Rival",
        planetId: "pl2",
        pointsHint: 3000,
        coords: { galaxy: 1, system: 1, slot: 9 },
      },
    ] as PlayerView["roster"];

    const raid = fleetComposer(view, false, {
      targetPlanetId: "pl2",
      targetCoords: null,
      asteroidId: null,
      pirateBaseId: null,
      alienBaseId: null,
      mission: "raid",
      counts: {},
      cargo: {},
      openAcs: false,
    });
    assert.match(raid, /Launching this attack ends your newbie protection/);

    const spy = fleetComposer(view, false, {
      targetPlanetId: "pl2",
      targetCoords: null,
      asteroidId: null,
      pirateBaseId: null,
      alienBaseId: null,
      mission: "espionage",
      counts: {},
      cargo: {},
      openAcs: false,
    });
    assert.doesNotMatch(spy, /ends your newbie protection/);

    view.galaxy = {
      ...view.galaxy,
      pirateBase: {
        id: "pirate1",
        name: "Pirates",
        coords: { galaxy: 1, system: 1, slot: 1 },
        tier: 1,
        level: 1,
        threatHint: "low",
      },
    } as PlayerView["galaxy"];
    const pirateRaid = fleetComposer(view, false, {
      targetPlanetId: null,
      targetCoords: null,
      asteroidId: null,
      pirateBaseId: "pirate1",
      alienBaseId: null,
      mission: "pirateRaid",
      counts: {},
      cargo: {},
      openAcs: false,
    });
    assert.doesNotMatch(pirateRaid, /ends your newbie protection/);
  });
});
