import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { buildingRow, joinScreenHtml } from "./render-chrome-join";
import { researchRow } from "./render-chrome-rows";
import { fleetComposer } from "./render-fleets-composer";
import { spyReportsHtml } from "./render-fleets-panels";
import { messagesPageHtml } from "./render-messages";
import { seasonsPage } from "./render-seasons";

function player(): PlayerView["player"] {
  return {
    id: "p1",
    name: "Alpha",
    research: {},
    researchQueue: [],
    officers: [],
    skillsUnlocked: [],
    cosmetics: {
      titles: [],
      activeTitle: null,
      planetSkinIds: [],
      activePlanetSkinId: null,
    },
  } as PlayerView["player"];
}

function planet(): PlayerView["planet"] {
  return {
    id: "pl1",
    kind: "planet",
    fieldsCap: 200,
    buildings: { solarPlant: 2, researchLab: 1 },
    resources: { metal: 0, crystal: 0, deuterium: 0 },
    buildQueue: [],
    coords: { galaxy: 1, system: 1, slot: 4 },
    ships: {},
  } as PlayerView["planet"];
}

describe("playtest fixes", () => {
  it("disables an unaffordable Solar Array upgrade", () => {
    const html = buildingRow(
      "solarPlant",
      planet(),
      player(),
      1,
      1_700_000_000_000,
      false,
    );
    assert.match(html, /data-testid="upgrade-solarPlant"[^>]*disabled/);
    assert.match(html, />Can't afford</);
    assert.doesNotMatch(html, />Upgrade</);
  });

  it("shows queue-full and the real lab requirement", () => {
    const base = {
      now: 1_700_000_000_000,
      player: player(),
      planet: {
        ...planet(),
        resources: { metal: 50_000, crystal: 50_000, deuterium: 20_000 },
        buildings: { researchLab: 0 },
      },
      ownedPlanets: [
        {
          id: "home",
          researchLab: 1,
        },
      ],
      universe: { speed: 1 },
    } as unknown as PlayerView;

    const ready = researchRow("energyTech", base, false);
    assert.match(ready, />Research</);
    assert.doesNotMatch(ready, /Needs lab</);
    assert.doesNotMatch(ready, /disabled/);

    const needsTwo = researchRow("shieldingTech", base, false);
    assert.match(needsTwo, />Needs lab 2</);
    assert.match(needsTwo, /disabled/);
    assert.doesNotMatch(needsTwo, />Needs lab</);

    base.player.researchQueue = [
      {
        id: "q1",
        kind: "research",
        researchId: "energyTech",
        targetLevel: 1,
        enqueuedAt: 1,
        completesAt: 2,
        workSeconds: 10,
        startedAt: 1,
        paidCost: { metal: 0, crystal: 1, deuterium: 0 },
      },
    ] as PlayerView["player"]["researchQueue"];
    const full = researchRow("energyTech", base, false);
    assert.match(full, />Queue full</);
    assert.match(full, /disabled/);
    assert.doesNotMatch(full, /Needs lab/);
  });

  it("labels spy targets and hides protected attack targets", () => {
    const view = {
      now: 1_700_000_000_000,
      player: { ...player(), research: {}, fleetPresets: [] },
      planet: planet(),
      roster: [
        {
          id: "p1",
          name: "Alpha",
          planetId: "pl1",
          pointsHint: 100,
          coords: { galaxy: 1, system: 1, slot: 4 },
        },
        {
          id: "p2",
          name: "Newbie",
          planetId: "pl2",
          pointsHint: 2499,
          coords: { galaxy: 1, system: 1, slot: 5 },
        },
        {
          id: "p3",
          name: "Veteran",
          planetId: "pl3",
          pointsHint: 2500,
          coords: { galaxy: 1, system: 1, slot: 6 },
        },
      ],
      ownedPlanets: [],
      galaxy: {
        galaxy: 1,
        system: 1,
        slots: [
          {
            moonId: "moon2",
            playerId: "p2",
            coords: { galaxy: 1, system: 1, slot: 5 },
          },
          {
            moonId: "moon3",
            playerId: "p3",
            coords: { galaxy: 1, system: 1, slot: 6 },
          },
        ],
        asteroids: [],
      },
      fleets: [],
      universe: { speed: 1, fleetSpeed: 1 },
      alliance: null,
    } as unknown as PlayerView;

    const spy = fleetComposer(view, false, {
      targetPlanetId: null,
      targetCoords: null,
      asteroidId: null,
      pirateBaseId: null,
      alienBaseId: null,
      mission: "espionage",
      counts: {},
      cargo: {},
      openAcs: false,
    });
    assert.match(spy, /Spy Newbie/);
    assert.match(spy, /Spy Veteran/);
    assert.match(spy, /Spy moon @ 1:1:5/);
    assert.doesNotMatch(spy, /Attack Newbie/);
    assert.doesNotMatch(spy, /Attack Veteran/);

    const raid = fleetComposer(view, false, {
      targetPlanetId: null,
      targetCoords: null,
      asteroidId: null,
      pirateBaseId: null,
      alienBaseId: null,
      mission: "raid",
      counts: {},
      cargo: {},
      openAcs: false,
    });
    assert.match(raid, /Attack Veteran/);
    assert.match(raid, /Attack moon @ 1:1:6/);
    assert.doesNotMatch(raid, /Newbie/);
    assert.doesNotMatch(raid, /Attack moon @ 1:1:5/);

    const protectedOnly = fleetComposer(
      {
        ...view,
        roster: view.roster.filter((r) => r.id !== "p3"),
        galaxy: { ...view.galaxy, slots: [] },
      },
      false,
      {
        targetPlanetId: null,
        targetCoords: null,
        asteroidId: null,
        pirateBaseId: null,
        alienBaseId: null,
        mission: "raid",
        counts: {},
        cargo: {},
        openAcs: false,
      },
    );
    assert.match(protectedOnly, /under 2,500 points are protected/);
    assert.doesNotMatch(protectedOnly, /Attack Newbie/);
  });

  it("opens spy reports and does not count them as combat", () => {
    const view = {
      now: 1_700_000_000_000,
      player: player(),
      planet: planet(),
      reports: [],
      spyReports: [
        {
          id: "s1",
          at: 300,
          missionId: "m2",
          spyPlayerId: "p1",
          targetPlayerId: "p2",
          targetName: "Newbie",
          targetCoords: { galaxy: 1, system: 2, slot: 3 },
          detail: 3,
          resources: { metal: 1000, crystal: 20, deuterium: 100 },
          buildings: { solarPlant: 3, metalMine: 0 },
          ships: { scout: 2 },
          defenses: null,
          research: { energyTech: 1 },
          summary: "Full structural scan of Newbie succeeded.",
        },
      ],
      expeditionReports: [],
    } as unknown as PlayerView;

    const html = messagesPageHtml(view, { filter: "all" });
    assert.match(html, /0 combat · 1 spy/);
    assert.match(html, /data-testid="spy-detail-s1"/);
    assert.match(html, /Full report/);
    assert.match(html, /Solar Array L3/);
    assert.match(html, /1,000/);
    assert.match(html, /Power Discipline/);
    assert.doesNotMatch(html, /solarPlant|energyTech|fieldsCap/);

    const combat = messagesPageHtml(view, { filter: "combat" });
    assert.match(combat, /Nothing in this filter/);
    assert.doesNotMatch(combat, /spy-detail-s1/);

    const spyFilter = messagesPageHtml(view, { filter: "spy" });
    assert.match(spyFilter, /spy-detail-s1/);
  });

  it("separates Share with alliance from the preceding number", () => {
    const html = spyReportsHtml(
      [
        {
          id: "s9",
          at: 1,
          missionId: "m",
          spyPlayerId: "p1",
          targetPlayerId: "p2",
          targetName: "Newbie",
          targetCoords: { galaxy: 1, system: 1, slot: 8 },
          detail: 1,
          resources: { metal: 0, crystal: 0, deuterium: 100 },
          buildings: null,
          ships: null,
          defenses: null,
          research: null,
          summary: "Resource scan",
        },
      ],
      true,
    );
    assert.match(html, /spy-share">&nbsp;<button/);
    assert.match(html, /Share with alliance/);
    assert.doesNotMatch(html, /100Share/);
    assert.doesNotMatch(html, /100<\/span><button/);
  });

  it("explains economy scoring with a tooltip", () => {
    const view = {
      player: player(),
      seasonLeaderboard: {
        seasonId: "2026-10",
        scores: { combat: 0, economy: 0, pirateKills: 0 },
        economyRemainder: 480,
        ranks: { combat: null, economy: null, pirateKills: null },
        boards: { combat: [], economy: [], pirateKills: [] },
        claims: [],
      },
    } as unknown as PlayerView;
    const html = seasonsPage(view, false);
    assert.match(html, /data-testid="season-economy-tip"/);
    assert.match(html, /1 point for every 1,000/);
    assert.match(html, /480 resources are banked/);
    assert.doesNotMatch(html, /fieldsCap/);
  });

  it("drops developer copy and the auth form after signup", () => {
    const guest = joinScreenHtml({
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
    });
    assert.match(guest, /data-testid="auth-form"/);
    assert.doesNotMatch(guest, /Automation/);
    assert.doesNotMatch(guest, /commander=/);

    const signedIn = joinScreenHtml({
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
      accountEmail: "playtest@example.com",
    });
    assert.match(signedIn, /data-testid="join-form"/);
    assert.match(signedIn, /Signed in as/);
    assert.doesNotMatch(signedIn, /data-testid="auth-form"/);
    assert.doesNotMatch(signedIn, /Automation/);
    assert.doesNotMatch(signedIn, /commander=/);
    assert.doesNotMatch(signedIn, /window\.starhold/);
  });
});
