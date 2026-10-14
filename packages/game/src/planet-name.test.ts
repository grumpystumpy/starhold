import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANET_NAME_MAX_LEN,
  renamePlanet,
  validatePlanetName,
} from "./world-planet-name.js";
import { createUniverse, joinUniverse } from "./world.js";

describe("validatePlanetName", () => {
  it("accepts normal names", () => {
    const r = validatePlanetName("  Cradle 7  ");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.name, "Cradle 7");
  });

  it("rejects empty / short / long / bad chars / profanity", () => {
    assert.equal(validatePlanetName("").ok, false);
    assert.equal(validatePlanetName("x").ok, false);
    assert.equal(validatePlanetName("a".repeat(PLANET_NAME_MAX_LEN + 1)).ok, false);
    assert.equal(validatePlanetName("Bad<script>").ok, false);
    assert.equal(validatePlanetName("f u c k").ok, false);
  });
});

describe("renamePlanet", () => {
  it("renames owned planet", () => {
    const universe = createUniverse("Rename Drift", 8);
    const { player, planet } = joinUniverse(universe, "Renamer", 5_000_000);
    const result = renamePlanet(universe, player.id, planet.id, "New Haven");
    assert.equal(result.ok, true);
    assert.equal(universe.planets[planet.id].name, "New Haven");
  });

  it("rejects rename of foreign planet", () => {
    const universe = createUniverse("Rename Drift", 8);
    const a = joinUniverse(universe, "Alpha", 5_000_001);
    const b = joinUniverse(universe, "Bravo", 5_000_002);
    const result = renamePlanet(
      universe,
      a.player.id,
      b.planet.id,
      "Stolen",
    );
    assert.equal(result.ok, false);
  });
});
