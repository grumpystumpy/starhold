import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RESEARCH, RESEARCH_ORDER, type PlayerView } from "@starhold/game";
import { evaluateResearchNode, researchTreeMapHtml, RESEARCH_TIERS } from "./render-research-tree";
import { pageHtml } from "./render-pages";

function mockPlayerView(overrides?: Partial<PlayerView>): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Commander",
      research: {},
      researchQueue: [],
      skillsUnlocked: [],
      fleetPresets: [],
      ...overrides?.player,
    },
    planet: {
      id: "pl1",
      name: "Home",
      coords: { galaxy: 1, system: 1, slot: 4 },
      resources: { metal: 100_000, crystal: 100_000, deuterium: 50_000 },
      buildings: { researchLab: 1 },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
      ...overrides?.planet,
    },
    ownedPlanets: [
      {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 4 },
        researchLab: 1,
        isMoon: false,
      },
    ],
    economy: {
      positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
      fields: { used: 1, cap: 200, remaining: 199 },
      energy: {},
    },
    universe: {
      speed: 1,
    },
    galaxy: { galaxy: 1, system: 1 },
    fleets: [],
    roster: [],
    planetArt: { artUrl: "", artThumbUrl: "", artId: "rocky" },
    ...overrides,
  } as unknown as PlayerView;
}

describe("research tree map", () => {
  it("covers all 17 RESEARCH_ORDER technologies across the configured tiers", () => {
    const tieredIds = RESEARCH_TIERS.flatMap((t) => t.ids);
    assert.equal(tieredIds.length, RESEARCH_ORDER.length);
    assert.deepEqual([...tieredIds].sort(), [...RESEARCH_ORDER].sort());
  });

  it("renders container with data-testid='research-tree-map' and all 17 node testids", () => {
    const view = mockPlayerView();
    const html = researchTreeMapHtml(view, false);
    assert.ok(html.includes('data-testid="research-tree-map"'));
    for (const id of RESEARCH_ORDER) {
      assert.ok(
        html.includes(`data-testid="research-tree-node-${id}"`),
        `must render node for ${id}`,
      );
      assert.ok(
        html.includes(`data-testid="research-tree-level-${id}"`),
        `must render level for ${id}`,
      );
    }
  });

  it("evaluates locked vs available nodes accurately based on research and lab prereqs", () => {
    const view = mockPlayerView({
      planet: {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 4 },
        resources: { metal: 100_000, crystal: 100_000, deuterium: 50_000 },
        buildings: { researchLab: 1 },
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: {},
        defenses: {},
      },
      player: {
        id: "p1",
        name: "Commander",
        research: {},
        researchQueue: [],
        skillsUnlocked: [],
        fleetPresets: [],
      },
    });

    // energyTech has lab 1 req, no research req -> available
    const energyState = evaluateResearchNode("energyTech", view, 0);
    assert.equal(energyState.status, "available");
    assert.equal(energyState.lockReason, null);

    // combustionDrive requires energyTech 1 -> locked
    const driveState = evaluateResearchNode("combustionDrive", view, 1);
    assert.equal(driveState.status, "locked");
    assert.match(driveState.lockReason ?? "", /Requires Power Discipline L1/);

    // weaponsTech requires lab 4 -> locked when highest lab is 1
    const weaponsState = evaluateResearchNode("weaponsTech", view, 0);
    assert.equal(weaponsState.status, "locked");
    assert.match(weaponsState.lockReason ?? "", /Requires Research Lab L4/);
  });

  it("marks node researched when level > 0 and available when prereqs met at level 0", () => {
    const view = mockPlayerView({
      planet: {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 4 },
        resources: { metal: 100_000, crystal: 100_000, deuterium: 50_000 },
        buildings: { researchLab: 4 },
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: {},
        defenses: {},
      },
      ownedPlanets: [
        {
          id: "pl1",
          name: "Home",
          coords: { galaxy: 1, system: 1, slot: 4 },
          researchLab: 4,
          isMoon: false,
        },
      ],
      player: {
        id: "p1",
        name: "Commander",
        research: { energyTech: 1 },
        researchQueue: [],
        skillsUnlocked: [],
        fleetPresets: [],
      },
    });

    const energyState = evaluateResearchNode("energyTech", view, 0);
    assert.equal(energyState.status, "researched");
    assert.equal(energyState.level, 1);

    const driveState = evaluateResearchNode("combustionDrive", view, 1);
    assert.equal(driveState.status, "available");
    assert.equal(driveState.lockReason, null);
  });

  it("wires tree nodes with data-research and data-locked for client click handler", () => {
    const view = mockPlayerView({
      player: {
        id: "p1",
        name: "Commander",
        research: { energyTech: 1 },
        researchQueue: [],
        skillsUnlocked: [],
        fleetPresets: [],
      },
    });

    const html = researchTreeMapHtml(view, false);
    // Unlocked energyTech (can afford and met)
    assert.ok(html.includes('data-research="energyTech"'));
    assert.ok(html.includes('data-research="combustionDrive"'));
    // Locked node has data-locked="1"
    assert.ok(
      html.includes('data-research="astrophysics"') &&
        html.includes('data-locked="1"'),
      "unmet tech should have data-locked='1'",
    );
    assert.match(
      html,
      /data-research="astrophysics"\s+data-locked="1"/,
    );
  });

  it("renders on the research tab inside research-panel alongside researchRow items", () => {
    const view = mockPlayerView();
    const page = pageHtml("research", view, false, null);
    assert.ok(page.includes('data-testid="research-panel"'));
    assert.ok(page.includes('data-testid="research-tree-map"'));
    for (const id of RESEARCH_ORDER) {
      assert.ok(page.includes(`data-testid="research-${id}"`));
      assert.ok(page.includes(`data-testid="research-tree-node-${id}"`));
    }
  });
});
