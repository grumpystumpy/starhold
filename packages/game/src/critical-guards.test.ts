import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDefenses, emptyFleetShips } from "./formulas-travel.js";
import { productionPerHour } from "./formulas-build.js";
import { resolveCombat } from "./formulas-combat.js";
import { createUniverse, joinUniverse } from "./world-bootstrap.js";
import { queueBuildingUpgrade } from "./world-queues.js";
import { startOccupation } from "./world-occupation.js";
import type { FleetMission, PlanetState } from "./types.js";

describe("critical guards", () => {
  it("productionPerHour keeps base metal income on an owned planet", () => {
    const planet = {
      ownerPlayerId: "plyr_guard",
      coords: { galaxy: 1, system: 1, slot: 8 },
      kind: "planet",
      buildings: {},
      ships: emptyFleetShips(),
    } as PlanetState;
    const rates = productionPerHour(planet, 1);
    assert.ok(rates.metal > 0, "metal income");
    assert.ok(rates.crystal > 0, "crystal income");
    assert.ok(rates.deuterium > 0, "deuterium income");
  });

  it("resolveCombat damages a smaller interceptor wing", () => {
    const attacker = emptyFleetShips();
    attacker.interceptor = 30;
    const defender = emptyFleetShips();
    defender.interceptor = 1;
    const result = resolveCombat(
      attacker,
      defender,
      emptyDefenses(),
      undefined,
      undefined,
      { seed: "b755-damage-guard" },
    );
    assert.ok(result.rounds > 0, "combat ran");
    assert.equal(result.defenderAfter.interceptor, 0);
  });

  it("blocks construction on an occupied non-mini planet", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Occupation Guard", 1, 1, { lazySeed: true });
    const owner = joinUniverse(universe, "Owner", now);
    const occupier = joinUniverse(universe, "Occupier", now + 1);
    universe.seedCursor = { at: 0, ranks: [], pirates: 0, done: true };
    universe.miniPlanetIds = ["fixture-anchor"];

    const ships = emptyFleetShips();
    ships.swarmMothership = 1;
    const fleet: FleetMission = {
      id: "flt_occ_guard",
      ownerPlayerId: occupier.player.id,
      originPlanetId: occupier.planet.id,
      targetPlanetId: owner.planet.id,
      targetPlayerId: owner.player.id,
      targetCoords: { ...owner.planet.coords },
      mission: "raid",
      ships,
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now,
      arrivesAt: now + 86_400_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    const started = startOccupation(universe, occupier.player.id, fleet.id, now);
    assert.equal(started.ok, true, started.ok ? "" : started.error);

    const queued = queueBuildingUpgrade(
      universe,
      owner.player.id,
      "metalMine",
      now + 1000,
    );
    assert.equal(queued.ok, false);
    if (queued.ok) return;
    assert.equal(
      queued.error,
      "Construction blocked while planet is occupied.",
    );
  });
});
