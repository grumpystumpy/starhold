import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { pirateBossPanel, seasonsPage } from "./render-seasons";

function seasonView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", cosmetics: {} },
    seasonLeaderboard: {
      seasonId: "2026-11",
      scores: { combat: 0, economy: 0, pirateKills: 0 },
      economyRemainder: 0,
      ranks: { combat: null, economy: null, pirateKills: null },
      boards: { combat: [], economy: [], pirateKills: [] },
      claims: [],
    },
    reports: [],
    ...overrides,
  } as unknown as PlayerView;
}

describe("seasonal pirate boss panel", () => {
  it("omits the command panel when no boss is tracked", () => {
    const html = seasonsPage(seasonView(), false);
    assert.match(html, /data-testid="seasons-panel"/);
    assert.equal(pirateBossPanel(seasonView()), "");
    assert.doesNotMatch(html, /pirate-boss-panel/);
  });

  it("shows status, hull, rank, tier, and the top-10 board", () => {
    const html = seasonsPage(
      seasonView({
        now: 1_700_000_000_000,
        pirateBoss: {
          id: "boss-1",
          coords: { galaxy: 2, system: 14, slot: 9 },
          shipsLeft: 25,
          hpPct: 80,
          activeUntil: 1_700_000_000_000 + 2 * 86_400_000 + 3 * 3_600_000,
          myDamage: 12_500,
          myRank: 2,
          totalDamage: 40_000,
          myTier: "top10",
          top: [
            { playerId: "p2", name: "Alpha", damage: 20_000 },
            { playerId: "p1", name: "You", damage: 12_500 },
          ],
        },
        reports: [
          {
            id: "r1",
            bossDamage: 4_200,
          } as PlayerView["reports"][number],
        ],
      }),
      false,
    );
    assert.match(html, /data-testid="pirate-boss-panel"/);
    assert.match(html, /data-testid="pirate-boss-status"/);
    assert.match(html, /Active · ends in 2d 3h/);
    assert.match(html, /data-testid="pirate-boss-hp"/);
    assert.match(html, /aria-valuenow="80"/);
    assert.match(html, /80% hull/);
    assert.match(html, /2:14:9/);
    assert.match(html, /Your damage 12.5K · #2 · Top 10%/);
    assert.match(html, /data-testid="pirate-boss-board"/);
    assert.match(html, /data-testid="pirate-boss-row-1"/);
    assert.match(html, /Alpha/);
    assert.match(html, /You \(you\)/);
    assert.match(html, /data-testid="pirate-boss-report"/);
    assert.match(html, /Last strike destroyed 4.2K/);
  });

  it("counts down to the next spawn after the mothership falls", () => {
    const html = pirateBossPanel(
      seasonView({
        now: 1_700_000_000_000,
        pirateBoss: {
          id: "boss-1",
          coords: { galaxy: 1, system: 1, slot: 4 },
          shipsLeft: 0,
          hpPct: 0,
          nextSpawnAt: 1_700_000_000_000 + 5 * 3_600_000,
          myDamage: 100,
          myRank: 1,
          totalDamage: 100,
          myTier: "top1",
          top: [],
        },
      }),
    );
    assert.match(html, /Cooldown · next spawn 5h 0m/);
    assert.match(html, /data-testid="pirate-boss-board-empty"/);
    assert.match(html, /Top strike/);
  });
});
