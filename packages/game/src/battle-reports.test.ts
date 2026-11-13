import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  combatHallOfFame,
  combatHallOfShame,
  combatReportDestroyedValue,
  formatCombatShareCard,
  mergeCombatHallOfFame,
  mintCombatShareCode,
  publicCombatReport,
  recordCombatReport,
} from "./combat-share.js";
import {
  emptyDefenses,
  normalizeFleetShips,
  resolveCombat,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
} from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";
import type { CombatReport } from "./types.js";

describe("replayable battle reports", () => {
  it("resolveCombat emits per-round losses and debris", () => {
    const combat = resolveCombat(
      normalizeFleetShips({ cruiser: 1 }),
      normalizeFleetShips({ interceptor: 2 }),
    );
    assert.ok(combat.rounds >= 1);
    assert.equal(combat.roundLog.length, combat.rounds);
    const lostDef = combat.roundLog.reduce(
      (n, r) => n + (r.defenderLosses.ships.interceptor ?? 0),
      0,
    );
    assert.equal(lostDef, 2);
    const debrisSum = combat.roundLog.reduce(
      (n, r) =>
        n + (r.debrisThisRound.metal ?? 0) + (r.debrisThisRound.crystal ?? 0),
      0,
    );
    assert.ok(debrisSum > 0, "expected round debris from lost interceptors");
  });

  it("unopposed landing has empty roundLog", () => {
    const combat = resolveCombat(
      normalizeFleetShips({ scout: 1 }),
      normalizeFleetShips({}),
    );
    assert.equal(combat.rounds, 0);
    assert.deepEqual(combat.roundLog, []);
  });

  it("raid report stores roundLog, xpAwarded, and shareCode", () => {
    const universe = createUniverse("Battle Replay", 11);
    const a = joinUniverse(universe, "Atk", 140_000_000);
    const b = joinUniverse(universe, "Def", 140_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 4;
    universe.planets[a.planet.id].resources.deuterium = 800;
    universe.planets[b.planet.id].ships.scout = 1;

    const launch = launchFleet(
      universe,
      a.player.id,
      b.planet.id,
      "raid",
      { scout: 4 },
      140_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const report = Object.values(universe.reports)[0];
    assert.ok(report);
    assert.ok(report.roundLog && report.roundLog.length >= 1);
    assert.equal(report.roundLog!.length, report.rounds);
    assert.ok(report.xpAwarded);
    assert.ok(report.xpAwarded!.attacker > 0);
    assert.ok(typeof report.shareCode === "string");
    assert.match(report.shareCode!, /^sh_/);
    assert.ok(universe.players[a.player.id]?.combatStats);
    assert.ok(universe.players[b.player.id]?.combatStats);

    const card = formatCombatShareCard(report, a.player.id);
    assert.match(card, /Starhold Attack report/);
    assert.match(card, /Rounds:/);
    assert.ok(card.includes(report.shareCode!));
  });

  it("mintCombatShareCode avoids collisions", () => {
    const universe = createUniverse("Share Codes", 12);
    universe.reports.rpt_a = {
      id: "rpt_a",
      shareCode: "sh_taken1",
    } as CombatReport;
    const code = mintCombatShareCode(universe);
    assert.notEqual(code, "sh_taken1");
    assert.match(code, /^sh_/);
  });

  it("records per-player combat values and exposes only sanitized share fields", () => {
    const universe = createUniverse("Combat Stats", 13);
    const attacker = joinUniverse(universe, "Atk", 150_000_000).player;
    const defender = joinUniverse(universe, "Def", 150_000_001).player;
    const report: CombatReport = {
      id: "combat-stats",
      at: 150_000_100,
      missionId: "private-mission",
      attackerPlayerId: attacker.id,
      defenderPlayerId: defender.id,
      attackerName: attacker.name,
      defenderName: defender.name,
      targetCoords: { galaxy: 1, system: 1, slot: 8 },
      attackerBefore: normalizeFleetShips({ scout: 3 }),
      attackerAfter: normalizeFleetShips({ scout: 2 }),
      defenderBefore: normalizeFleetShips({ interceptor: 2 }),
      defenderAfter: normalizeFleetShips({ interceptor: 1 }),
      defensesBefore: { ...emptyDefenses(), laserBattery: 2 },
      defensesAfter: { ...emptyDefenses(), laserBattery: 1 },
      defensesDestroyed: { laserBattery: 1 },
      loot: { metal: 5, crystal: 6, deuterium: 7 },
      debrisCreated: { metal: 8, crystal: 9, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 2,
      summary: "Private summary",
    };

    recordCombatReport(universe, report);
    assert.equal(attacker.combatStats?.lostValue, 300);
    assert.equal(attacker.combatStats?.destroyedValue, 1350);
    assert.equal(attacker.combatStats?.wins, 1);
    assert.equal(defender.combatStats?.lostValue, 1150);
    assert.equal(defender.combatStats?.losses, 1);
    assert.equal(combatReportDestroyedValue(report), 1650);
    assert.match(report.shareCode ?? "", /^sh_/);

    const shared = publicCombatReport(report);
    assert.ok(shared);
    assert.equal(shared.attackerName, "Atk");
    assert.deepEqual(shared.loot, report.loot);
    assert.deepEqual(shared.defensesDestroyed, report.defensesDestroyed);
    assert.deepEqual(
      Object.keys(shared).sort(),
      [
        "at",
        "attackerAfter",
        "attackerBefore",
        "attackerName",
        "defenderAfter",
        "defenderBefore",
        "defenderName",
        "defensesAfter",
        "defensesBefore",
        "defensesDestroyed",
        "debrisCreated",
        "loot",
        "outcome",
        "rounds",
        "shareCode",
        "targetCoords",
      ].sort(),
    );
    assert.deepEqual(combatHallOfFame(universe)[0]?.destroyedValue, 1650);
    assert.deepEqual(combatHallOfShame(universe)[0]?.playerId, defender.id);
    const card = formatCombatShareCard(report, attacker.id);
    assert.match(card, /Attacker ships: 3 before, 2 after/);
    assert.match(card, /Defender ships: 2 before, 1 after/);
    assert.match(card, /sh_/);
  });

  it("caps both cached combat halls at 20 and sorts by value", () => {
    const universe = createUniverse("Combat Halls", 14);
    for (let i = 0; i < 25; i++) {
      const id = `hall-${i}`;
      universe.players[id] = {
        id,
        name: `Player ${i}`,
        combatStats: { lostValue: i, destroyedValue: 0, wins: 0, losses: 0 },
      } as (typeof universe.players)[string];
      universe.reports[`report-${i}`] = {
        id: `report-${i}`,
        at: i,
        attackerPlayerId: id,
        defenderPlayerId: "npc",
        attackerName: `Player ${i}`,
        defenderName: "Opponent",
        targetCoords: { galaxy: 1, system: 1, slot: 8 },
        attackerBefore: normalizeFleetShips({ scout: i }),
        attackerAfter: normalizeFleetShips({}),
        defenderBefore: normalizeFleetShips({}),
        defenderAfter: normalizeFleetShips({}),
        defensesBefore: emptyDefenses(),
        defensesAfter: emptyDefenses(),
        loot: { metal: 0, crystal: 0, deuterium: 0 },
        debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
        outcome: "attacker_win",
        rounds: 1,
      } as CombatReport;
    }
    const fame = combatHallOfFame(universe);
    const shame = combatHallOfShame(universe);
    assert.equal(fame.length, 20);
    assert.equal(shame.length, 20);
    assert.equal(fame[0]?.attackerName, "Player 24");
    assert.equal(shame[0]?.name, "Player 24");
  });

  it("keeps another player's cached fight when this working set has a different battle", () => {
    const universe = createUniverse("Partial Halls", 15);
    const cached = [
      {
        at: 50,
        attackerName: "Other",
        defenderName: "Rival",
        targetCoords: { galaxy: 2, system: 2, slot: 4 },
        outcome: "defender_win" as const,
        destroyedValue: 9_000,
        shareCode: "sh_otherfight",
      },
    ];
    universe.reports.local = {
      id: "local",
      at: 80,
      attackerPlayerId: "home",
      defenderPlayerId: "away",
      attackerName: "Home",
      defenderName: "Away",
      targetCoords: { galaxy: 1, system: 1, slot: 8 },
      attackerBefore: normalizeFleetShips({ scout: 2 }),
      attackerAfter: normalizeFleetShips({}),
      defenderBefore: normalizeFleetShips({}),
      defenderAfter: normalizeFleetShips({}),
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      shareCode: "sh_localfight",
    } as CombatReport;
    const merged = mergeCombatHallOfFame(cached, universe);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.shareCode, "sh_otherfight");
    assert.equal(merged[1]?.shareCode, "sh_localfight");
    assert.equal(merged[1]?.destroyedValue, 600);
  });

  it("legacy report without roundLog still formats a share card", () => {
    const legacy: CombatReport = {
      id: "rpt_legacy",
      at: 1,
      missionId: "m1",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "A",
      defenderName: "B",
      targetCoords: { galaxy: 1, system: 1, slot: 8 },
      attackerBefore: normalizeFleetShips({ scout: 1 }),
      attackerAfter: normalizeFleetShips({ scout: 1 }),
      defenderBefore: normalizeFleetShips({}),
      defenderAfter: normalizeFleetShips({}),
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 0,
      summary: "Unopposed landing. Garrison empty.",
    };
    const card = formatCombatShareCard(legacy);
    assert.match(card, /Unopposed landing/);
  });

  it("puts moon chance on the debris field line at 0%, mid, and the 20% cap", () => {
    const cardFor = (metal: number, crystal: number, deuterium: number) =>
      formatCombatShareCard({
        id: "rpt_moon",
        at: 1,
        missionId: "m1",
        attackerPlayerId: "p1",
        defenderPlayerId: "p2",
        attackerName: "A",
        defenderName: "B",
        targetCoords: { galaxy: 1, system: 1, slot: 8 },
        attackerBefore: normalizeFleetShips({}),
        attackerAfter: normalizeFleetShips({}),
        defenderBefore: normalizeFleetShips({}),
        defenderAfter: normalizeFleetShips({}),
        defensesBefore: emptyDefenses(),
        defensesAfter: emptyDefenses(),
        loot: { metal: 0, crystal: 0, deuterium: 0 },
        debrisCreated: { metal, crystal, deuterium },
        outcome: "attacker_win",
        rounds: 1,
        summary: "Field",
      });

    assert.match(cardFor(249_999, 0, 8_000_000), /Debris field: 249,999\/0 · moon chance 0%/);
    assert.doesNotMatch(cardFor(249_999, 0, 8_000_000), /moon chance 32%/);
    assert.match(cardFor(750_000, 250_000, 0), /Debris field: 750,000\/250,000 · moon chance 4%/);
    const capped = cardFor(6_000_000, 2_500_000, 0);
    assert.match(capped, /Debris field: 6,000,000\/2,500,000 · moon chance 20%/);
    assert.doesNotMatch(capped, /moon chance 3[0-9]%/);
    assert.doesNotMatch(cardFor(0, 0, 0), /Debris field:/);
  });
});
