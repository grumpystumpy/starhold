import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILDINGS, RESEARCH } from "./catalog.js";
import { buildingUpgradeCost, researchUpgradeCost, spend } from "./formulas-build.js";
import {
  createUniverse,
  joinUniverse,
  migrateOrResetUniverse,
  previewBuildingUpgrade,
  previewResearchUpgrade,
  queueBuildingUpgrade,
} from "./world.js";

describe("upgrade and research gates", () => {
  it("uses the approved research prerequisite table", () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(RESEARCH).map(([id, def]) => [
          id,
          { labLevel: def.labLevel, requires: def.requires ?? {} },
        ]),
      ),
      {
        energyTech: { labLevel: 1, requires: {} },
        combustionDrive: { labLevel: 1, requires: { energyTech: 1 } },
        weaponsTech: { labLevel: 4, requires: {} },
        armourTech: { labLevel: 2, requires: {} },
        shieldingTech: { labLevel: 6, requires: { energyTech: 3 } },
        espionageTech: { labLevel: 3, requires: {} },
        astrophysics: {
          labLevel: 3,
          requires: { espionageTech: 4, combustionDrive: 3 },
        },
        computerTech: { labLevel: 1, requires: {} },
        queueLogistics: { labLevel: 4, requires: { computerTech: 2 } },
        swarmHold: {
          labLevel: 7,
          requires: { astrophysics: 4, computerTech: 4 },
        },
        gravityWell: {
          labLevel: 12,
          requires: { energyTech: 8, shieldingTech: 5 },
        },
        metallurgistTech: { labLevel: 1, requires: { energyTech: 1 } },
        crystalizerTech: { labLevel: 1, requires: { energyTech: 1 } },
        deutSynthesisTech: { labLevel: 2, requires: { energyTech: 2 } },
        researchNetwork: {
          labLevel: 12,
          requires: { computerTech: 8, gravityWell: 1 },
        },
      },
    );
  });

  it("blocks gated research until its lab and technology requirements are met", () => {
    const universe = createUniverse("Research Prerequisites", 8);
    const { player, planet } = joinUniverse(
      universe,
      "Researcher",
      1_700_000_000_000,
    );
    const body = universe.planets[planet.id]!;
    const owner = universe.players[player.id]!;
    body.resources = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };
    body.buildings.researchLab = 1;

    const missingPower = previewResearchUpgrade(
      owner,
      body,
      "combustionDrive",
      1,
      1_700_000_000_000,
    );
    assert.equal(missingPower.ok, false);
    if (missingPower.ok) return;
    assert.match(missingPower.error, /Needs Power Discipline level 1 \(have 0\)/);

    owner.research.energyTech = 1;
    assert.equal(
      previewResearchUpgrade(
        owner,
        body,
        "combustionDrive",
        1,
        1_700_000_000_000,
      ).ok,
      true,
    );

    const missingLab = previewResearchUpgrade(
      owner,
      body,
      "weaponsTech",
      1,
      1_700_000_000_000,
    );
    assert.equal(missingLab.ok, false);
    if (missingLab.ok) return;
    assert.match(missingLab.error, /Needs Research Lab level 4 \(best lab 1\)/);
  });

  it("grandfathers existing levels from new research gates", () => {
    const universe = createUniverse("Grandfathered Research", 8);
    const { player, planet } = joinUniverse(
      universe,
      "Veteran",
      1_700_000_000_000,
    );
    const body = universe.planets[planet.id]!;
    const owner = universe.players[player.id]!;
    body.resources = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };
    body.buildings.researchLab = 2;
    owner.research.shieldingTech = 3;
    const oldSave = JSON.parse(JSON.stringify(universe)) as typeof universe;
    oldSave.schemaVersion = 4;
    const loaded = migrateOrResetUniverse(oldSave).universe;
    const loadedOwner = loaded.players[player.id]!;
    const loadedBody = loaded.planets[planet.id]!;

    assert.equal(loadedOwner.research.shieldingTech, 3);
    assert.deepEqual(loadedBody.resources, body.resources);
    assert.deepEqual(loadedBody.buildings, body.buildings);

    const nextLevel = previewResearchUpgrade(
      loadedOwner,
      loadedBody,
      "shieldingTech",
      loadedBody.buildings.researchLab ?? 0,
      1_700_000_000_000,
    );
    assert.equal(nextLevel.ok, true);
    if (nextLevel.ok) assert.equal(nextLevel.targetLevel, 4);
  });

  it("applies the local Research Lab bonus to research cost", () => {
    assert.deepEqual(researchUpgradeCost("energyTech", 0, 0), {
      metal: 0,
      crystal: 80,
      deuterium: 40,
    });
    assert.deepEqual(researchUpgradeCost("energyTech", 0, 1), {
      metal: 0,
      crystal: 79,
      deuterium: 39,
    });
    assert.deepEqual(researchUpgradeCost("energyTech", 0, 10), {
      metal: 0,
      crystal: 72,
      deuterium: 36,
    });
  });

  it("keeps research cost at zero for labs at and above level 100", () => {
    const resources = { metal: 100, crystal: 100, deuterium: 100 };
    for (const labLevel of [100, 150]) {
      const cost = researchUpgradeCost("energyTech", 0, labLevel);
      assert.ok(cost.metal >= 0 && cost.crystal >= 0 && cost.deuterium >= 0);
      assert.deepEqual(spend(resources, cost), resources);
    }
  });

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
    assert.deepEqual(ready.cost, researchUpgradeCost("energyTech", 0, 1));

    const higher = previewResearchUpgrade(
      owner,
      body,
      "shieldingTech",
      1,
      1_700_000_000_000,
    );
    assert.equal(higher.ok, false);
    if (higher.ok) return;
    assert.match(higher.error, /Needs Research Lab level 6 \(best lab 1\)/);

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
