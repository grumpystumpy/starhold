import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { pageHtml, resetCategoryBoards, setCategoryBoards, setHighscoreTab } from "./render-pages";

describe("highscore combat halls", () => {
  it("renders both cached halls and public report links", () => {
    const view = {
      player: { id: "p1" },
      highscores: [],
      roster: [],
      hallOfFame: [{
        at: 1_700_000_000_000,
        attackerName: "A",
        defenderName: "B",
        targetCoords: { galaxy: 1, system: 2, slot: 3 },
        outcome: "attacker_win",
        destroyedValue: 12_345,
        shareCode: "sh_hall",
      }],
      hallOfShame: [{
        rank: 1,
        playerId: "p2",
        name: "Lost",
        lostValue: 9876,
      }],
    } as unknown as PlayerView;

    const html = pageHtml("highscore", view, false, null);
    assert.match(html, /data-testid="hall-of-fame"/);
    assert.match(html, /A vs B/);
    assert.match(html, /href="\/\?report=sh_hall"/);
    assert.match(html, /data-testid="hall-of-shame"/);
    assert.match(html, /Lost/);
    assert.match(html, /9\.9K ship value lost/);
  });

  it("renders category tabs from the cached boards", () => {
    const view = {
      player: { id: "p1", name: "Alpha" },
      highscores: [],
      roster: [],
      hallOfFame: [],
      hallOfShame: [],
    } as unknown as PlayerView;
    const row = {
      rank: 1,
      playerId: "p1",
      name: "Alpha",
      points: 4200,
      coords: { galaxy: 1, system: 2, slot: 3 },
      planetCount: 1,
      planetName: "Home",
      homePlanetId: "pl1",
      level: 1,
      xpTotal: 0,
      allianceTag: "SOL",
      artId: "art",
      artUrl: "/art.webp",
      artThumbUrl: "/art-thumb.webp",
    };
    setCategoryBoards({
      buildings: [row],
      fleet: [],
      research: [],
      defense: [],
    });
    setHighscoreTab("buildings");
    try {
      const html = pageHtml("highscore", view, false, null);
      assert.match(html, /data-testid="highscore-tab-buildings"/);
      assert.match(html, /data-testid="highscore-tab-fleet"/);
      assert.match(html, /data-testid="highscore-tab-research"/);
      assert.match(html, /data-testid="highscore-tab-defense"/);
      assert.match(html, /data-testid="highscore-category-buildings"/);
      assert.match(html, /data-testid="highscore-buildings-1"/);
      assert.match(html, /\[SOL\] Alpha/);
      assert.match(html, /\(you\)/);
      setHighscoreTab("fleet");
      const empty = pageHtml("highscore", view, false, null);
      assert.match(empty, /data-testid="highscore-category-empty"/);
      assert.doesNotMatch(empty, /data-testid="highscore-buildings-1"/);
      setHighscoreTab("players");
      const players = pageHtml("highscore", view, false, null);
      assert.match(players, /data-testid="highscores-list"/);
      assert.doesNotMatch(players, /data-testid="highscore-category-buildings"/);
    } finally {
      setHighscoreTab("players");
      resetCategoryBoards();
    }
  });
});

describe("fleet tab", () => {
  it("shows fleet controls and links to Messages without inline fleets or reports", () => {
    const view = {
      now: 1_700_000_000_000,
      player: { id: "p1", name: "Alpha", research: {} },
      planet: {
        id: "pl1",
        name: "Home",
        kind: "planet",
        coords: { galaxy: 1, system: 1, slot: 8 },
        ships: {},
        buildings: {},
      },
      roster: [],
      ownedPlanets: [],
      galaxy: { galaxy: 1, system: 1, slots: [] },
      fleets: [],
      hostileInbound: [],
      sensorContacts: [],
      fleetSlotCap: 5,
      expeditionSlotCap: 2,
      universe: { speed: 1, fleetSpeed: 1 },
    } as unknown as PlayerView;

    const html = pageHtml("fleet", view, false, null);
    assert.match(html, /data-testid="fleets-panel"/);
    assert.match(html, /data-testid="fleet-form"/);
    assert.match(html, /data-testid="fleet-messages-link"/);
    assert.doesNotMatch(html, /data-testid="fleets-live"/);
    assert.doesNotMatch(html, /data-testid="combat-reports"/);
    assert.doesNotMatch(html, /data-testid="spy-reports"/);
    assert.doesNotMatch(html, /data-testid="expedition-reports"/);
  });
});
