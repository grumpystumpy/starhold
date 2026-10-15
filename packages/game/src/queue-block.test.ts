import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILDINGS } from "./catalog.js";
import { buildingUpgradeCost } from "./formulas-build.js";
import {
  createUniverse,
  joinUniverse,
  previewBuildingUpgrade,
  previewResearchUpgrade,
  queueBuildingUpgrade,
} from "./world.js";

describe("upgrade and research gates", () => {
  it("blocks an unaffordable Solar Array upgrade, including a queued level", () => {
    const universe = createUniverse("Gate Solar", 8);
    const { player, planet } = joinUniverse(universe, "Solar", 1_700_000_000_000);
    const body = universe.planets[planet.id]!;
    const owner = universe.players[player.id]!;
    body.buildings.solarPlant = 2;
    body.resources = { metal: 10, crystal: 0, deuterium: 0 };
    const blocked = previewBuildingUpgrade(
      body,
      owner,
      "solarPlant",
      1_700_000_000_000,
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error, "Not enough resources.");
    const cost = buildingUpgradeCost("solarPlant", 2);
    assert.equal(blocked.cost.metal, cost.metal);
    assert.ok(cost.metal > 10);

    body.resources = { metal: 100_000, crystal: 100_000, deuterium: 50_000 };
    const queued = queueBuildingUpgrade(
      universe,
      player.id,
      "solarPlant",
      1_700_000_000_000,
    );
    assert.equal(queued.ok, true);
    const live = universe.planets[planet.id]!;
    live.resources = {
      metal: cost.metal,
      crystal: cost.crystal,
      deuterium: 0,
    };
    const next = previewBuildingUpgrade(
      live,
      universe.players[player.id]!,
      "solarPlant",
      1_700_000_000_000,
    );
    assert.equal(next.ok, false);
    if (next.ok) return;
    assert.equal(next.error, "Not enough resources.");
    assert.equal(next.current, 3);
  });

  it("reports the real building queue cap instead of the hard max", () => {
    const universe = createUniverse("Gate Queue", 8);
    const { player, planet } = joinUniverse(universe, "Queue", 1_700_000_000_000);
    const body = universe.planets[planet.id]!;
    body.resources = { metal: 500_000, crystal: 500_000, deuterium: 100_000 };
    assert.equal(
      queueBuildingUpgrade(universe, player.id, "metalMine", 1_700_000_000_000)
        .ok,
      true,
    );
    assert.equal(
      queueBuildingUpgrade(
        universe,
        player.id,
        "crystalMine",
        1_700_000_000_000,
      ).ok,
      true,
    );
    const third = previewBuildingUpgrade(
      universe.planets[planet.id]!,
      universe.players[player.id]!,
      "solarPlant",
      1_700_000_000_000,
    );
    assert.equal(third.ok, false);
    if (third.ok) return;
    assert.match(third.error, /queue is full \(2\/2\)/);
  });

  it("uses the best lab and shows queue-full before a lab complaint", () => {
    const universe = createUniverse("Gate Lab", 8);
    const { player, planet } = joinUniverse(universe, "Lab", 1_700_000_000_000);
    const body = universe.planets[planet.id]!;
    const owner = universe.players[player.id]!;
    body.buildings.researchLab = 1;
    body.resources = { metal: 50_000, crystal: 50_000, deuterium: 20_000 };
    const ready = previewResearchUpgrade(
      owner,
      body,
      "energyTech",
      1,
      1_700_000_000_000,
    );
    assert.equal(ready.ok, true);

    const higher = previewResearchUpgrade(
      owner,
      body,
      "shieldingTech",
      1,
      1_700_000_000_000,
    );
    assert.equal(higher.ok, false);
    if (higher.ok) return;
    assert.match(higher.error, /Needs Research Lab level 2 \(best lab 1\)/);

    owner.researchQueue = [
      {
        id: "q1",
        kind: "research",
        researchId: "energyTech",
        targetLevel: 1,
        enqueuedAt: 1,
        completesAt: 2,
        workSeconds: 10,
        startedAt: 1,
        paidCost: { metal: 0, crystal: 80, deuterium: 40 },
      },
    ];
    const full = previewResearchUpgrade(
      owner,
      body,
      "energyTech",
      1,
      1_700_000_000_000,
    );
    assert.equal(full.ok, false);
    if (full.ok) return;
    assert.match(full.error, /Research queue is full \(1\/1\)/);
  });

  it("keeps the Mantle Loom description free of internal keys", () => {
    assert.equal(
      BUILDINGS.mantleLoom.description.includes("fieldsCap"),
      false,
    );
    assert.match(BUILDINGS.mantleLoom.description, /5 fields per level/);
    assert.doesNotMatch(BUILDINGS.mantleLoom.description, /_/);
  });
});
