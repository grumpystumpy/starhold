import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { pageHtml, setHighscoreTab } from "./render-pages";

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

  it("renders a cached category tab and escapes the commander name", () => {
    const rawName = "<" + "Ops>";
    const escaped = "&" + "lt;Ops" + "&" + "gt;";
    const view = {
      player: { id: "p1", name: "Alpha" },
      highscores: [],
      roster: [],
      categoryHighscores: {
        buildings: [{ rank: 1, playerId: "p9", name: rawName, points: 42, allianceTag: null }],
        fleet: [],
        research: [],
        defense: [],
      },
    } as unknown as PlayerView;
    setHighscoreTab("buildings");
    try {
      const html = pageHtml("highscore", view, false, null);
      assert.match(html, /data-testid="highscore-tab-buildings"/);
      assert.match(html, /data-testid="highscore-tab-fleet"/);
      assert.match(html, /data-testid="highscore-tab-research"/);
      assert.match(html, /data-testid="highscore-tab-defense"/);
      assert.match(html, /data-testid="category-highscores-buildings"/);
      assert.equal(html.includes(escaped), true);
      assert.equal(html.includes(rawName), false);
      assert.doesNotMatch(html, /data-testid="highscores-list"/);
    } finally {
      setHighscoreTab("players");
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
