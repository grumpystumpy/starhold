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

  it("draws a 7-day sparkline on commander rows, including you, and omits it when history is missing", () => {
    setHighscoreTab("players");
    const row = {
      artId: "art",
      artUrl: "/art.webp",
      artThumbUrl: "/art-thumb.webp",
      coords: { galaxy: 1, system: 1, slot: 8 },
      planetCount: 1,
      planetName: "Home",
      homePlanetId: "home",
      level: 1,
      xpTotal: 0,
      points: 1200,
    };
    const view = {
      player: { id: "p1" },
      roster: [],
      highscores: [
        {
          ...row,
          rank: 1,
          playerId: "p1",
          name: "Ada",
          rankHistory: [
            { day: "2026-11-04", rank: 2 },
            { day: "2026-11-10", rank: 1 },
          ],
        },
        {
          ...row,
          rank: 2,
          playerId: "p2",
          name: "Bea",
          homePlanetId: "home-2",
          rankHistory: [{ day: "2026-11-10", rank: 2 }],
        },
        {
          ...row,
          rank: 3,
          playerId: "p3",
          name: "Cy",
          homePlanetId: "home-3",
          rankHistory: "legacy" as unknown as undefined,
        },
      ],
    } as unknown as PlayerView;

    const html = pageHtml("highscore", view, false, null);
    assert.match(html, /data-testid="highscore-tab-players"[^>]*aria-pressed="true"/);
    const you = html.slice(html.indexOf('data-testid="highscore-1"'), html.indexOf('data-testid="highscore-2"'));
    assert.match(you, /\(you\)/);
    assert.match(you, /data-testid="highscore-sparkline" data-player-id="p1"/);
    assert.match(you, /<polyline /);
    assert.match(html, /data-testid="highscore-sparkline" data-player-id="p2"/);
    const legacy = html.slice(html.indexOf('data-testid="highscore-3"'));
    assert.doesNotMatch(legacy, /data-testid="highscore-sparkline"/);

    const empty = {
      player: { id: "p1" },
      roster: [],
      highscores: [{ ...row, rank: 1, playerId: "p1", name: "Ada" }],
    } as unknown as PlayerView;
    const bare = pageHtml("highscore", empty, false, null);
    assert.match(bare, /\(you\)/);
    assert.doesNotMatch(bare, /data-testid="highscore-sparkline"/);
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
