import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCombatShareCard,
  mintCombatShareCode,
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
});
