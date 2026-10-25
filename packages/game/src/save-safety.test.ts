import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ensureUniverseShape,
  advanceUniverse,
  playerView,
  playerBoosts,
  fieldsCap,
  highscoresBoard,
  type UniverseState,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const saveFixturePath = path.resolve(__dirname, "../../../apps/server/src/fixtures/catalog-complete-save.json");

export interface EntityCounts {
  buildings: number;
  ships: number;
  defenses: number;
  researches: number;
  queues: number;
  planets: number;
  moons: number;
  starshards: number;
  officers: number;
  skills: number;
  resources: {
    metal: number;
    crystal: number;
    deuterium: number;
  };
}

export function countEntities(universe: UniverseState): EntityCounts {
  let buildings = 0;
  let ships = 0;
  let defenses = 0;
  let researches = 0;
  let queues = 0;
  let planets = 0;
  let moons = 0;
  let starshards = 0;
  let officers = 0;
  let skills = 0;
  const resources = { metal: 0, crystal: 0, deuterium: 0 };

  for (const player of Object.values(universe.players ?? {})) {
    starshards += player.starshards ?? 0;
    officers += player.officers?.length ?? 0;
    skills += player.skillsUnlocked?.length ?? 0;
    queues += player.researchQueue?.length ?? 0;
    for (const lvl of Object.values(player.research ?? {})) {
      researches += lvl ?? 0;
    }
  }

  for (const p of Object.values(universe.planets ?? {})) {
    if (p.kind === "moon") {
      moons += 1;
    } else {
      planets += 1;
    }

    resources.metal += p.resources?.metal ?? 0;
    resources.crystal += p.resources?.crystal ?? 0;
    resources.deuterium += p.resources?.deuterium ?? 0;

    for (const lvl of Object.values(p.buildings ?? {})) {
      buildings += lvl ?? 0;
    }
    for (const count of Object.values(p.ships ?? {})) {
      ships += count ?? 0;
    }
    for (const count of Object.values(p.defenses ?? {})) {
      defenses += count ?? 0;
    }

    queues += p.buildQueue?.length ?? 0;
    queues += p.shipQueue?.length ?? 0;
    queues += p.defenseQueue?.length ?? 0;
  }

  for (const f of Object.values(universe.fleets ?? {})) {
    for (const count of Object.values(f.ships ?? {})) {
      ships += count ?? 0;
    }
    resources.metal += f.cargo?.metal ?? 0;
    resources.crystal += f.cargo?.crystal ?? 0;
    resources.deuterium += f.cargo?.deuterium ?? 0;
  }

  return {
    buildings,
    ships,
    defenses,
    researches,
    queues,
    planets,
    moons,
    starshards,
    officers,
    skills,
    resources,
  };
}

export function assertNoLostEntities(before: EntityCounts, after: EntityCounts) {
  assert.ok(after.buildings >= before.buildings, `Lost buildings: expected >= ${before.buildings}, got ${after.buildings}`);
  assert.ok(after.ships >= before.ships, `Lost ships: expected >= ${before.ships}, got ${after.ships}`);
  assert.ok(after.defenses >= before.defenses, `Lost defenses: expected >= ${before.defenses}, got ${after.defenses}`);
  assert.ok(after.researches >= before.researches, `Lost researches: expected >= ${before.researches}, got ${after.researches}`);
  assert.ok(after.queues + after.buildings + after.ships + after.defenses >= before.queues + before.buildings + before.ships + before.defenses, "Lost queue items or progress");
  assert.ok(after.planets >= before.planets, `Lost planets: expected >= ${before.planets}, got ${after.planets}`);
  assert.ok(after.moons >= before.moons, `Lost moons: expected >= ${before.moons}, got ${after.moons}`);
  assert.ok(after.starshards >= before.starshards, `Lost starshards: expected >= ${before.starshards}, got ${after.starshards}`);
  assert.ok(after.officers >= before.officers, `Lost officers: expected >= ${before.officers}, got ${after.officers}`);
  assert.ok(after.skills >= before.skills, `Lost skills: expected >= ${before.skills}, got ${after.skills}`);
  assert.ok(after.resources.metal >= before.resources.metal, `Lost metal: expected >= ${before.resources.metal}, got ${after.resources.metal}`);
  assert.ok(after.resources.crystal >= before.resources.crystal, `Lost crystal: expected >= ${before.resources.crystal}, got ${after.resources.crystal}`);
  assert.ok(after.resources.deuterium >= before.resources.deuterium, `Lost deuterium: expected >= ${before.resources.deuterium}, got ${after.resources.deuterium}`);
}

describe("save-safety suite", () => {
  it("loads complete save fixture and maintains zero lost entities across reloads and ticks", () => {
    const raw = readFileSync(saveFixturePath, "utf8");
    const loadedData = JSON.parse(raw);
    const universe: UniverseState = loadedData.universe;

    const initialCounts = countEntities(universe);

    // Run ensureUniverseShape
    ensureUniverseShape(universe);
    const postShapeCounts = countEntities(universe);
    assertNoLostEntities(initialCounts, postShapeCounts);
    assert.deepEqual(postShapeCounts, initialCounts);

    // Call fieldsCap on all planets / moons
    for (const p of Object.values(universe.planets)) {
      const cap = fieldsCap(p);
      assert.ok(typeof cap === "number" && cap > 0, `fieldsCap for planet ${p.id} should be positive number`);
    }

    // Call playerBoosts for all players
    for (const p of Object.values(universe.players)) {
      const boosts = playerBoosts(p, universe.createdAt);
      assert.ok(boosts && typeof boosts === "object");
    }

    // Call playerView for all players
    for (const p of Object.values(universe.players)) {
      const view = playerView(universe, p.id, universe.createdAt);
      assert.ok(view && typeof view === "object");
    }

    // Call highscoresBoard
    const board = highscoresBoard(universe);
    assert.ok(Array.isArray(board) && board.length > 0);

    // Advance universe ticks slightly (0ms and 1000ms) and assert zero loss across reloads and ticks
    const universeReloaded: UniverseState = JSON.parse(JSON.stringify(universe));
    ensureUniverseShape(universeReloaded);
    advanceUniverse(universeReloaded, universeReloaded.createdAt + 1000);

    const postTickCounts = countEntities(universeReloaded);
    assertNoLostEntities(initialCounts, postTickCounts);

    // Verify playerView, playerBoosts, fieldsCap, highscoresBoard on tick-advanced save
    for (const p of Object.values(universeReloaded.planets)) {
      assert.ok(fieldsCap(p) > 0);
    }
    for (const p of Object.values(universeReloaded.players)) {
      assert.ok(playerBoosts(p, universeReloaded.createdAt + 1000));
      assert.ok(playerView(universeReloaded, p.id, universeReloaded.createdAt + 1000));
    }
    assert.ok(highscoresBoard(universeReloaded).length > 0);
  });
});
