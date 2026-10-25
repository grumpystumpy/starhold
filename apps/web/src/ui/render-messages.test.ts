import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import {
  closeReportWindow,
  collectInbox,
  messagesPageHtml,
  openReportWindow,
  setConfirmDelete,
  setInboxFilter,
} from "./render-messages";

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

  it("renders debris and rebuilt defenses, and still renders legacy reports", () => {
    const combat = messagesPageHtml(
      baseView({
        reports: [
          {
            id: "c2",
            at: 200,
            missionId: "m2",
            attackerPlayerId: "p1",
            defenderPlayerId: "p2",
            attackerName: "Alpha",
            defenderName: "Bravo",
            targetCoords: { galaxy: 1, system: 4, slot: 8 },
            attackerBefore: {},
            attackerAfter: {},
            defenderBefore: {},
            defenderAfter: {},
            defensesBefore: {},
            defensesAfter: {},
            defensesDestroyed: { laserBattery: 10 },
            defensesRebuilt: { laserBattery: 7 },
            defensesPermanentlyLost: { laserBattery: 3 },
            loot: { metal: 0, crystal: 0, deuterium: 0 },
            debrisCreated: { metal: 1200, crystal: 800, deuterium: 0 },
            outcome: "attacker_win",
            rounds: 3,
            summary: "Guns down",
          },
        ] as PlayerView["reports"],
        expeditionReports: [
          {
            id: "e2",
            at: 180,
            missionId: "m4",
            playerId: "p1",
            targetCoords: { galaxy: 1, system: 4, slot: 16 },
            kind: "pirates",
            cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
            shipsDelta: {},
            debrisCreated: { metal: 400, crystal: 80, deuterium: 0 },
            summary: "Pirate ambush",
          },
        ] as PlayerView["expeditionReports"],
      }),
    );
    assert.match(combat, /1,200 metal, 800 crystal/);
    assert.match(combat, /Defenses destroyed: 10× Light Laser/);
    assert.match(combat, /Rebuilt: 7× Light Laser/);
    assert.match(combat, /Permanently lost: 3× Light Laser/);
    assert.match(combat, /400 metal, 80 crystal at 1:4:16/);

    const legacy = messagesPageHtml(
      baseView({
        reports: [
          {
            id: "old",
            at: 10,
            missionId: "old-m",
            attackerPlayerId: "p1",
            defenderPlayerId: "p2",
            attackerName: "Alpha",
            defenderName: "Bravo",
            targetCoords: { galaxy: 1, system: 1, slot: 1 },
            attackerBefore: {},
            attackerAfter: {},
            defenderBefore: {},
            defenderAfter: {},
            defensesBefore: {},
            defensesAfter: {},
            loot: { metal: 0, crystal: 0, deuterium: 0 },
            debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
            outcome: "draw",
            rounds: 1,
            summary: "Old report",
          },
        ] as PlayerView["reports"],
        expeditionReports: [
          {
            id: "old-x",
            at: 9,
            missionId: "old-e",
            playerId: "p1",
            targetCoords: { galaxy: 2, system: 2, slot: 16 },
            kind: "nothing",
            cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
            shipsDelta: {},
            summary: "Empty void",
          },
        ] as PlayerView["expeditionReports"],
      }),
    );
    assert.match(legacy, /Old report/);
    assert.match(legacy, /Empty void/);
    assert.doesNotMatch(legacy, /Defenses destroyed/);
    assert.doesNotMatch(legacy, /Debris:/);
  });

  it("asks before deleting the current category only", () => {
    setConfirmDelete(null);
    setInboxFilter("alerts");
    const view = baseView({
      player: {
        id: "p1",
        name: "Alpha",
        eventLog: [
          {
            id: "evt1",
            kind: "raidAlert",
            createdAt: 5,
            readAt: 6,
            title: "Raid incoming",
            body: "Hold",
          },
        ],
      } as PlayerView["player"],
    });
    const html = messagesPageHtml(view);
    assert.equal(html.match(/Delete all/g)?.length, 1);
    assert.match(html, /data-testid="delete-all-alerts"/);
    assert.doesNotMatch(html, /data-testid="delete-all-combat"/);
    assert.doesNotMatch(html, /data-testid="delete-all-all"/);
    assert.doesNotMatch(html, /delete-all-alerts-confirm/);

    setConfirmDelete("alerts");
    const confirm = messagesPageHtml(view);
    assert.match(confirm, /data-testid="delete-confirm-alerts"/);
    assert.match(confirm, /Delete every alert\?/);
    assert.match(confirm, /data-testid="delete-all-alerts-confirm"/);
    assert.match(confirm, />Confirm</);
    assert.match(confirm, />Cancel</);
    assert.equal(confirm.match(/Delete all/g)?.length ?? 0, 0);
    setConfirmDelete(null);
    setInboxFilter("all");
  });

  it("renders open report buttons and opens sub-window for combat, spy, and expedition reports", () => {
    closeReportWindow();
    const combatReport = {
      id: "c_test_1",
      at: 1000,
      missionId: "m_test_1",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "Alpha",
      defenderName: "Bravo",
      originCoords: { galaxy: 1, system: 10, slot: 2 },
      targetCoords: { galaxy: 1, system: 20, slot: 5 },
      attackerBefore: { scout: 10, cruiser: 2 },
      attackerAfter: { scout: 8, cruiser: 2 },
      defenderBefore: { interceptor: 5 },
      defenderAfter: { interceptor: 0 },
      defensesBefore: { laserBattery: 4 },
      defensesAfter: { laserBattery: 1 },
      defensesDestroyed: { laserBattery: 3 },
      defensesRebuilt: { laserBattery: 2 },
      defensesPermanentlyLost: { laserBattery: 1 },
      loot: { metal: 500, crystal: 300, deuterium: 100 },
      debrisCreated: { metal: 1200, crystal: 800, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 2,
      summary: "Battle summary text",
      roundLog: [
        {
          round: 1,
          attackerLosses: { ships: { scout: 1 } },
          defenderLosses: { ships: { interceptor: 3 }, defenses: { laserBattery: 2 } },
          debrisThisRound: { metal: 800, crystal: 500, deuterium: 0 },
        },
        {
          round: 2,
          attackerLosses: { ships: { scout: 1 } },
          defenderLosses: { ships: { interceptor: 2 }, defenses: { laserBattery: 1 } },
          debrisThisRound: { metal: 400, crystal: 300, deuterium: 0 },
        },
      ],
    };

    const spyReport = {
      id: "s_test_1",
      at: 2000,
      missionId: "m_test_2",
      spyPlayerId: "p1",
      targetPlayerId: "p2",
      targetName: "Bravo",
      targetCoords: { galaxy: 1, system: 20, slot: 5 },
      detail: 3,
      resources: { metal: 1000, crystal: 500, deuterium: 200 },
      buildings: { mineMetal: 5 },
      ships: { scout: 2 },
      defenses: { laserBattery: 1 },
      research: { weaponsTech: 2 },
      summary: "Spy summary text",
    };

    const expeditionReport = {
      id: "e_test_1",
      at: 3000,
      missionId: "m_test_3",
      playerId: "p1",
      targetCoords: { galaxy: 1, system: 1, slot: 16 },
      kind: "resources" as const,
      cargoGained: { metal: 1500, crystal: 800, deuterium: 0 },
      shipsDelta: {},
      summary: "Expedition summary text",
    };

    const view = baseView({
      reports: [combatReport] as PlayerView["reports"],
      spyReports: [spyReport] as PlayerView["spyReports"],
      expeditionReports: [expeditionReport] as PlayerView["expeditionReports"],
    });

    const pageHtml = messagesPageHtml(view);
    assert.match(pageHtml, /data-testid="open-report-combat-c_test_1"/);
    assert.match(pageHtml, /data-testid="open-report-spy-s_test_1"/);
    assert.match(pageHtml, /data-testid="open-report-expedition-e_test_1"/);
    assert.doesNotMatch(pageHtml, /data-testid="report-subwindow"/);

    // Open Combat Report
    openReportWindow("combat", "c_test_1");
    const combatWinHtml = messagesPageHtml(view);
    assert.match(combatWinHtml, /data-testid="report-subwindow"/);
    assert.match(combatWinHtml, /data-testid="close-report-window"/);
    assert.match(combatWinHtml, /Alpha \(1:10:2\)/);
    assert.match(combatWinHtml, /Bravo \(1:20:5\)/);
    assert.match(combatWinHtml, /Scout Skiff/);
    assert.match(combatWinHtml, /Aegis Cruiser/);
    assert.match(combatWinHtml, /Light Laser/);
    assert.match(combatWinHtml, /Total ships lost/);
    assert.match(combatWinHtml, /data-testid="battle-round-tab-1"/);
    assert.match(combatWinHtml, /data-testid="battle-round-tab-2"/);
    assert.match(combatWinHtml, /800 metal, 500 crystal/);
    assert.match(combatWinHtml, /1,200 metal, 800 crystal/);

    // Open Spy Report
    openReportWindow("spy", "s_test_1");
    const spyWinHtml = messagesPageHtml(view);
    assert.match(spyWinHtml, /data-testid="report-subwindow"/);
    assert.match(spyWinHtml, /Espionage Report/);
    assert.match(spyWinHtml, /Bravo/);
    assert.match(spyWinHtml, /1,000 metal, 500 crystal, 200 deuterium/);

    // Open Expedition Report
    openReportWindow("expedition", "e_test_1");
    const expWinHtml = messagesPageHtml(view);
    assert.match(expWinHtml, /data-testid="report-subwindow"/);
    assert.match(expWinHtml, /Expedition Report/);
    assert.match(expWinHtml, /1,500 metal, 800 crystal/);

    closeReportWindow();
  });

  it("renders legacy combat report without originCoords, roundLog, or defensesDestroyed cleanly in sub-window", () => {
    closeReportWindow();
    const legacyReport = {
      id: "c_legacy_1",
      at: 500,
      missionId: "m_legacy_1",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "AlphaLegacy",
      defenderName: "BravoLegacy",
      targetCoords: { galaxy: 2, system: 15, slot: 3 },
      attackerBefore: { scout: 5 },
      attackerAfter: { scout: 5 },
      defenderBefore: {},
      defenderAfter: {},
      defensesBefore: {},
      defensesAfter: {},
      loot: { metal: 100, crystal: 50, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win" as const,
      rounds: 1,
      summary: "Legacy combat summary",
    };

    const view = baseView({
      reports: [legacyReport] as PlayerView["reports"],
    });

    openReportWindow("combat", "c_legacy_1");
    const legacyHtml = messagesPageHtml(view);
    assert.match(legacyHtml, /data-testid="report-subwindow"/);
    assert.match(legacyHtml, /AlphaLegacy/);
    assert.match(legacyHtml, /BravoLegacy \(2:15:3\)/);
    assert.match(legacyHtml, /Summary only — older reports have no round replay/);
    assert.doesNotMatch(legacyHtml, /Defenses destroyed:/);

    closeReportWindow();
  });
});
