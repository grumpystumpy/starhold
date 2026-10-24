import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE_INCOME_PER_HOUR } from "./data/tuning.js";
import {
  createUniverse,
  ensureUniverseShape,
  joinUniverse,
  mineOutputPerHour,
  productionPerHour,
  queueResearch,
  advancePlanet,
  advanceUniverse,
  RESEARCH,
  RESEARCH_ORDER,
  type UniverseState,
} from "./index.js";

describe("B4-04 Metallurgist / Crystalizer / Deut Synthesis Researches", () => {
  it("level 0 production equals today's production (baseline)", () => {
    const universe = createUniverse("Baseline Test", 1);
    const { planet } = joinUniverse(universe, "Alice", 100_000);
    planet.buildings.metalMine = 10;
    planet.buildings.crystalMine = 8;
    planet.buildings.deutSynth = 5;

    const unboostedRates = productionPerHour(planet, 1, 0, undefined, undefined);
    const levelZeroRates = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 0,
      deutSynthesisTech: 0,
    });

    assert.equal(levelZeroRates.metal, unboostedRates.metal);
    assert.equal(levelZeroRates.crystal, unboostedRates.crystal);
    assert.equal(levelZeroRates.deuterium, unboostedRates.deuterium);
  });

  it("level N gives +5% * N on mine output only; base income stays flat", () => {
    const universe = createUniverse("Mine Boost Test", 1);
    const { planet } = joinUniverse(universe, "Bob", 100_000);
    planet.buildings.metalMine = 10;
    planet.buildings.crystalMine = 8;
    planet.buildings.deutSynth = 5;
    planet.buildings.solarPlant = 30; // Adequate energy

    // Slot 4 neutral metal pos = 1.0
    const baseMetalMine = mineOutputPerHour("metal", 10) * 4; // PRODUCTION_MULT = 4
    const baseCrystalMine = mineOutputPerHour("crystal", 8) * 4 * 1.15; // slot 4 crystal pos = 1.15
    const baseDeutMine = mineOutputPerHour("deuterium", 5) * 4 * 0.85; // slot 4 deut pos = 0.85

    // Test Metallurgist Level 3 (+15%)
    const metalL3 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 3,
      crystalizerTech: 0,
      deutSynthesisTech: 0,
    });
    assert.equal(
      metalL3.metal,
      baseMetalMine * 1.15 + BASE_INCOME_PER_HOUR.metal,
      "Metal mine output scales by 1 + 0.05 * 3, base income stays flat",
    );
    assert.equal(metalL3.crystal, baseCrystalMine + BASE_INCOME_PER_HOUR.crystal);
    assert.equal(metalL3.deuterium, baseDeutMine + BASE_INCOME_PER_HOUR.deuterium);

    // Test Crystalizer Level 2 (+10%)
    const crystalL2 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 2,
      deutSynthesisTech: 0,
    });
    assert.equal(
      crystalL2.crystal,
      baseCrystalMine * 1.10 + BASE_INCOME_PER_HOUR.crystal,
      "Crystal mine output scales by 1 + 0.05 * 2, base income stays flat",
    );
    assert.equal(crystalL2.metal, baseMetalMine + BASE_INCOME_PER_HOUR.metal);

    // Test Deut Synthesis Level 4 (+20%)
    const deutL4 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 0,
      deutSynthesisTech: 4,
    });
    assert.equal(
      deutL4.deuterium,
      baseDeutMine * 1.20 + BASE_INCOME_PER_HOUR.deuterium,
      "Deut synth output scales by 1 + 0.05 * 4, base income stays flat",
    );
    assert.equal(deutL4.metal, baseMetalMine + BASE_INCOME_PER_HOUR.metal);
  });

  it("old save fixture loads with levels 0 and preserves all progress", () => {
    const path = fileURLToPath(
      new URL("../../../apps/server/src/fixtures/catalog-complete-save.json", import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(path, "utf8")) as {
      universe: UniverseState;
      planetId: string;
    };

    const universe = fixture.universe;
    const player = Object.values(universe.players)[0];
    assert.ok(player);

    ensureUniverseShape(universe);

    assert.equal(player.research.metallurgistTech, 0);
    assert.equal(player.research.crystalizerTech, 0);
    assert.equal(player.research.deutSynthesisTech, 0);

    // Verify progress preserved
    const planet = universe.planets[fixture.planetId];
    assert.ok(planet);
    assert.equal(planet.id, fixture.planetId);
  });

  it("queuing and upgrading the three new researches works with prerequisites", () => {
    const universe = createUniverse("Queue Test", 1);
    const { planet, player } = joinUniverse(universe, "Charlie", 100_000);
    planet.buildings.researchLab = 5;
    planet.resources = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };

    // Locked without energyTech
    const lockedMet = queueResearch(universe, player.id, "metallurgistTech", 100_000);
    assert.equal(lockedMet.ok, false);

    // Unlock energyTech level 2
    player.research.energyTech = 2;

    const resMet = queueResearch(universe, player.id, "metallurgistTech", 100_001);
    assert.ok(resMet.ok);
    assert.equal(player.researchQueue.length, 1);
    assert.equal(player.researchQueue[0]!.researchId, "metallurgistTech");

    // Complete research
    const completesAt = player.researchQueue[0]!.completesAt;
    advancePlanet(planet, 1, completesAt + 1, player.research.energyTech, undefined, player);
    advanceUniverse(universe, completesAt + 1);

    assert.equal(player.research.metallurgistTech, 1);
  });

  it("RESEARCH_ORDER includes the three new research IDs", () => {
    assert.ok(RESEARCH_ORDER.includes("metallurgistTech"));
    assert.ok(RESEARCH_ORDER.includes("crystalizerTech"));
    assert.ok(RESEARCH_ORDER.includes("deutSynthesisTech"));
    assert.equal(RESEARCH.metallurgistTech.name, "Metallurgist");
    assert.equal(RESEARCH.crystalizerTech.name, "Crystalizer");
    assert.equal(RESEARCH.deutSynthesisTech.name, "Deut Synthesis");
  });
});
