import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { collectInbox, messagesPageHtml } from "./render-messages";

function baseView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Alpha",
      eventLog: [],
    } as PlayerView["player"],
    planet: { id: "pl1" } as PlayerView["planet"],
    reports: [],
    spyReports: [],
    expeditionReports: [],
    ...overrides,
  } as PlayerView;
}

describe("messages inbox", () => {
  it("merges reports and alerts newest-first", () => {
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
          targetCoords: { galaxy: 1, system: 22, slot: 8 },
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
          at: 300,
          missionId: "m2",
          spyPlayerId: "p1",
          targetPlayerId: "p2",
          targetName: "Bravo",
          targetCoords: { galaxy: 1, system: 22, slot: 9 },
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
      player: {
        id: "p1",
        name: "Alpha",
        eventLog: [
          {
            id: "evt1",
            kind: "buildComplete",
            createdAt: 250,
            readAt: null,
            title: "Ore Extractor → level 12",
            body: "Finished on Home.",
          },
          {
            id: "evt2",
            kind: "fleetReturn",
            createdAt: 50,
            readAt: 400,
            title: "Fleet returned to Home",
            body: "deploy · 2× Scout Skiff",
          },
        ],
      } as PlayerView["player"],
    });

    const items = collectInbox(view);
    assert.deepEqual(
      items.map((item) => item.kind),
      ["spy", "buildComplete", "expedition", "combat", "fleetReturn"],
    );
    assert.equal(items[0]?.title, "Espionage of 1:22:9");
    assert.equal(items[3]?.title, "Raid at 1:22:8 — victory");
    assert.equal(items[1]?.unread, true);
    assert.equal(items[4]?.unread, false);
  });

  it("renders filters, unread rows, and an empty state", () => {
    const empty = messagesPageHtml(baseView(), { filter: "all" });
    assert.match(empty, /data-testid="messages-panel"/);
    assert.match(empty, /data-testid="messages-empty"/);
    assert.match(empty, /data-testid="inbox-filter-alerts"/);
    assert.doesNotMatch(empty, /messages-stub/);

    const filled = messagesPageHtml(
      baseView({
        player: {
          id: "p1",
          name: "Alpha",
          eventLog: [
            {
              id: "evt9",
              kind: "fleetReturn",
              createdAt: 80,
              readAt: null,
              title: "Fleet returned to Home",
              body: "expedition",
            },
          ],
        } as PlayerView["player"],
        reports: [
          {
            id: "c9",
            at: 90,
            missionId: "m9",
            attackerPlayerId: "p2",
            defenderPlayerId: "p1",
            attackerName: "Bravo",
            defenderName: "Alpha",
            targetCoords: { galaxy: 2, system: 3, slot: 4 },
            attackerBefore: {},
            attackerAfter: {},
            defenderBefore: {},
            defenderAfter: {},
            defensesBefore: {},
            defensesAfter: {},
            loot: { metal: 0, crystal: 0, deuterium: 0 },
            debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
            outcome: "defender_win",
            rounds: 1,
            summary: "Held the line",
          },
        ] as PlayerView["reports"],
      }),
      { filter: "alerts" },
    );
    assert.match(filled, /data-testid="message-fleetReturn-evt9"/);
    assert.match(filled, /data-unread="1"/);
    assert.match(filled, /data-testid="mark-all-read"/);
    assert.match(filled, /data-testid="mark-read-evt9"/);
    assert.doesNotMatch(filled, /message-combat-c9/);
    assert.match(filled, /Fleet returned to Home/);

    const combat = messagesPageHtml(
      baseView({
        reports: [
          {
            id: "c9",
            at: 90,
            missionId: "m9",
            attackerPlayerId: "p2",
            defenderPlayerId: "p1",
            attackerName: "Bravo",
            defenderName: "Alpha",
            targetCoords: { galaxy: 2, system: 3, slot: 4 },
            attackerBefore: {},
            attackerAfter: {},
            defenderBefore: {},
            defenderAfter: {},
            defensesBefore: {},
            defensesAfter: {},
            loot: { metal: 0, crystal: 0, deuterium: 0 },
            debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
            outcome: "defender_win",
            rounds: 1,
            summary: "Held the line",
          },
        ] as PlayerView["reports"],
      }),
      { filter: "combat" },
    );
    assert.match(combat, /Raid at 2:3:4 — victory/);
    assert.match(combat, /message-combat-c9/);
  });
});
