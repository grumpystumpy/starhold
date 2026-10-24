import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  astrolabeResearchTimeMult,
  classBonuses,
  createUniverse,
  joinUniverse,
  levelBonuses,
  migrateOrResetUniverse,
  researchUpgradeCost,
  researchUpgradeSeconds,
} from "./index.js";
import { playerBoosts } from "./world-boosts.js";
import { empireRelicResearchTimeFactor } from "./world-mini.js";
import { linkedResearchLabLevel } from "./world-bootstrap.js";
import type {
  PlanetState,
  PlayerState,
  ResearchId,
  UniverseState,
} from "./types.js";
import { queueResearch } from "./world.js";

function researchSetup() {
  const now = Date.now();
  const universe = createUniverse("Research Network", 1);
  const { player } = joinUniverse(universe, "Network", now);
  const owner = universe.players[player.id]!;
  const active = universe.planets[owner.activePlanetId]!;
  active.buildings.researchLab = 3;
  active.resources = {
    metal: 1_000_000,
    crystal: 1_000_000,
    deuterium: 1_000_000,
  };
  active.lastTickAt = now;
  return { universe, player: owner, active, now };
}

function addPlanet(
  universe: UniverseState,
  player: PlayerState,
  template: PlanetState,
  id: string,
  labLevel: number,
): PlanetState {
  const planet = structuredClone(template);
  planet.id = id;
  planet.name = id;
  planet.coords = {
    ...template.coords,
    system: template.coords.system + player.planetIds.length,
  };
  planet.buildings.researchLab = labLevel;
  universe.planets[id] = planet;
  player.planetIds.push(id);
  return planet;
}

function expectedWorkSeconds(
  universe: UniverseState,
  player: PlayerState,
  researchId: ResearchId,
  current: number,
  labLevel: number,
  now: number,
): number {
  const researchSpeed = playerBoosts(player, now).researchSpeed;
  const level = levelBonuses(player.level ?? 1);
  const classBonus = classBonuses(player.playerClass?.classId);
  const astrolabe = astrolabeResearchTimeMult(universe, player.id);
  const relic = empireRelicResearchTimeFactor(universe, player.id);
  return Math.max(
    1,
    Math.ceil(
      (researchUpgradeSeconds(researchId, current, labLevel) *
        level.researchTime *
        classBonus.researchTime *
        astrolabe *
        relic) /
        universe.speed /
        Math.max(0.01, researchSpeed),
    ),
  );
}

describe("Research Network", () => {
  it("uses only the active planet lab at level 0", () => {
    const { universe, player, active, now } = researchSetup();
    addPlanet(universe, player, active, "colony-high-lab", 10);
    player.research.researchNetwork = 0;

    assert.equal(linkedResearchLabLevel(universe, player, active), 3);
    const result = queueResearch(universe, player.id, "energyTech", now);
    assert.equal(result.ok, true);
    assert.equal(
      player.researchQueue[0]!.workSeconds,
      expectedWorkSeconds(universe, player, "energyTech", 0, 3, now),
    );
  });

  it("uses the top two labs for level 1 research time", () => {
    const { universe, player, active, now } = researchSetup();
    addPlanet(universe, player, active, "colony-lab-10", 10);
    addPlanet(universe, player, active, "colony-lab-8", 8);
    player.research.researchNetwork = 1;

    assert.equal(linkedResearchLabLevel(universe, player, active), 18);
    const result = queueResearch(universe, player.id, "energyTech", now);
    assert.equal(result.ok, true);
    assert.equal(
      player.researchQueue[0]!.workSeconds,
      expectedWorkSeconds(universe, player, "energyTech", 0, 18, now),
    );
  });

  it("uses all existing planet labs when level 5 links more planets than exist", () => {
    const { universe, player, active } = researchSetup();
    addPlanet(universe, player, active, "colony-lab-10", 10);
    addPlanet(universe, player, active, "colony-lab-8", 8);
    const moon = addPlanet(universe, player, active, "moon-with-lab", 100);
    moon.kind = "moon";
    player.research.researchNetwork = 5;

    assert.equal(linkedResearchLabLevel(universe, player, active), 21);
  });

  it("keeps research cost based on the active planet lab", () => {
    const { universe, player, active, now } = researchSetup();
    addPlanet(universe, player, active, "colony-lab-10", 10);
    addPlanet(universe, player, active, "colony-lab-8", 8);
    player.research.researchNetwork = 1;

    const result = queueResearch(universe, player.id, "energyTech", now);
    assert.equal(result.ok, true);
    assert.deepEqual(
      player.researchQueue[0]!.paidCost,
      researchUpgradeCost("energyTech", 0, 3),
    );
    assert.notDeepEqual(
      player.researchQueue[0]!.paidCost,
      researchUpgradeCost("energyTech", 0, 18),
    );
  });

  it("loads old saves without the network and preserves existing research", () => {
    const { universe, player } = researchSetup();
    player.research.energyTech = 4;
    player.research.shieldingTech = 2;
    const oldSave = JSON.parse(JSON.stringify(universe)) as UniverseState;
    delete oldSave.players[player.id]!.research.researchNetwork;

    const loaded = migrateOrResetUniverse(oldSave);
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.players[player.id]!.research.researchNetwork, 0);
    assert.equal(loaded.universe.players[player.id]!.research.energyTech, 4);
    assert.equal(loaded.universe.players[player.id]!.research.shieldingTech, 2);
  });
});
