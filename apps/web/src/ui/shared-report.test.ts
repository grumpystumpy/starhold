import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicCombatReport } from "@starhold/game";
import {
  battleShareUrl,
  sharedCombatReportError,
  sharedCombatReportPage,
  sharedReportCodeFromSearch,
} from "./shared-report";

describe("public battle report view", () => {
  it("builds a public URL and reads its query link without a session", () => {
    const url = battleShareUrl("sh_code", "https://game.example");
    assert.equal(url, "https://game.example/?report=sh_code");
    assert.equal(sharedReportCodeFromSearch("?report=sh_code"), "sh_code");
    assert.equal(sharedReportCodeFromSearch("?planet=pl1"), null);
  });

  it("renders ship and defense totals without private report fields", () => {
    const report: PublicCombatReport = {
      shareCode: "sh_public1",
      at: 1_700_000_000_000,
      attackerName: "<Attackers>",
      defenderName: "Defender",
      targetCoords: { galaxy: 1, system: 4, slot: 8 },
      attackerBefore: { scout: 3 },
      attackerAfter: { scout: 1 },
      defenderBefore: { interceptor: 4 },
      defenderAfter: { interceptor: 2 },
      defensesBefore: { laserBattery: 3 },
      defensesAfter: { laserBattery: 1 },
      defensesDestroyed: { laserBattery: 2 },
      loot: { metal: 10, crystal: 20, deuterium: 30 },
      debrisCreated: { metal: 40, crystal: 50, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 2,
    };

    const html = sharedCombatReportPage(report);
    assert.match(html, /&lt;Attackers&gt; vs Defender/);
    assert.match(html, /<th scope="row">Recon Drone<\/th><td>3<\/td><td>1<\/td><td>2<\/td>/);
    assert.match(html, /<th scope="row">Strike Fighter<\/th><td>4<\/td><td>2<\/td><td>2<\/td>/);
    assert.match(html, /<th scope="row">Light Laser Turret<\/th><td>3<\/td><td>2<\/td>/);
    assert.doesNotMatch(html, /attackerPlayerId|defenderPlayerId|missionId|privatePlanet/);
  });

  it("escapes public lookup errors", () => {
    assert.match(sharedCombatReportError("<invalid>"), /&lt;invalid&gt;/);
  });
});
