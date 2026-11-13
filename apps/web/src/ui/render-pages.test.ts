import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILDINGS, DEFENSES, SHIPS, type PlayerView } from "@starhold/game";
import { pageHtml } from "./render-pages";

function overviewBody(
  id: string,
  name: string,
  resources: { metal: number; crystal: number; deuterium: number },
  queues: Pick<
    PlayerView["ownedPlanets"][number],
    "buildQueueHead" | "shipQueueHead" | "defenseQueueHead"
  > = {
    buildQueueHead: null,
    shipQueueHead: null,
    defenseQueueHead: null,
  },
): PlayerView["ownedPlanets"][number] {
  return {
    id,
    name,
    coords: { galaxy: 1, system: 1, slot: 1 },
    isHome: id === "home",
    isActive: id === "home",
    isMoon: false,
    isMini: false,
    jumpGateLevel: 0,
    researchLab: 0,
    artId: "earth",
    artUrl: "",
    artThumbUrl: "",
    resources,
    ...queues,
  };
}

function overviewView(ownedPlanets: PlayerView["ownedPlanets"]): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Commander",
      cosmetics: {},
      research: {},
      researchQueue: [],
    },
    planet: {
      id: "home",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 1 },
      resources: { metal: 2500, crystal: 400, deuterium: 50 },
      buildings: { metalMine: 1, researchLab: 1 },
      ships: {},
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    },
    planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
    ownedPlanets,
    economy: {
      fields: { used: 1, cap: 100, remaining: 99 },
      positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
      energy: { factor: 1, produced: 100, used: 50 },
      temperatureK: 250,
    },
    goals: [],
  } as unknown as PlayerView;
}

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

describe("empire overview strip", () => {
  it("shows multiple bodies, resource totals, and each queue head", () => {
    const view = overviewView([
      overviewBody("home", "Home", { metal: 2500, crystal: 400, deuterium: 50 }, {
        buildQueueHead: { buildingId: "metalMine", targetLevel: 2 },
        shipQueueHead: { shipId: "scout", count: 3 },
        defenseQueueHead: { defenseId: "laserBattery", count: 4 },
      }),
      overviewBody("colony", "Colony", { metal: 750, crystal: 600, deuterium: 150 }),
    ]);

    const html = pageHtml("overview", view, false, null);
    assert.match(html, /data-testid="empire-overview-strip"/);
    assert.match(html, /data-testid="empire-planet-row-home"/);
    assert.match(html, /data-testid="empire-planet-row-colony"/);
    assert.match(html, /data-testid="empire-metal-total">3\.2k</);
    assert.match(html, /data-testid="empire-crystal-total">1k</);
    assert.match(html, /data-testid="empire-deuterium-total">200</);
    assert.ok(html.includes(`Building ${BUILDINGS.metalMine.name} → L2`));
    assert.ok(html.includes(`Ships 3× ${SHIPS.scout.name}`));
    assert.ok(html.includes(`Defense 4× ${DEFENSES.laserBattery.name}`));
  });

  it("omits the strip for one body and omits empty queue details", () => {
    const single = pageHtml(
      "overview",
      overviewView([overviewBody("home", "Home", { metal: 1, crystal: 2, deuterium: 3 })]),
      false,
      null,
    );
    assert.doesNotMatch(single, /data-testid="empire-overview-strip"/);

    const empty = pageHtml(
      "overview",
      overviewView([
        overviewBody("home", "Home", { metal: 1, crystal: 2, deuterium: 3 }),
        overviewBody("colony", "Colony", { metal: 4, crystal: 5, deuterium: 6 }),
      ]),
      false,
      null,
    );
    assert.match(empty, /data-testid="empire-overview-strip"/);
    assert.doesNotMatch(empty, /class="empire-overview-queues"/);
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
