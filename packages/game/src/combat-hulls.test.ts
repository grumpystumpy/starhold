import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIPS } from "./catalog.js";
import {
  fleetCombatPower,
  normalizeFleetShips,
  resolveCombat,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  queueShipBuild,
} from "./world.js";

describe("P1 combat hulls", () => {
  it("catalogs cruiser and bomber above interceptor power", () => {
    assert.equal(SHIPS.cruiser.shipyardLevel, 4);
    assert.equal(SHIPS.bomber.shipyardLevel, 5);
    const oneInterceptor = fleetCombatPower(
      normalizeFleetShips({ interceptor: 1 }),
    );
    const oneCruiser = fleetCombatPower(normalizeFleetShips({ cruiser: 1 }));
    const oneBomber = fleetCombatPower(normalizeFleetShips({ bomber: 1 }));
    assert.ok(
      oneCruiser > oneInterceptor * 2,
      `cruiser ${oneCruiser} vs int ${oneInterceptor}`,
    );
    assert.ok(
      oneBomber > oneCruiser,
      `bomber ${oneBomber} vs cruiser ${oneCruiser}`,
    );
  });

  it("one cruiser beats two interceptors", () => {
    const combat = resolveCombat(
      normalizeFleetShips({ cruiser: 1 }),
      normalizeFleetShips({ interceptor: 2 }),
    );
    assert.equal(combat.outcome, "attacker_win");
  });

  it("queues cruiser at yard L4 and bomber at yard L5", () => {
    const universe = createUniverse("Hull Drift", 8);
    const a = joinUniverse(universe, "Smith", 120_000_000);
    const planetId = a.planet.id;
    const prep = () => {
      const p = universe.planets[planetId];
      p.buildings.metalStorage = 5;
      p.buildings.crystalStorage = 5;
      p.buildings.deutTank = 5;
      p.resources = {
        metal: 50_000,
        crystal: 50_000,
        deuterium: 10_000,
      };
      return p;
    };

    prep().buildings.shipyard = 3;
    const early = queueShipBuild(
      universe,
      a.player.id,
      "cruiser",
      1,
      120_000_100,
    );
    assert.equal(early.ok, false);
    if (early.ok) return;
    assert.match(early.error, /shipyard|yard/i);

    prep().buildings.shipyard = 4;
    const cruiser = queueShipBuild(
      universe,
      a.player.id,
      "cruiser",
      1,
      120_000_200,
    );
    assert.equal(cruiser.ok, true);
    if (!cruiser.ok) return;
    const queued = universe.planets[planetId];
    advanceUniverse(universe, queued.shipQueue[0]!.completesAt);
    assert.equal(universe.planets[planetId].ships.cruiser, 1);
    assert.equal(universe.planets[planetId].shipQueue.length, 0);

    prep().buildings.shipyard = 4;
    const stillEarly = queueShipBuild(
      universe,
      a.player.id,
      "bomber",
      1,
      120_001_000,
    );
    assert.equal(stillEarly.ok, false);
    if (stillEarly.ok) return;
    assert.match(stillEarly.error, /shipyard|yard/i);

    prep().buildings.shipyard = 5;
    const bomber = queueShipBuild(
      universe,
      a.player.id,
      "bomber",
      1,
      120_001_100,
    );
    assert.equal(bomber.ok, true);
    if (!bomber.ok) return;
    advanceUniverse(
      universe,
      universe.planets[planetId].shipQueue[0]!.completesAt,
    );
    assert.equal(universe.planets[planetId].ships.bomber, 1);
  });
});
