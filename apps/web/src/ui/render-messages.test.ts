import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CombatReport, PlayerView } from "@starhold/game";
import {
  categoryLabel,
  closeReportWindow,
  collectInbox,
  combatLossSummary,
  combatReadoutHtml,
  inboxBucket,
  inboxUnreadCount,
  messagesPageHtml,
  openReportWindow,
  setConfirmDelete,
  setInboxFilter,
} from "./render-messages";
import { fmt, fmtCompact } from "./format";
import { combatBattleExtrasHtml } from "./render-fleets-panels";

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
            title: "Ore Mine → level 12",
            body: "Finished on Home.",
          },
          {
            id: "evt2",
            kind: "fleetReturn",
            createdAt: 50,
            readAt: 400,
            title: "Fleet returned to Home",
            body: "deploy · 2× Recon Drone",
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

  it("hides only raid alerts duplicated by a visible combat report", () => {
    const report = {
      id: "pvp-report",
      at: 100,
      missionId: "pvp-mission",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "Alpha",
      defenderName: "Bravo",
      targetCoords: { galaxy: 1, system: 2, slot: 3 },
      attackerBefore: {},
      attackerAfter: {},
      defenderBefore: {},
      defenderAfter: {},
      defensesBefore: {},
      defensesAfter: {},
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "Raid won",
    } as PlayerView["reports"][number];
    const npcReport = {
      ...report,
      id: "npc-report",
      at: 200,
      missionId: "pir:1:2:3",
      attackerPlayerId: "npc_pirates",
      defenderPlayerId: "p1",
    };
    const view = baseView({
      reports: [report, npcReport],
      player: {
        id: "p1",
        name: "Alpha",
        eventLog: [
          {
            id: "pvp-alert",
            kind: "raidAlert",
            createdAt: 100,
            readAt: null,
            title: "Hostile raid resolved",
            body: "Raid won",
            meta: { reportId: "pvp-report" },
          },
          {
            id: "npc-alert",
            kind: "raidAlert",
            createdAt: 200,
            readAt: null,
            title: "Hostile raid resolved",
            body: "Pirate raid",
            meta: { pirateBaseId: "pir:1:2:3" },
          },
          {
            id: "missing-report-alert",
            kind: "raidAlert",
            createdAt: 150,
            readAt: null,
            title: "Report not in inbox",
            body: "Keep when the report is hidden",
            meta: { reportId: "missing-report" },
          },
          {
            id: "stale-npc-alert",
            kind: "raidAlert",
            createdAt: 201,
            readAt: null,
            title: "Pirate raid later",
            body: "Timestamp does not match the report",
            meta: { pirateBaseId: "pir:1:2:3" },
          },
          {
            id: "other-alert",
            kind: "raidAlert",
            createdAt: 300,
            readAt: null,
            title: "Unlinked alert",
            body: "Keep this alert",
          },
          {
            id: "fleet-warning",
            kind: "fleetReturn",
            createdAt: 400,
            readAt: null,
            title: "Fleet warning",
            body: "Unrelated fleet notification",
          },
        ],
      } as PlayerView["player"],
    });

    assert.deepEqual(
      collectInbox(view).map((item) => item.id),
      [
        "fleet-warning",
        "other-alert",
        "stale-npc-alert",
        "npc-report",
        "missing-report-alert",
        "pvp-report",
      ],
    );
    assert.equal(inboxUnreadCount(view), 4);
    const bystander = baseView({
      reports: [npcReport],
      player: {
        id: "p9",
        name: "Other",
        eventLog: [
          {
            id: "npc-alert",
            kind: "raidAlert",
            createdAt: 200,
            readAt: null,
            title: "Hostile raid resolved",
            body: "Pirate raid",
            meta: { pirateBaseId: "pir:1:2:3" },
          },
        ],
      } as PlayerView["player"],
    });
    assert.deepEqual(
      collectInbox(bystander).map((item) => item.id),
      ["npc-alert", "npc-report"],
    );
  });

  it("renders filters, unread rows, and an empty state", () => {
    const empty = messagesPageHtml(baseView(), { filter: "all" });
    assert.match(empty, /data-testid="messages-panel"/);
    assert.match(empty, /data-testid="messages-empty"/);
    assert.match(empty, /data-testid="inbox-filter-all"/);
    assert.match(empty, /data-testid="inbox-filter-combat"/);
    assert.match(empty, /data-testid="inbox-filter-spy"/);
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
    assert.match(filled, /<span class="message-category message-category-alerts" data-testid="message-category">Alerts<\/span>/);
    assert.match(filled, /<span class="message-kind" data-testid="message-kind">Fleet<\/span>/);

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
    assert.match(combat, /<span class="message-category message-category-combat" data-testid="message-category">Combat<\/span>/);
    assert.match(combat, /<span class="message-kind" data-testid="message-kind">Combat<\/span>/);
  });

  it("renders visible category badges matching filter buckets for all message kinds", () => {
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
          loot: { metal: 0, crystal: 0, deuterium: 0 },
          debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
          outcome: "attacker_win",
          rounds: 1,
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
          targetCoords: { galaxy: 1, system: 22, slot: 9 },
          detail: 1,
          resources: null,
          buildings: null,
          ships: null,
          defenses: null,
          research: null,
          summary: "Spy report",
        },
      ] as PlayerView["spyReports"],
      expeditionReports: [
        {
          id: "e1",
          at: 300,
          missionId: "m3",
          playerId: "p1",
          targetCoords: { galaxy: 1, system: 1, slot: 16 },
          kind: "resources",
          cargoGained: { metal: 10, crystal: 0, deuterium: 0 },
          shipsDelta: {},
          summary: "Expedition report",
        },
      ] as PlayerView["expeditionReports"],
      player: {
        id: "p1",
        name: "Alpha",
        eventLog: [
          {
            id: "evt1",
            kind: "buildComplete",
            createdAt: 400,
            readAt: null,
            title: "Build done",
            body: "Done",
          },
          {
            id: "evt2",
            kind: "fleetReturn",
            createdAt: 410,
            readAt: null,
            title: "Fleet returned",
            body: "Returned",
          },
          {
            id: "evt3",
            kind: "raidAlert",
            createdAt: 420,
            readAt: null,
            title: "Raid incoming",
            body: "Alert",
          },
          {
            id: "evt4",
            kind: "miniNearby",
            createdAt: 430,
            readAt: null,
            title: "Mini spotted",
            body: "Spotted",
          },
        ],
      } as PlayerView["player"],
    });

    const htmlAll = messagesPageHtml(view, { filter: "all" });

    // Category label function
    assert.equal(categoryLabel("combat"), "Combat");
    assert.equal(categoryLabel("spy"), "Spy");
    assert.equal(categoryLabel("alerts"), "Alerts");

    // Buckets
    assert.equal(inboxBucket("combat"), "combat");
    assert.equal(inboxBucket("expedition"), "combat");
    assert.equal(inboxBucket("spy"), "spy");
    assert.equal(inboxBucket("buildComplete"), "alerts");
    assert.equal(inboxBucket("fleetReturn"), "alerts");
    assert.equal(inboxBucket("raidAlert"), "alerts");
    assert.equal(inboxBucket("miniNearby"), "alerts");

    // Message rows have category badges matching bucket
    // Expedition row (kind = expedition, bucket = combat)
    assert.match(
      htmlAll,
      /id="msg-expedition-e1"[^>]*data-bucket="combat"[^>]*>[\s\S]*?<span class="message-category message-category-combat" data-testid="message-category">Combat<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Expedition<\/span>/,
    );

    // Combat row (kind = combat, bucket = combat)
    assert.match(
      htmlAll,
      /id="msg-combat-c1"[^>]*data-bucket="combat"[^>]*>[\s\S]*?<span class="message-category message-category-combat" data-testid="message-category">Combat<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Combat<\/span>/,
    );

    // Spy row (kind = spy, bucket = spy)
    assert.match(
      htmlAll,
      /id="msg-spy-s1"[^>]*data-bucket="spy"[^>]*>[\s\S]*?<span class="message-category message-category-spy" data-testid="message-category">Spy<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Spy<\/span>/,
    );

    // Build row (kind = buildComplete, bucket = alerts)
    assert.match(
      htmlAll,
      /id="msg-buildComplete-evt1"[^>]*data-bucket="alerts"[^>]*>[\s\S]*?<span class="message-category message-category-alerts" data-testid="message-category">Alerts<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Build<\/span>/,
    );

    // Fleet row (kind = fleetReturn, bucket = alerts)
    assert.match(
      htmlAll,
      /id="msg-fleetReturn-evt2"[^>]*data-bucket="alerts"[^>]*>[\s\S]*?<span class="message-category message-category-alerts" data-testid="message-category">Alerts<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Fleet<\/span>/,
    );

    // Raid alert row (kind = raidAlert, bucket = alerts)
    assert.match(
      htmlAll,
      /id="msg-raidAlert-evt3"[^>]*data-bucket="alerts"[^>]*>[\s\S]*?<span class="message-category message-category-alerts" data-testid="message-category">Alerts<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Raid<\/span>/,
    );

    // Mini nearby row (kind = miniNearby, bucket = alerts)
    assert.match(
      htmlAll,
      /id="msg-miniNearby-evt4"[^>]*data-bucket="alerts"[^>]*>[\s\S]*?<span class="message-category message-category-alerts" data-testid="message-category">Alerts<\/span>[\s\S]*?<span class="message-kind" data-testid="message-kind">Mini<\/span>/,
    );

    // Test filter views isolate the expected buckets
    const combatFilterHtml = messagesPageHtml(view, { filter: "combat" });
    assert.match(combatFilterHtml, /id="msg-combat-c1"/);
    assert.match(combatFilterHtml, /id="msg-expedition-e1"/);
    assert.doesNotMatch(combatFilterHtml, /id="msg-spy-s1"/);
    assert.doesNotMatch(combatFilterHtml, /id="msg-buildComplete-evt1"/);

    const spyFilterHtml = messagesPageHtml(view, { filter: "spy" });
    assert.match(spyFilterHtml, /id="msg-spy-s1"/);
    assert.doesNotMatch(spyFilterHtml, /id="msg-combat-c1"/);
    assert.doesNotMatch(spyFilterHtml, /id="msg-expedition-e1"/);
    assert.doesNotMatch(spyFilterHtml, /id="msg-buildComplete-evt1"/);

    const alertsFilterHtml = messagesPageHtml(view, { filter: "alerts" });
    assert.match(alertsFilterHtml, /id="msg-buildComplete-evt1"/);
    assert.match(alertsFilterHtml, /id="msg-fleetReturn-evt2"/);
    assert.match(alertsFilterHtml, /id="msg-raidAlert-evt3"/);
    assert.match(alertsFilterHtml, /id="msg-miniNearby-evt4"/);
    assert.doesNotMatch(alertsFilterHtml, /id="msg-combat-c1"/);
    assert.doesNotMatch(alertsFilterHtml, /id="msg-spy-s1"/);
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
    assert.match(combat, /1\.2k metal, 800 crystal/);
    assert.match(combat, /Defenses destroyed: 10× Light Laser Turret/);
    assert.match(combat, /Rebuilt: 7× Light Laser Turret/);
    assert.match(combat, /Permanently lost: 3× Light Laser Turret/);
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
      shareCode: "sh_test1",
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
    assert.match(combatWinHtml, /combat-report-win/);
    assert.match(combatWinHtml, /data-combat-result="win"/);
    assert.match(combatWinHtml, /Alpha/);
    assert.match(combatWinHtml, /Bravo/);
    assert.match(combatWinHtml, /Total ships lost: 2/);
    assert.match(combatWinHtml, /Total ships lost: 5/);
    assert.match(combatWinHtml, /Points lost:/);
    assert.match(combatWinHtml, /coord-link/);
    assert.match(combatWinHtml, /1\.2k metal, 800 crystal/);
    assert.match(combatWinHtml, /<th scope="row">Recon Drone<\/th><td>10<\/td><td>8<\/td><td>2<\/td>/);
    assert.match(combatWinHtml, /<th scope="row">Guided-Missile Cruiser<\/th><td>2<\/td><td>2<\/td><td>0<\/td>/);
    assert.match(combatWinHtml, /<th scope="row">Strike Fighter<\/th><td>5<\/td><td>0<\/td><td>5<\/td>/);
    assert.match(combatWinHtml, /data-testid="battle-ship-totals-attacker"/);
    assert.match(combatWinHtml, /data-testid="battle-ship-totals-defender"/);
    assert.match(combatWinHtml, /data-copy-battle-share="c_test_1"/);

    const inboxDetails = messagesPageHtml(view);
    assert.match(inboxDetails, /data-testid="inbox-combat-details-c_test_1"/);
    assert.match(inboxDetails, /<th scope="row">Recon Drone<\/th><td>10<\/td><td>8<\/td><td>2<\/td>/);
    assert.match(inboxDetails, /<th scope="row">Strike Fighter<\/th><td>5<\/td><td>0<\/td><td>5<\/td>/);
    assert.equal(
      combatWinHtml.match(/<th scope="row">Recon Drone<\/th><td>10<\/td><td>8<\/td><td>2<\/td>/g)?.length,
      2,
    );
    assert.match(
      combatBattleExtrasHtml(combatReport as CombatReport),
      /data-copy-battle-share="c_test_1"/,
    );
    assert.doesNotMatch(
      combatBattleExtrasHtml({ ...combatReport, shareCode: undefined } as CombatReport),
      /data-copy-battle-share=/,
    );

    // Open Spy Report
    openReportWindow("spy", "s_test_1");
    const spyWinHtml = messagesPageHtml(view);
    assert.match(spyWinHtml, /data-testid="report-subwindow"/);
    assert.match(spyWinHtml, /Espionage Report/);
    assert.match(spyWinHtml, /Bravo/);
    assert.match(spyWinHtml, /1k metal, 500 crystal, 200 deuterium/);

    // Open Expedition Report
    openReportWindow("expedition", "e_test_1");
    const expWinHtml = messagesPageHtml(view);
    assert.match(expWinHtml, /data-testid="report-subwindow"/);
    assert.match(expWinHtml, /Expedition Report/);
    assert.match(expWinHtml, /1\.5k metal, 800 crystal/);

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
    assert.match(legacyHtml, /combat-report-win/);
    assert.match(legacyHtml, /data-combat-result="win"/);
    assert.match(legacyHtml, /AlphaLegacy/);
    assert.match(legacyHtml, /BravoLegacy/);
    assert.match(legacyHtml, /coord-link/);
    assert.doesNotMatch(legacyHtml, /Defenses destroyed:/);
    assert.doesNotMatch(legacyHtml, /data-copy-battle-share="c_legacy_1"/);

    closeReportWindow();
  });

  it("compares survivors and losses and separates loot from debris", () => {
    closeReportWindow();
    const win = {
      id: "c_read_win",
      at: 1000,
      missionId: "m_read_win",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "Alpha",
      defenderName: "Bravo",
      originCoords: { galaxy: 1, system: 10, slot: 2 },
      targetCoords: { galaxy: 1, system: 20, slot: 5 },
      attackerBefore: { scout: 2_500_000 },
      attackerAfter: { scout: 1_000_000 },
      defenderBefore: { interceptor: 4_000 },
      defenderAfter: { interceptor: 0 },
      defensesBefore: {},
      defensesAfter: {},
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 9_999_000, crystal: 0, deuterium: 1_500 },
      outcome: "attacker_win" as const,
      rounds: 6,
      summary: "Large battle",
      shareCode: "sh_read_win",
    };
    const lossView = baseView({
      player: { id: "p2", name: "Bravo", eventLog: [] } as PlayerView["player"],
      reports: [win] as PlayerView["reports"],
    });
    openReportWindow("combat", "c_read_win");
    const lossHtml = messagesPageHtml(lossView);
    assert.match(lossHtml, /combat-report-loss/);
    assert.match(lossHtml, /data-combat-result="loss"/);
    assert.match(lossHtml, /data-testid="inbox-filter-combat"/);
    assert.match(lossHtml, /data-copy-battle-share="c_read_win"/);
    assert.match(lossHtml, /<th>Before<\/th><th>After<\/th><th>Lost<\/th>/);
    const attacker = lossHtml.match(/data-testid="combat-side-attacker"[\s\S]*?<\/section>/)?.[0] ?? "";
    const defender = lossHtml.match(/data-testid="combat-side-defender"[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.doesNotMatch(attacker, /data-viewer="self"/);
    assert.match(defender, /data-viewer="self"/);
    assert.match(attacker, /Ships before: 2\.5M/);
    assert.match(attacker, /Survivors: 1M/);
    assert.match(attacker, /Total ships lost: 1\.5M/);
    assert.match(defender, /Survivors: 0/);
    assert.match(defender, /Total ships lost: 4k/);
    const loss = combatLossSummary(win as CombatReport);
    assert.ok(attacker.includes(`Points lost: ${fmtCompact(loss.attackerPointsLost)}`));
    assert.ok(defender.includes(`Points lost: ${fmtCompact(loss.defenderPointsLost)}`));
    const loot = lossHtml.match(/data-testid="combat-loot"[\s\S]*?<\/section>/)?.[0] ?? "";
    const debris = lossHtml.match(/data-testid="combat-debris"[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.match(loot, /Loot/);
    assert.equal(loot.includes(`${fmt(0)} metal, ${fmt(0)} crystal, ${fmt(0)} deuterium`), true);
    assert.doesNotMatch(loot, /9\.9M/);
    assert.match(debris, /Debris/);
    assert.match(debris, /9\.9M metal, 0 crystal, 1\.5k deuterium/);
    assert.doesNotMatch(debris, /<h4>Loot<\/h4>/);
    assert.equal(lossHtml.match(/data-testid="combat-side-compare"/g)?.length, 2);
    assert.equal(lossHtml.match(/data-testid="combat-loot"/g)?.length, 2);
    assert.equal(lossHtml.match(/data-testid="combat-debris"/g)?.length, 2);
    assert.equal(lossHtml.match(/Ships before: 2\.5M/g)?.length, 2);
    assert.equal(lossHtml.match(/9\.9M metal, 0 crystal, 1\.5k deuterium/g)?.length, 2);
    assert.equal(
      lossHtml.match(/data-testid="combat-side-defender"[^>]*data-viewer="self"/g)?.length,
      2,
    );

    const draw = {
      ...win,
      id: "c_read_draw",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerBefore: {},
      attackerAfter: {},
      defenderBefore: {},
      defenderAfter: {},
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "draw" as const,
      shareCode: "sh_read_draw",
    };
    const drawView = baseView({
      reports: [draw] as PlayerView["reports"],
    });
    openReportWindow("combat", "c_read_draw");
    const drawHtml = messagesPageHtml(drawView);
    assert.match(drawHtml, /combat-report-draw/);
    assert.match(drawHtml, /data-combat-result="draw"/);
    assert.match(drawHtml, /data-testid="combat-side-attacker"[^>]*data-viewer="self"/);
    assert.match(drawHtml, /Survivors: 0/);
    assert.match(drawHtml, /Total ships lost: 0/);
    assert.match(drawHtml, /data-copy-battle-share="c_read_draw"/);
    const drawLoot = drawHtml.match(/data-testid="combat-loot"[\s\S]*?<\/section>/)?.[0] ?? "";
    const drawDebris = drawHtml.match(/data-testid="combat-debris"[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.match(drawLoot, /0 metal, 0 crystal, 0 deuterium/);
    assert.match(drawDebris, /0 metal, 0 crystal, 0 deuterium/);
    assert.notEqual(drawLoot.includes("<h4>Loot</h4>"), drawDebris.includes("<h4>Loot</h4>"));
    assert.equal(drawHtml.match(/data-testid="combat-side-compare"/g)?.length, 2);
    assert.equal(drawHtml.match(/data-testid="combat-loot"/g)?.length, 2);
    assert.equal(drawHtml.match(/0 metal, 0 crystal, 0 deuterium/g)?.length, 4);

    const defenderWin = {
      ...win,
      id: "c_read_def",
      outcome: "defender_win" as const,
      shareCode: undefined,
    };
    openReportWindow("combat", "c_read_def");
    const defenderWinHtml = messagesPageHtml(
      baseView({ reports: [defenderWin] as PlayerView["reports"] }),
    );
    assert.match(defenderWinHtml, /combat-report-loss/);
    assert.match(defenderWinHtml, /data-combat-result="loss"/);
    assert.doesNotMatch(defenderWinHtml, /data-copy-battle-share="c_read_def"/);
    closeReportWindow();
  });

  it("shows moon chance on combat debris at 0%, mid, and the 20% cap", () => {
    closeReportWindow();
    const report = (
      id: string,
      debrisCreated: { metal: number; crystal: number; deuterium: number },
    ) =>
      ({
        id,
        at: 1000,
        missionId: `m_${id}`,
        attackerPlayerId: "p1",
        defenderPlayerId: "p2",
        attackerName: "Alpha",
        defenderName: "Bravo",
        targetCoords: { galaxy: 1, system: 2, slot: 4 },
        attackerBefore: {},
        attackerAfter: {},
        defenderBefore: {},
        defenderAfter: {},
        defensesBefore: {},
        defensesAfter: {},
        loot: { metal: 0, crystal: 0, deuterium: 0 },
        debrisCreated,
        outcome: "attacker_win" as const,
        rounds: 1,
        summary: "Debris field",
      }) as CombatReport;

    const zero = report("c_moon_0", {
      metal: 249_999,
      crystal: 0,
      deuterium: 8_000_000,
    });
    const mid = report("c_moon_mid", {
      metal: 1_000_000,
      crystal: 0,
      deuterium: 0,
    });
    const cap = report("c_moon_cap", {
      metal: 6_000_000,
      crystal: 2_500_000,
      deuterium: 0,
    });

    const section = (html: string) =>
      html.match(/data-testid="combat-debris"[\s\S]*?<\/section>/)?.[0] ?? "";

    const zeroHtml = combatReadoutHtml(zero, "p1");
    const zeroDebris = section(zeroHtml);
    assert.match(zeroDebris, /249\.9k metal, 0 crystal, 8M deuterium/);
    assert.match(zeroDebris, /data-testid="combat-moon-chance"/);
    assert.match(zeroDebris, /moon chance 0%/);
    assert.doesNotMatch(zeroDebris, /moon chance 32%/);

    const midDebris = section(combatReadoutHtml(mid, "p1"));
    assert.match(midDebris, /1M metal, 0 crystal, 0 deuterium/);
    assert.match(midDebris, /moon chance 4%/);

    const capDebris = section(combatReadoutHtml(cap, "p1"));
    assert.match(capDebris, /6M metal, 2\.5M crystal, 0 deuterium/);
    assert.match(capDebris, /moon chance 20%/);
    assert.doesNotMatch(capDebris, /moon chance 3[0-9]%/);

    const inbox = messagesPageHtml(
      baseView({ reports: [zero, mid, cap] as PlayerView["reports"] }),
    );
    assert.match(inbox, /Debris: 249\.9k metal, 8M deuterium · moon chance 0%/);
    assert.match(inbox, /Debris: 1M metal · moon chance 4%/);
    assert.match(inbox, /Debris: 6M metal, 2\.5M crystal · moon chance 20%/);
  });
});
