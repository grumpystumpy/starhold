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
