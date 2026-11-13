import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  DEFENSES,
  RESEARCH,
  RIG_FOUNDRY_SHIPYARD_REQ,
  SHIPS,
  buildingUpgradeCost,
  defenseCost,
  researchUpgradeCost,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCost } from "./format";
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

function catalogView(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Alpha",
      level: 1,
      research: { weaponsTech: 2 },
      researchQueue: [],
      officers: [],
      skillsUnlocked: [],
      playerClass: { classId: "explorer" },
    },
    planet: {
      id: "pl1",
      name: "Home",
      kind: "planet",
      fieldsCap: 200,
      coords: { galaxy: 1, system: 1, slot: 4 },
      buildings: { solarPlant: 1, researchLab: 1 },
      resources: { metal: 50_000, crystal: 50_000, deuterium: 20_000 },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    ownedPlanets: [{ id: "pl1", researchLab: 1, isMoon: false }],
    economy: { fields: { used: 2, cap: 200, remaining: 198 } },
    universe: { speed: 1 },
    researchTimeMult: 1,
  } as unknown as PlayerView;
}

function article(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, testId);
  const open = html.lastIndexOf("<article", start);
  const close = html.indexOf("</article>", start);
  assert.ok(open >= 0 && close > open, testId);
  return html.slice(open, close + "</article>".length);
}

function assertCatalogTip(
  row: string,
  effect: string,
  cost: string,
  requirement: string,
): void {
  assert.match(row, /data-testid="cost-tip"/);
  assert.match(row, /aria-expanded="false"/);
  assert.match(row, /role="button"/);
  assert.match(row, /role="tooltip"/);
  assert.match(row, new RegExp(effect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(row, new RegExp(`Cost: ${cost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(row, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const tipAt = row.indexOf('data-testid="cost-tip"');
  const actionsAt = row.indexOf('class="actions"');
  assert.ok(tipAt >= 0 && actionsAt > tipAt);
  const buttonAt = row.indexOf("<button");
  assert.ok(buttonAt > actionsAt);
}

describe("catalog row tooltips", () => {
  it("gives every building row cost, requirements, and effect", () => {
    const html = pageHtml("buildings", catalogView(), false, null);
    const rows = html.match(/<article /g) ?? [];
    const tips = html.match(/data-testid="cost-tip"/g) ?? [];
    assert.ok(rows.length > 0);
    assert.equal(tips.length, rows.length);
    const mine = article(html, "building-metalMine");
    assertCatalogTip(
      mine,
      BUILDINGS.metalMine.description,
      fmtCost(buildingUpgradeCost("metalMine", 0)),
      `Energy use +${fmt(BUILDINGS.metalMine.energyUsePerLevel ?? 0)}/level`,
    );
    const foundry = article(html, "building-rigFoundry");
    assert.match(
      foundry,
      new RegExp(
        `${BUILDINGS.shipyard.name} L${fmt(RIG_FOUNDRY_SHIPYARD_REQ)}\\+ \\(current L0\\)`,
      ),
    );
  });

  it("gives every research row cost, requirements, and effect", () => {
    const html = pageHtml("research", catalogView(), false, null);
    const rows = html.match(/<article /g) ?? [];
    const tips = html.match(/data-testid="cost-tip"/g) ?? [];
    assert.ok(rows.length > 0);
    assert.equal(tips.length, rows.length);
    const tech = article(html, "research-energyTech");
    assertCatalogTip(
      tech,
      RESEARCH.energyTech.description,
      fmtCost(researchUpgradeCost("energyTech", 0, 1)),
      "Research Lab L1+",
    );
  });

  it("gives every shipyard row cost, requirements, and effect", () => {
    const html = pageHtml("shipyard", catalogView(), false, null);
    const rows = html.match(/<article /g) ?? [];
    const tips = html.match(/data-testid="cost-tip"/g) ?? [];
    assert.ok(rows.length > 0);
    assert.equal(tips.length, rows.length);
    const scout = article(html, "ship-scout");
    assertCatalogTip(
      scout,
      SHIPS.scout.description,
      fmtCost(SHIPS.scout.cost),
      `Shipyard L${fmt(SHIPS.scout.shipyardLevel)}+`,
    );
    const capital = article(html, "ship-keelSovereign");
    assert.match(capital, /Ordnance Doctrine L6\+ \(current L2\)/);
    const exclusive = article(html, "ship-vaultScout");
    assert.match(exclusive, /Explorer class/);
  });

  it("gives every defense row cost, requirements, and effect", () => {
    const html = pageHtml("defenses", catalogView(), false, null);
    const rows = html.match(/<article /g) ?? [];
    const tips = html.match(/data-testid="cost-tip"/g) ?? [];
    assert.ok(rows.length > 0);
    assert.equal(tips.length, rows.length);
    const gun = article(html, "defense-laserBattery");
    assertCatalogTip(
      gun,
      DEFENSES.laserBattery.description,
      fmtCost(defenseCost("laserBattery", 1)),
      `Shipyard L${fmt(DEFENSES.laserBattery.shipyardLevel)}+`,
    );
  });
});
