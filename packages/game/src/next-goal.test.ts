import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILDINGS, RESEARCH, RESEARCH_ORDER, SHIPS } from "./catalog.js";
import type { UniverseState } from "./types.js";
import {
  claimOnboardingStep,
  createUniverse,
  joinUniverse,
  migrateOrResetUniverse,
  onboardingViewFor,
  setOnboardingDismissed,
} from "./world.js";

const NOW = Date.UTC(2026, 10, 8, 16, 0, 0);

function fresh() {
  const universe = createUniverse("Next goal", 1);
  const joined = joinUniverse(universe, "Rookie", NOW);
  return { universe, player: joined.player };
}

function home(universe: ReturnType<typeof createUniverse>, playerId: string) {
  const player = universe.players[playerId]!;
  return universe.planets[player.activePlanetId]!;
}

function readUniverse(name: string): UniverseState {
  const path = fileURLToPath(
    new URL(`../../../apps/server/src/fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as UniverseState;
}

describe("next goal suggestion", () => {
  it("suggests the research lab from the first unmet catalog gate and does not write the save", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    const resources = { ...planet.resources };
    const buildings = { ...planet.buildings };
    const research = { ...player.research };
    const shards = player.starshards ?? 0;

    const view = onboardingViewFor(universe, player);
    assert.equal(player.onboarding, undefined);
    assert.deepEqual(planet.resources, resources);
    assert.deepEqual(planet.buildings, buildings);
    assert.deepEqual(player.research, research);
    assert.equal(player.starshards ?? 0, shards);
    assert.equal(view.suggestion?.id, "building:researchLab");
    assert.equal(view.suggestion?.title, BUILDINGS.researchLab.name);
    assert.equal(view.suggestion?.targetNavPage, "buildings");
    assert.equal(
      view.suggestion?.rationale,
      `${RESEARCH.energyTech.name} needs ${BUILDINGS.researchLab.name} level 1 (best lab 0).`,
    );
    assert.doesNotMatch(view.suggestion?.rationale ?? "", /Lunar Habitat/);
    assert.equal("reward" in (view.suggestion ?? {}), false);
  });

  it("follows a lab on another world, then the next startable research", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    const colony = structuredClone(planet);
    colony.id = "plnt_colony_lab";
    colony.buildings.researchLab = 1;
    universe.planets[colony.id] = colony;
    player.planetIds.push(colony.id);

    const fromColony = onboardingViewFor(universe, player);
    assert.equal(planet.buildings.researchLab ?? 0, 0);
    assert.equal(fromColony.suggestion?.id, "research:energyTech");
    assert.equal(fromColony.suggestion?.title, RESEARCH.energyTech.name);
    assert.equal(fromColony.suggestion?.targetNavPage, "research");
    assert.match(fromColony.suggestion?.rationale ?? "", /Research Lab level 1 is met \(best lab 1\)/);
    assert.match(fromColony.suggestion?.rationale ?? "", /\+5% energy production per level/);

    planet.buildings.researchLab = 1;
    player.research.energyTech = 1;
    const drive = onboardingViewFor(universe, player);
    assert.equal(drive.suggestion?.id, "research:combustionDrive");
    assert.equal(drive.suggestion?.title, RESEARCH.combustionDrive.name);
    assert.match(
      drive.suggestion?.rationale ?? "",
      /Power Discipline level 1 is met \(you have 1\)/,
    );
    assert.equal(player.onboarding, undefined);
  });

  it("moves from a gated building to its prerequisite when the yard is short", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    planet.buildings.researchLab = 1;
    planet.buildings.shipyard = 2;
    for (const id of RESEARCH_ORDER) player.research[id] = 1;

    const ready = onboardingViewFor(universe, player);
    assert.equal(ready.suggestion?.id, "building:rigFoundry");
    assert.equal(ready.suggestion?.title, BUILDINGS.rigFoundry.name);
    assert.equal(ready.suggestion?.targetNavPage, "buildings");
    assert.match(ready.suggestion?.rationale ?? "", /Shipyard level 2 is met \(you have 2\)/);
    assert.match(ready.suggestion?.rationale ?? "", /Construction plant/);

    const metal = planet.resources.metal;
    planet.buildings.shipyard = 1;
    const blocked = onboardingViewFor(universe, player);
    assert.equal(blocked.suggestion?.id, "building:shipyard");
    assert.equal(blocked.suggestion?.title, BUILDINGS.shipyard.name);
    assert.equal(
      blocked.suggestion?.rationale,
      `${BUILDINGS.rigFoundry.name} needs ${BUILDINGS.shipyard.name} level 2 (you have 1).`,
    );
    assert.equal(planet.resources.metal, metal);
    assert.equal(player.starshards ?? 0, 0);
  });

  it("uses the closest hull research prerequisite once gated buildings are started", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    planet.buildings.researchLab = 4;
    planet.buildings.shipyard = 2;
    planet.buildings.rigFoundry = 1;
    planet.buildings.mantleLoom = 1;
    planet.buildings.chronoLathe = 1;
    for (const id of RESEARCH_ORDER) player.research[id] = 1;

    const drive = onboardingViewFor(universe, player);
    assert.equal(drive.suggestion?.id, "research:combustionDrive");
    assert.equal(
      drive.suggestion?.rationale,
      `${SHIPS.keelSovereign.name} needs ${RESEARCH.combustionDrive.name} level 4 (you have 1).`,
    );

    player.research.combustionDrive = 4;
    const weave = onboardingViewFor(universe, player);
    assert.equal(weave.suggestion?.id, "research:armourTech");
    assert.equal(
      weave.suggestion?.rationale,
      `${SHIPS.keelSovereign.name} needs ${RESEARCH.armourTech.name} level 5 (you have 1).`,
    );
    assert.equal(player.onboarding, undefined);
  });

  it("omits the suggestion when every catalog gate is already met", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    planet.buildings.shipyard = 15;
    planet.buildings.researchLab = 12;
    planet.buildings.rigFoundry = 1;
    planet.buildings.mantleLoom = 1;
    planet.buildings.chronoLathe = 1;
    for (const id of RESEARCH_ORDER) player.research[id] = 14;

    const view = onboardingViewFor(universe, player);
    assert.equal(view.suggestion, null);
    assert.equal(player.onboarding, undefined);
  });

  it("keeps claims, resources, and the suggestion across dismiss and restore", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    planet.buildings.metalMine = 1;
    const before = onboardingViewFor(universe, player);
    assert.equal(before.suggestion?.id, "building:researchLab");
    const paid = claimOnboardingStep(universe, player.id, "metalMine1", NOW);
    assert.equal(paid.ok, true);
    const claimed = [...(player.onboarding?.claimed ?? [])];
    const metal = planet.resources.metal;
    const crystal = planet.resources.crystal;
    const deuterium = planet.resources.deuterium;
    const shards = player.starshards ?? 0;

    assert.equal(setOnboardingDismissed(universe, player.id, true).ok, true);
    const hidden = onboardingViewFor(universe, player);
    assert.equal(hidden.dismissed, true);
    assert.equal(hidden.suggestion?.id, before.suggestion?.id);
    assert.deepEqual(player.onboarding?.claimed, claimed);
    assert.equal(planet.resources.metal, metal);
    assert.equal(planet.resources.crystal, crystal);
    assert.equal(planet.resources.deuterium, deuterium);
    assert.equal(player.starshards ?? 0, shards);

    assert.equal(setOnboardingDismissed(universe, player.id, false).ok, true);
    const restored = onboardingViewFor(universe, player);
    assert.equal(restored.dismissed, false);
    assert.equal(restored.suggestion?.id, "building:researchLab");
    assert.deepEqual(player.onboarding?.claimed, ["metalMine1"]);
    assert.equal(planet.resources.metal, metal);
  });

  it("loads older saves, including in-flight fleets, without writing onboarding", () => {
    for (const [name, fleetId, shipId, shipCount, metal] of [
      ["pre-onboarding-boss-save.json", "flt_pre_boss", "hauler", 9, 777001],
      ["pre-row-save.json", "flt_fixture_outbound", "scout", 4, 123456],
    ] as const) {
      const loaded = migrateOrResetUniverse(structuredClone(readUniverse(name)));
      assert.equal(loaded.didReset, false);
      const player = Object.values(loaded.universe.players)[0]!;
      const planet = loaded.universe.planets[player.activePlanetId]!;
      const fleets = structuredClone(loaded.universe.fleets);
      const research = { ...player.research };
      const buildings = { ...planet.buildings };
      assert.equal(player.onboarding, undefined);

      const view = onboardingViewFor(loaded.universe, player);
      assert.equal(player.onboarding, undefined);
      assert.equal(view.suggestion?.id, "building:researchLab");
      assert.equal(
        view.suggestion?.rationale,
        `${RESEARCH.combustionDrive.name} needs ${BUILDINGS.researchLab.name} level 1 (best lab 0).`,
      );
      assert.equal(planet.resources.metal, metal);
      assert.deepEqual(planet.buildings, buildings);
      assert.deepEqual(player.research, research);
      assert.deepEqual(loaded.universe.fleets, fleets);
      assert.equal(loaded.universe.fleets[fleetId]?.phase, "outbound");
      assert.equal(loaded.universe.fleets[fleetId]?.ships[shipId], shipCount);
    }
  });
});
