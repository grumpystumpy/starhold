import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { collectInbox, messagesPageHtml } from "./render-messages";

function baseView(
  overrides: Partial<PlayerView> = {},
): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", name: "Alpha" } as PlayerView["player"],
    planet: { id: "pl1" } as PlayerView["planet"],
    reports: [],
    spyReports: [],
    expeditionReports: [],
    ...overrides,
  } as PlayerView;
}

describe("messages inbox", () => {
  it("merges report kinds newest-first", () => {
    const view = baseView({
      reports: [
        {
          id: "c1",
          at: 100,
          missionId: "m1",
          attackerPlayerId: "p1",
          defenderPlayerId: "p2",
          attackerName: "Alpha",
          defenderName: "Bravo",
          targetCoords: { galaxy: 1, system: 1, slot: 8 },
          attackerBefore: {},
          attackerAfter: {},
          defenderBefore: {},
          defenderAfter: {},
          defensesBefore: {},
          defensesAfter: {},
          loot: { metal: 10, crystal: 0, deuterium: 0 },
          debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
          outcome: "attacker_win",
          rounds: 2,
          summary: "Raid won",
        },
      ] as PlayerView["reports"],
      spyReports: [
        {
          id: "s1",
          at: 200,
          missionId: "m2",
          spyPlayerId: "p1",
          targetPlayerId: "p2",
          targetName: "Bravo",
          targetCoords: { galaxy: 1, system: 2, slot: 4 },
          detail: 3,
          resources: { metal: 1, crystal: 2, deuterium: 3 },
          buildings: null,
          ships: null,
          defenses: null,
          research: null,
          summary: "Probes returned",
        },
      ] as PlayerView["spyReports"],
      expeditionReports: [
        {
          id: "e1",
          at: 150,
          missionId: "m3",
          playerId: "p1",
          targetCoords: { galaxy: 1, system: 1, slot: 16 },
          kind: "resources",
          cargoGained: { metal: 5, crystal: 0, deuterium: 0 },
          shipsDelta: {},
          summary: "Found scrap",
        },
      ] as PlayerView["expeditionReports"],
    });

    const items = collectInbox(view);
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((i) => i.kind),
      ["espionage", "expedition", "combat"],
    );
    assert.equal(items[0].id, "s1");
  });

  it("renders panel and empty state", () => {
    const empty = messagesPageHtml(baseView());
    assert.match(empty, /data-testid="messages-panel"/);
    assert.match(empty, /data-testid="messages-empty"/);
    assert.doesNotMatch(empty, /messages-stub/);

    const filled = messagesPageHtml(
      baseView({
        expeditionReports: [
          {
            id: "e9",
            at: 50,
            missionId: "m9",
            playerId: "p1",
            targetCoords: { galaxy: 2, system: 3, slot: 16 },
            kind: "nothing",
            cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
            shipsDelta: {},
            summary: "Empty void",
          },
        ] as PlayerView["expeditionReports"],
      }),
    );
    assert.match(filled, /data-testid="messages-inbox"/);
    assert.match(filled, /message-expedition-e9/);
    assert.match(filled, /Empty void/);
  });
});
