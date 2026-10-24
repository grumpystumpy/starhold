import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFENSES, SHIPS } from "./catalog.js";

describe("weapon profiles", () => {
  it("has complete, normalized profiles and limits gravitational weapons", () => {
    const units = [...Object.values(SHIPS), ...Object.values(DEFENSES)];
    const gravitationalUnits = new Set([
      "worldEater",
      "voidforgeTitan",
      "swarmMothership",
      "voidWard",
    ]);

    for (const unit of units) {
      const shares = Object.values(unit.weapons);
      assert.ok(shares.every((share) => share >= 0), `${unit.id} has a negative share`);
      const total = shares.reduce((sum, share) => sum + share, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${unit.id} weapon shares must sum to 1 (got ${total})`);
      if (unit.attack > 0) {
        assert.ok(shares.length > 0, `${unit.id} with attack must have a profile`);
      }
      if (unit.weapons.gravitational !== undefined) {
        assert.ok(gravitationalUnits.has(unit.id), `${unit.id} cannot use gravitational weapons`);
      }
    }
    assert.deepEqual(
      units.filter((unit) => unit.weapons.gravitational !== undefined).map((unit) => unit.id).sort(),
      [...gravitationalUnits].sort(),
    );
  });
});
