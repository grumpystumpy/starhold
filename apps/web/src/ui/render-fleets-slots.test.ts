import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FleetMission, PlayerView } from "@starhold/game";
import { fleetComposer, fleetSlotCaps } from "./render-fleets-composer";

function makeView(overrides?: Partial<PlayerView>): PlayerView {
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
    alliance: null,
    openAcsGroups: [],
    ...overrides,
  } as unknown as PlayerView;
}

function makeFleet(id: string, mission: string): FleetMission {
  return {
    id,
    ownerPlayerId: "p1",
    mission,
    phase: "outbound",
    arrivesAt: 1_700_000_060_000,
    originCoords: { galaxy: 1, system: 1, slot: 8 },
    targetCoords: { galaxy: 1, system: 1, slot: 16 },
    ships: { scout: 1 },
  } as unknown as FleetMission;
}

describe("Fleet slot counters (B5-07 / STA-48)", () => {
  it("computes default slot caps for starter commander (1 fleet, 1 expedition)", () => {
    const view = makeView();
    const caps = fleetSlotCaps(view.player, view.now);
    assert.equal(caps.fleetCap, 1);
    assert.equal(caps.expeditionCap, 1);
  });

  it("computes fleet cap including Computer Tech, class bonus, and officer boosts", () => {
    const view = makeView({
      player: {
        id: "p1",
        name: "Commander",
        research: { computerTech: 4, astrophysics: 2 },
        playerClass: {
          classId: "fleeter",
          chosenAt: 1,
          changeCount: 1,
          lastChangeAt: 1,
        },
        officers: [
          {
            officerId: "navigator",
            hiredAt: 1,
            expiresAt: 1_800_000_000_000,
          },
        ],
        fleetPresets: [],
      },
    });
    const caps = fleetSlotCaps(view.player, view.now);
    // Computer Tech 4 -> 5; Fleeter -> +1; Navigator -> +1 = 7 fleet slots
    assert.equal(caps.fleetCap, 7);
    // Astrophysics 2 -> 3; Fleeter -> +0 = 3 expedition slots
    assert.equal(caps.expeditionCap, 3);
  });

  it("computes expedition cap including Explorer class bonus", () => {
    const view = makeView({
      player: {
        id: "p1",
        name: "Explorer",
        research: { computerTech: 1, astrophysics: 3 },
        playerClass: {
          classId: "explorer",
          chosenAt: 1,
          changeCount: 1,
          lastChangeAt: 1,
        },
        fleetPresets: [],
      },
    });
    const caps = fleetSlotCaps(view.player, view.now);
    // Computer Tech 1 -> 2; Explorer -> +0 = 2 fleet slots
    assert.equal(caps.fleetCap, 2);
    // Astrophysics 3 -> 4; Explorer -> +1 = 5 expedition slots
    assert.equal(caps.expeditionCap, 5);
  });

  it("renders used and max counters for fleets and expeditions on the Fleet tab", () => {
    const view = makeView({
      player: {
        id: "p1",
        name: "Commander",
        research: { computerTech: 4, astrophysics: 2 },
        playerClass: {
          classId: "fleeter",
          chosenAt: 1,
          changeCount: 1,
          lastChangeAt: 1,
        },
        officers: [
          {
            officerId: "navigator",
            hiredAt: 1,
            expiresAt: 1_800_000_000_000,
          },
        ],
        fleetPresets: [],
      },
      fleets: [
        makeFleet("f1", "deploy"),
        makeFleet("f2", "expedition"),
        makeFleet("f3", "raid"),
      ],
    });

    const html = fleetComposer(view, false, null);

    // Fleet tab shows fleet slots used/max (3/7) and expedition slots used/max (1/3)
    assert.match(html, /Fleets 3\/7/);
    assert.match(html, /Expeditions 1\/3/);
    assert.match(html, /data-testid="fleet-slot-counters"/);
  });

  it("renders 0/1 for fresh player with no fleets launched", () => {
    const view = makeView();
    const html = fleetComposer(view, false, null);
    assert.match(html, /Fleets 0\/1/);
    assert.match(html, /Expeditions 0\/1/);
  });
});
