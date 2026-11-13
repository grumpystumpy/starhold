import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUniverse,
  joinUniverse,
  moonRoll,
  playerView,
  scannerSystemSpans,
  systemCoveredByScanner,
  tryFormMoon,
} from "./world.js";
import type { Coordinates, PlanetState } from "./types.js";

function findSeedBelow(chance: number): string {
  for (let i = 0; i < 10_000; i++) {
    const seed = `scanner_seed_${i}`;
    if (moonRoll(seed) < chance) return seed;
  }
  throw new Error("no seed");
}

function moonLevel(system: number, sensorArray: number): {
  coords: Coordinates;
  sensorArray: number;
} {
  return { coords: { galaxy: 1, system, slot: 1 }, sensorArray };
}

describe("system scanner overlay", () => {
  it("hides coverage at range 0 and marks only systems inside range", () => {
    const quiet = [moonLevel(10, 0)];
    assert.deepEqual(scannerSystemSpans(quiet, 1), []);
    assert.equal(systemCoveredByScanner(quiet, 1, 10), false);

    const levelTwo = [moonLevel(10, 2)];
    assert.deepEqual(scannerSystemSpans(levelTwo, 1), [{ from: 8, to: 12 }]);
    assert.equal(systemCoveredByScanner(levelTwo, 1, 8), true);
    assert.equal(systemCoveredByScanner(levelTwo, 1, 12), true);
    assert.equal(systemCoveredByScanner(levelTwo, 1, 13), false);
    assert.equal(systemCoveredByScanner(levelTwo, 1, 7), false);
  });

  it("grows the span when sensorArray is upgraded", () => {
    const built = [moonLevel(10, 1)];
    assert.deepEqual(scannerSystemSpans(built, 1), [{ from: 9, to: 11 }]);
    const upgraded = [moonLevel(10, 4)];
    assert.deepEqual(scannerSystemSpans(upgraded, 1), [{ from: 6, to: 14 }]);
    assert.equal(systemCoveredByScanner(built, 1, 13), false);
    assert.equal(systemCoveredByScanner(upgraded, 1, 13), true);
  });

  it("unions a second scanner moon in the same galaxy only", () => {
    const moons = [
      moonLevel(10, 1),
      moonLevel(20, 1),
      { coords: { galaxy: 2, system: 15, slot: 1 }, sensorArray: 9 },
    ];
    assert.deepEqual(scannerSystemSpans(moons, 1), [
      { from: 9, to: 11 },
      { from: 19, to: 21 },
    ]);
    assert.equal(systemCoveredByScanner(moons, 1, 11), true);
    assert.equal(systemCoveredByScanner(moons, 1, 12), false);
    assert.equal(systemCoveredByScanner(moons, 1, 19), true);
    assert.equal(systemCoveredByScanner(moons, 1, 15), false);
    assert.deepEqual(scannerSystemSpans(moons, 2), [{ from: 6, to: 24 }]);
  });

  it("reads the current sensorArray level for the owner's moons only", () => {
    const universe = createUniverse("Scanner Overlay", 8);
    const owner = joinUniverse(universe, "Spotter", 170_000_000);
    const other = joinUniverse(universe, "Neighbor", 170_000_001);
    const parent = universe.planets[owner.planet.id]!;
    const moon = tryFormMoon(
      universe,
      parent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      170_000_100,
    );
    assert.ok(moon);
    const moonId = moon.id;
    const liveMoon = () => {
      const body = universe.planets[moonId];
      if (!body) throw new Error("moon missing");
      return body;
    };
    liveMoon().buildings.sensorArray = 0;

    const hidden = playerView(universe, owner.player.id, 170_000_200, undefined, undefined, {
      includeScannerMoons: true,
      skipUniverseTick: true,
    });
    assert.deepEqual(hidden.scannerMoons, []);
    assert.equal(
      hidden.ownedPlanets.some((planet) => "sensorArray" in planet),
      false,
    );

    const poll = playerView(universe, owner.player.id, 170_000_200, undefined, undefined, {
      skipUniverseTick: true,
    });
    assert.equal(Object.hasOwn(poll, "scannerMoons"), false);

    liveMoon().buildings.sensorArray = 1;
    const built = playerView(universe, owner.player.id, 170_000_300, undefined, undefined, {
      includeScannerMoons: true,
      skipUniverseTick: true,
    });
    assert.equal(built.scannerMoons?.length, 1);
    assert.equal(built.scannerMoons?.[0]?.sensorArray, 1);
    assert.equal(built.scannerMoons?.[0]?.range, 1);
    assert.equal(built.scannerMoons?.[0]?.coords.system, liveMoon().coords.system);

    liveMoon().buildings.sensorArray = 3;
    const upgraded = playerView(universe, owner.player.id, 170_000_400, undefined, undefined, {
      includeScannerMoons: true,
      skipUniverseTick: true,
    });
    assert.equal(upgraded.scannerMoons?.[0]?.sensorArray, 3);
    assert.equal(upgraded.scannerMoons?.[0]?.range, 3);

    const second = structuredClone(liveMoon()) as PlanetState;
    second.id = "moon_union";
    second.coords = {
      galaxy: liveMoon().coords.galaxy,
      system: liveMoon().coords.system + 25,
      slot: liveMoon().coords.slot,
    };
    second.buildings = { ...second.buildings, sensorArray: 2 };
    universe.planets[second.id] = second;
    universe.players[owner.player.id]!.planetIds.push(second.id);

    const otherParent = universe.planets[other.planet.id]!;
    const foreign = tryFormMoon(
      universe,
      otherParent,
      { metal: 5_000_000, crystal: 0, deuterium: 0 },
      findSeedBelow(20),
      170_000_500,
    );
    assert.ok(foreign);
    foreign.buildings.sensorArray = 8;

    const union = playerView(universe, owner.player.id, 170_000_600, undefined, undefined, {
      includeScannerMoons: true,
      skipUniverseTick: true,
    });
    const ids = (union.scannerMoons ?? []).map((entry) => entry.planetId).sort();
    assert.deepEqual(ids, [moonId, second.id].sort());
    const spans = scannerSystemSpans(union.scannerMoons ?? [], liveMoon().coords.galaxy);
    assert.equal(
      systemCoveredByScanner(
        union.scannerMoons ?? [],
        liveMoon().coords.galaxy,
        liveMoon().coords.system + 3,
      ),
      true,
    );
    assert.ok(spans.length >= 1);
    assert.equal(
      (union.scannerMoons ?? []).some((entry) => entry.planetId === foreign.id),
      false,
    );
  });
});
