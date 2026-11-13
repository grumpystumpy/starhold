import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MIDGAME_BRIEFING_CARDS, ONBOARDING_STEPS } from "./data/tuning.js";
import { bindTickBudget } from "./tick-budget.js";
import type { PlanetState, UniverseState } from "./types.js";
import { playerStateTickDue } from "./world-arrival.js";
import {
  createUniverse,
  joinUniverse,
  midgameBriefingCards,
  midgameBriefingFor,
  midgameFactsFromView,
  migrateOrResetUniverse,
  playerView,
  setMidgameBriefingDismissed,
  setOnboardingDismissed,
} from "./world.js";

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

function fresh() {
  const universe = createUniverse("Midgame", 1);
  const joined = joinUniverse(universe, "Guide", NOW);
  return { universe, player: joined.player };
}

function homeOf(universe: UniverseState, playerId: string): PlanetState {
  const player = universe.players[playerId]!;
  return universe.planets[player.activePlanetId]!;
}

describe("mid-game briefing", () => {
  it("stays hidden and does not write the dismiss field", () => {
    const { universe, player } = fresh();
    const before = JSON.stringify(player);
    assert.equal(midgameBriefingFor(universe, player), null);
    assert.equal(JSON.stringify(player), before);
    assert.equal(Object.hasOwn(player, "midgameBriefingDismissed"), false);

    player.onboarding = { claimed: ONBOARDING_STEPS.map((step) => step.id) };
    const claimed = midgameBriefingFor(universe, player);
    assert.ok(claimed);
    assert.equal(claimed.length, MIDGAME_BRIEFING_CARDS.length);
    assert.equal(Object.hasOwn(player, "midgameBriefingDismissed"), false);
    assert.equal(player.onboarding.dismissed, undefined);
  });

  it("computes colony, moon, and building cards without a reward", () => {
    const { universe, player } = fresh();
    setOnboardingDismissed(universe, player.id, true);
    const home = homeOf(universe, player.id);
    const hidden = midgameBriefingFor(universe, player);
    assert.ok(hidden);
    assert.equal(hidden.find((card) => card.id === "extraColony")?.completed, false);
    assert.equal(hidden.find((card) => card.id === "firstMoon")?.completed, false);
    assert.equal(hidden.find((card) => card.id === "systemScanner")?.completed, false);
    assert.equal(hidden.find((card) => card.id === "moonBridge")?.completed, false);
    assert.equal(hidden.find((card) => card.id === "jointStrike")?.completed, null);
    assert.equal(JSON.stringify(hidden).includes("starshards"), false);

    const colony = structuredClone(home);
    colony.id = "col_extra";
    colony.name = "Second";
    colony.coords = {
      ...home.coords,
      slot: home.coords.slot === 15 ? 14 : home.coords.slot + 1,
    };
    universe.planets[colony.id] = colony;
    player.planetIds.push(colony.id);

    const moon = structuredClone(home);
    moon.id = "moon_extra";
    moon.kind = "moon";
    moon.name = "Luna";
    moon.buildings = {
      ...moon.buildings,
      lunarBase: 1,
      sensorArray: 2,
      jumpGate: 1,
    };
    universe.planets[moon.id] = moon;
    player.planetIds.push(moon.id);
    player.activePlanetId = home.id;

    const direct = midgameBriefingFor(universe, player);
    assert.ok(direct);
    assert.equal(direct.find((card) => card.id === "extraColony")?.completed, true);
    assert.equal(direct.find((card) => card.id === "firstMoon")?.completed, true);
    assert.equal(direct.find((card) => card.id === "systemScanner")?.completed, true);
    assert.equal(direct.find((card) => card.id === "moonBridge")?.completed, true);
    assert.equal(direct.find((card) => card.id === "jointStrike")?.completed, null);
    assert.deepEqual(
      direct.map((card) => card.id),
      MIDGAME_BRIEFING_CARDS.map((card) => card.id),
    );

    const view = playerView(universe, player.id, NOW);
    assert.equal(
      view.ownedPlanets.find((row) => row.id === home.id)?.sensorArrayLevel,
      undefined,
    );
    assert.equal(
      view.ownedPlanets.find((row) => row.id === moon.id)?.sensorArrayLevel,
      2,
    );
    assert.equal(JSON.stringify(view).includes("midgameBriefing"), false);
    assert.deepEqual(midgameBriefingCards(midgameFactsFromView(view)), direct);
    assert.equal(Object.hasOwn(player, "midgameBriefingDismissed"), false);

    const dismissed = setMidgameBriefingDismissed(universe, player.id, true);
    assert.equal(dismissed.ok, true);
    assert.equal(player.midgameBriefingDismissed, true);
    assert.equal(midgameBriefingFor(universe, player), null);

    const restored = setMidgameBriefingDismissed(universe, player.id, false);
    assert.equal(restored.ok, true);
    assert.equal(Object.hasOwn(player, "midgameBriefingDismissed"), false);
    assert.ok(midgameBriefingFor(universe, player));

    const missing = setMidgameBriefingDismissed(universe, "missing", true);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "Unknown player.");
  });

  it("loads a pre-briefing save without creating the dismiss field", () => {
    const path = fileURLToPath(
      new URL("../../../apps/server/src/fixtures/pre-onboarding-boss-save.json", import.meta.url),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const playerId = "plyr_fixture_boss";
    const planetId = "plnt_fixture_boss";
    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    const player = loaded.universe.players[playerId]!;
    const planet = loaded.universe.planets[planetId]!;
    assert.equal(player.name, "Boss Commander");
    assert.equal(planet.buildings.metalMine, 3);
    assert.equal(planet.buildings.crystalMine, 5);
    assert.equal(player.research.energyTech, 1);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.ships.hauler, 9);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.phase, "outbound");
    assert.equal(Object.hasOwn(player, "midgameBriefingDismissed"), false);
    assert.equal(midgameBriefingFor(loaded.universe, player), null);

    const quietAt = planet.lastTickAt + 1000;
    bindTickBudget(() => ({
      raids: 0,
      levelUps: 0,
      fleets: 0,
      driftSteps: 0,
      seedSystems: 0,
      seedMinis: 0,
      seedPirates: 0,
      lazyPlanets: true,
    }));
    try {
      const due = playerStateTickDue(loaded.universe, playerId, quietAt);
      playerView(loaded.universe, playerId, quietAt, undefined, undefined, {
        skipUniverseTick: !due,
      });
    } finally {
      bindTickBudget(() => undefined);
    }

    assert.equal(loaded.didReset, false);
    assert.equal(Object.hasOwn(loaded.universe.players[playerId]!, "midgameBriefingDismissed"), false);
    assert.equal(loaded.universe.players[playerId]!.name, "Boss Commander");
    assert.equal(loaded.universe.planets[planetId]!.buildings.metalMine, 3);
    assert.equal(loaded.universe.planets[planetId]!.buildings.crystalMine, 5);
    assert.equal(loaded.universe.players[playerId]!.research.energyTech, 1);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.ships.hauler, 9);
    assert.equal(loaded.universe.fleets.flt_pre_boss!.phase, "outbound");
  });
});
