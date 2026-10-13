import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPEDITION_SLOT } from "./catalog.js";
import {
  expeditionKindFromRoll,
  expeditionRoll,
} from "./world-expedition.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  playerView,
} from "./world.js";

describe("P2 expeditions", () => {
  it("maps rolls to kinds", () => {
    assert.equal(expeditionKindFromRoll(0), "resources");
    assert.equal(expeditionKindFromRoll(39), "resources");
    assert.equal(expeditionKindFromRoll(40), "ships");
    assert.equal(expeditionKindFromRoll(54), "ships");
    assert.equal(expeditionKindFromRoll(55), "nothing");
    assert.equal(expeditionKindFromRoll(69), "nothing");
    assert.equal(expeditionKindFromRoll(70), "starshards");
    assert.equal(expeditionKindFromRoll(74), "starshards");
    assert.equal(expeditionKindFromRoll(75), "pirates");
    assert.equal(expeditionKindFromRoll(99), "pirates");
  });

  it("launches to deep-space slot and returns with a report", () => {
    const universe = createUniverse("Expedition Drift", 8);
    const a = joinUniverse(universe, "Voyager", 140_000_000);
    universe.planets[a.planet.id].ships.scout = 2;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources.deuterium = 5_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 2, hauler: 1 },
      now: 140_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    assert.equal(launch.fleet.targetCoords.slot, EXPEDITION_SLOT);
    assert.equal(launch.fleet.phase, "outbound");

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");
    assert.ok(mid.reportId);
    const report = universe.expeditionReports[mid.reportId!];
    assert.ok(report);
    assert.ok(
      ["resources", "ships", "nothing", "pirates", "starshards"].includes(
        report.kind,
      ),
    );

    const metalBefore = universe.planets[a.planet.id].resources.metal;
    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    const view = playerView(universe, a.player.id, mid.arrivesAt + 1);
    assert.ok(view.expeditionReports.length >= 1);
    if (report.kind === "resources" || report.kind === "pirates") {
      assert.ok(
        universe.planets[a.planet.id].resources.metal >= metalBefore,
      );
    }
  });

  it("rejects wrong slot and enforces expedition cap at Astrophysics 0", () => {
    const universe = createUniverse("Cap Drift", 8);
    const a = joinUniverse(universe, "Capped", 141_000_000);
    universe.planets[a.planet.id].ships.scout = 4;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    // Extra fleet slots so Computer Tech does not mask the expedition cap.
    universe.players[a.player.id].research.computerTech = 2;
    assert.equal(universe.players[a.player.id].research.astrophysics, 0);

    const badSlot = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: 1,
        system: 1,
        slot: 1,
      },
      ships: { scout: 1 },
      now: 141_000_100,
    });
    assert.equal(badSlot.ok, false);

    const first = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 1 },
      now: 141_000_200,
    });
    assert.equal(first.ok, true);

    const second = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 1 },
      now: 141_000_300,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /expedition limit/i);
  });

  it("expeditionRoll is stable for a fleet id + time", () => {
    assert.equal(
      expeditionRoll("flt_demo", 1_000_000),
      expeditionRoll("flt_demo", 1_000_000),
    );
    assert.notEqual(
      expeditionRoll("flt_demo", 1_000_000),
      expeditionRoll("flt_demo", 1_000_001),
    );
  });
});
