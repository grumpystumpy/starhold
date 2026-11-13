import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { pageHtml } from "./render-pages";

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
});

describe("abandon colony control", () => {
  function overview(partial: {
    planetId: string;
    planetName: string;
    kind?: "planet" | "moon";
    homePlanetId?: string;
  }) {
    return {
      player: {
        id: "p1",
        name: "Commander",
        homePlanetId: partial.homePlanetId,
        cosmetics: {},
        research: {},
      },
      planet: {
        id: partial.planetId,
        name: partial.planetName,
        kind: partial.kind ?? "planet",
        coords: { galaxy: 1, system: 2, slot: 4 },
        buildings: {},
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: {},
        defenses: {},
      },
      planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
      economy: {
        fields: { used: 1, cap: 100, remaining: 99 },
        positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
        productionPerHour: { metal: 10, crystal: 10, deuterium: 10 },
        energy: { factor: 1, produced: 10, used: 1 },
        temperatureK: 200,
      },
      goals: [],
    } as unknown as PlayerView;
  }

  it("shows a named confirm dialog only for a non-home colony", () => {
    const colony = pageHtml(
      "overview",
      overview({ planetId: "col1", planetName: "Far Reach", homePlanetId: "home1" }),
      false,
      null,
    );
    assert.match(colony, /data-testid="abandon-colony-open"/);
    assert.match(colony, /data-testid="abandon-colony-dialog"/);
    assert.match(colony, /Abandon Far Reach\?/);
    assert.match(
      colony,
      /Buildings, docked ships, defenses, resources, and any moon are lost\./,
    );

    const home = pageHtml(
      "overview",
      overview({ planetId: "home1", planetName: "Cradle", homePlanetId: "home1" }),
      false,
      null,
    );
    assert.doesNotMatch(home, /data-testid="abandon-colony"/);

    const moon = pageHtml(
      "overview",
      overview({
        planetId: "moon1",
        planetName: "Far Reach Moon",
        kind: "moon",
        homePlanetId: "home1",
      }),
      false,
      null,
    );
    assert.doesNotMatch(moon, /data-testid="abandon-colony"/);
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
