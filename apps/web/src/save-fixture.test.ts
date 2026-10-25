import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("save fixture", () => {
  it("loads the commander snapshot and does not rewrite it", async () => {
    const path = fileURLToPath(new URL("./fixtures/commander-save.json", import.meta.url));
    const before = readFileSync(path, "utf8");
    await import("./api");
    const loaded = JSON.parse(before) as { id: string; buildings: { metalMine: number } };
    assert.equal(loaded.id, "fixture-commander");
    assert.equal(loaded.buildings.metalMine, 4);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), loaded);
  });

  it("loads catalog-complete-save fixture and preserves player progress and queue state", () => {
    const path = fileURLToPath(new URL("../../server/src/fixtures/catalog-complete-save.json", import.meta.url));
    const raw = readFileSync(path, "utf8");
    const save = JSON.parse(raw);
    assert.ok(save.universe, "save fixture has universe");
    const planet = save.universe.planets[save.planetId];
    assert.ok(planet, "save fixture has planet");
    assert.ok(Array.isArray(planet.buildQueue), "planet buildQueue preserved");
    assert.ok(Array.isArray(planet.shipQueue), "planet shipQueue preserved");
    assert.ok(Array.isArray(planet.defenseQueue), "planet defenseQueue preserved");
    assert.ok(planet.buildings, "planet buildings preserved");
    assert.ok(planet.defenses, "planet defenses preserved");
  });
});
