import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ONBOARDING_STEPS } from "./data/tuning.js";
import {
  claimOnboardingStep,
  createUniverse,
  ensurePlayerFleetPresets,
  isBuiltinPresetUnlockedForComposer,
  joinUniverse,
  onboardingViewFor,
  setOnboardingDismissed,
  type PresetComposerUnlockContext,
} from "./world.js";

const NOW = Date.UTC(2026, 10, 5, 18, 0, 0);

function fresh() {
  const universe = createUniverse("Onboarding", 1);
  const joined = joinUniverse(universe, "Rookie", NOW);
  return { universe, player: joined.player };
}

function home(universe: ReturnType<typeof createUniverse>, playerId: string) {
  const player = universe.players[playerId]!;
  return universe.planets[player.activePlanetId]!;
}

function step(id: string) {
  const row = ONBOARDING_STEPS.find((item) => item.id === id);
  assert.ok(row, id);
  return row;
}

describe("commander onboarding", () => {
  it("starts a new commander at 0/8 and pays the ore mine reward once", () => {
    const { universe, player } = fresh();
    const seeded = onboardingViewFor(universe, player);
    assert.equal(
      seeded.completedCount,
      3,
      "join already builds ore, crystal, and solar to level 1",
    );

    const planet = home(universe, player.id);
    planet.buildings.metalMine = 0;
    planet.buildings.crystalMine = 0;
    planet.buildings.solarPlant = 0;
    const before = onboardingViewFor(universe, player);
    assert.equal(before.steps.length, 8);
    assert.equal(before.completedCount, 0);
    assert.equal(before.allClaimed, false);
    assert.equal(before.dismissed, false);
    assert.equal(player.onboarding, undefined);

    const unmet = claimOnboardingStep(universe, player.id, "metalMine1", NOW);
    assert.equal(unmet.ok, false);

    const metal = planet.resources.metal;
    const crystal = planet.resources.crystal;
    const shards = player.starshards ?? 0;
    planet.buildings.metalMine = 1;

    const view = onboardingViewFor(universe, player);
    const mine = view.steps.find((row) => row.id === "metalMine1");
    assert.equal(mine?.completed, true);
    assert.equal(mine?.claimed, false);
    assert.equal(view.completedCount, 1);

    const paid = claimOnboardingStep(universe, player.id, "metalMine1", NOW);
    assert.deepEqual(paid, { ok: true, stepId: "metalMine1" });
    assert.equal(planet.resources.metal, metal + step("metalMine1").metal);
    assert.equal(planet.resources.crystal, crystal + step("metalMine1").crystal);
    assert.equal(player.starshards ?? 0, shards + step("metalMine1").starshards);
    assert.deepEqual(player.onboarding?.claimed, ["metalMine1"]);

    const again = claimOnboardingStep(universe, player.id, "metalMine1", NOW);
    assert.equal(again.ok, false);
    assert.equal(planet.resources.metal, metal + 600);
    assert.equal(planet.resources.crystal, crystal + 250);
  });

  it("lets a developed empire claim finished steps in any order and dismiss", () => {
    const { universe, player } = fresh();
    const planet = home(universe, player.id);
    planet.buildings.metalMine = 4;
    planet.buildings.crystalMine = 3;
    planet.buildings.solarPlant = 3;
    planet.buildings.deutSynth = 1;
    planet.buildings.researchLab = 1;
    planet.buildings.shipyard = 1;
    planet.ships.scout = 1;
    player.research.energyTech = 1;
    player.onboarding = { recon: true };

    const view = onboardingViewFor(universe, player);
    assert.equal(view.completedCount, 8);
    assert.ok(view.steps.every((row) => row.completed));

    const capstone = claimOnboardingStep(universe, player.id, "colonyFoundation", NOW);
    assert.equal(capstone.ok, true);
    const first = claimOnboardingStep(universe, player.id, "metalMine1", NOW);
    assert.equal(first.ok, true);
    for (const row of ONBOARDING_STEPS) {
      if (row.id === "colonyFoundation" || row.id === "metalMine1") continue;
      const result = claimOnboardingStep(universe, player.id, row.id, NOW);
      assert.equal(result.ok, true, row.id);
    }
    assert.equal(onboardingViewFor(universe, player).allClaimed, true);
    assert.equal(player.starshards, 15 + 15 + 20 + 50);

    assert.equal(setOnboardingDismissed(universe, player.id, true).ok, true);
    assert.equal(onboardingViewFor(universe, player).dismissed, true);
    assert.equal(setOnboardingDismissed(universe, player.id, false).ok, true);
    assert.equal(onboardingViewFor(universe, player).dismissed, false);
    assert.equal(player.onboarding?.claimed?.length, 8);
  });

  it("loads a player object that never had onboarding", () => {
    const { universe, player } = fresh();
    delete player.onboarding;
    assert.doesNotThrow(() => onboardingViewFor(universe, player));
    assert.equal(player.onboarding, undefined);
    assert.equal(onboardingViewFor(universe, player).steps.length, 8);
  });

  it("rejects an unknown step id", () => {
    const { universe, player } = fresh();
    const result = claimOnboardingStep(universe, player.id, "not-a-step", NOW);
    assert.equal(result.ok, false);
  });
});

describe("fleet composer preset unlock", () => {
  function ctx(partial: Partial<PresetComposerUnlockContext> = {}): PresetComposerUnlockContext {
    return {
      research: {},
      planets: [{ shipyard: 0, ships: {} }],
      fleets: [],
      ...partial,
    };
  }

  it("hides endgame presets until the hull is owned or researched", () => {
    const { universe, player } = fresh();
    const presets = ensurePlayerFleetPresets(player);
    const moon = presets.find((preset) => preset.id === "moonDestruction")!;
    const eater = presets.find((preset) => preset.id === "miniPlanetDestruction")!;
    const raid = presets.find((preset) => preset.id === "raid")!;
    const custom = {
      id: "custom_pack",
      name: "Pack",
      builtIn: false,
      intent: "custom" as const,
      ships: { scout: 1 },
    };
    const locked = ctx();
    assert.equal(isBuiltinPresetUnlockedForComposer(moon, locked), false);
    assert.equal(isBuiltinPresetUnlockedForComposer(eater, locked), false);
    assert.equal(isBuiltinPresetUnlockedForComposer(raid, locked), true);
    assert.equal(isBuiltinPresetUnlockedForComposer(custom, locked), true);
    assert.ok(presets.some((preset) => preset.id === "moonDestruction"));
    assert.ok(presets.some((preset) => preset.id === "expedition"));

    const owned = ctx({
      planets: [{ shipyard: 0, ships: { voidforgeTitan: 1 } }],
      fleets: [{ ships: { worldEater: 1 } }],
    });
    assert.equal(isBuiltinPresetUnlockedForComposer(moon, owned), true);
    assert.equal(isBuiltinPresetUnlockedForComposer(eater, owned), true);

    const researched = ctx({
      research: {
        weaponsTech: 14,
        shieldingTech: 14,
        armourTech: 14,
        gravityWell: 1,
      },
      planets: [{ shipyard: 15, ships: {} }],
    });
    assert.equal(isBuiltinPresetUnlockedForComposer(moon, researched), true);
    assert.equal(isBuiltinPresetUnlockedForComposer(eater, researched), true);
    assert.ok(universe.players[player.id]);
  });
});
