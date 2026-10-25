import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { countEntities, assertNoLostEntities } from "./save-safety.test.js";
import { findLintIssues, FORBIDDEN_PATTERNS } from "../../../scripts/lint-check.mjs";
import type { UniverseState } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const saveFixturePath = path.resolve(__dirname, "../../../apps/server/src/fixtures/catalog-complete-save.json");

describe("deliberate-break / mutation guard test", () => {
  it("proves the save-safety checker catches deliberate breaks in save state", () => {
    const raw = readFileSync(saveFixturePath, "utf8");
    const baselineUniverse: UniverseState = JSON.parse(raw).universe;

    // Ensure baseline has non-zero values across all tracked categories for comprehensive mutation testing
    const playerId = Object.keys(baselineUniverse.players)[0]!;
    const planetId = Object.keys(baselineUniverse.planets)[0]!;

    baselineUniverse.players[playerId]!.research = { energyTech: 3, combustionDrive: 2 };
    baselineUniverse.players[playerId]!.starshards = 10;
    baselineUniverse.players[playerId]!.officers = ["commander" as any];
    baselineUniverse.players[playerId]!.skillsUnlocked = ["miner_1" as any];

    const baseline = countEntities(baselineUniverse);

    // 1. Zero a building
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.planets[planetId]!.buildings.metalMine = 0;
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost buildings/,
      );
    }

    // 2. Zero a ship
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.planets[planetId]!.ships.scout = 0;
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost ships/,
      );
    }

    // 3. Zero a defense
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.planets[planetId]!.defenses.laserBattery = 0;
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost defenses/,
      );
    }

    // 4. Zero a research
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.players[playerId]!.research = {};
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost researches/,
      );
    }

    // 5. Delete a planet
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      delete mutated.planets[planetId];
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost/,
      );
    }

    // 6. Zero starshards
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.players[playerId]!.starshards = 0;
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost starshards/,
      );
    }

    // 7. Clear officers
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.players[playerId]!.officers = [];
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost officers/,
      );
    }

    // 8. Clear skills
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.players[playerId]!.skillsUnlocked = [];
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost skills/,
      );
    }

    // 9. Zero resources
    {
      const mutated: UniverseState = JSON.parse(JSON.stringify(baselineUniverse));
      mutated.planets[planetId]!.resources.metal = 0;
      const mutatedCounts = countEntities(mutated);
      assert.throws(
        () => assertNoLostEntities(baseline, mutatedCounts),
        /Lost metal/,
      );
    }
  });

  it("proves the lint checker catches deliberate forbidden pattern breaks in synthetic code", () => {
    for (const pattern of FORBIDDEN_PATTERNS) {
      const syntheticFiles = [
        {
          path: "packages/game/src/synthetic-break.ts",
          content: `// synthetic line\nconst value = "test";\n/* deliberate break */ ${pattern}\n`,
        },
      ];

      const issues = findLintIssues(syntheticFiles);
      assert.ok(
        issues.length > 0,
        `Expected lint checker to fail on deliberate break '${pattern}', but returned clean.`,
      );
      assert.ok(
        issues.some((issue) => issue.includes(pattern)),
        `Expected lint issue to reference forbidden pattern '${pattern}'`,
      );
    }
  });
});
