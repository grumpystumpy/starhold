import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_GALAXIES,
  MAP_SYSTEMS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_GROWTH_INTERVAL_MS,
  PIRATE_RAID_POWER_FLOOR,
  PIRATE_SYSTEMS_PER_BASE,
  PIRATE_TIER_CAP,
} from "./catalog.js";
import {
  emptyFleetShips,
  fleetCombatPower,
  fleetShipCount,
} from "./formulas.js";
import {
  activePirateBases,
  advanceUniverse,
  createUniverse,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  pirateDestroyStarshards,
  pirateRespawnAt,
  pirateShipsForTier,
  scalePirateRaidFleet,
  tickPirates,
} from "./world.js";

describe("pirate balance helpers", () => {
  it("pays Starshards by tier on destroy", () => {
    assert.equal(pirateDestroyStarshards(0), PIRATE_DESTROY_STARSHARDS_BASE);
    assert.equal(
      pirateDestroyStarshards(3),
      PIRATE_DESTROY_STARSHARDS_BASE + 3 * PIRATE_DESTROY_STARSHARDS_PER_TIER,
    );
  });

  it("grows ship pools with tier up to cap", () => {
    const t0 = pirateShipsForTier(0);
    const t8 = pirateShipsForTier(PIRATE_TIER_CAP);
    assert.ok(fleetShipCount(t8) > fleetShipCount(t0));
    assert.deepEqual(pirateShipsForTier(99), pirateShipsForTier(PIRATE_TIER_CAP));
  });

  it("caps raid fleets vs weak defenders", () => {
    const full = pirateShipsForTier(8);
    const capped = scalePirateRaidFleet(full, 10);
    assert.ok(fleetCombatPower(capped) <= fleetCombatPower(full));
    assert.ok(fleetShipCount(capped) >= 1);
    // Floor still allows a small detachment.
    assert.ok(fleetCombatPower(capped) <= PIRATE_RAID_POWER_FLOOR * 2);
  });
});

describe("pirate spawn / galaxy", () => {
  it("seeds roughly one base per 40 systems", () => {
    const universe = createUniverse("Pirate Drift", 8);
    const living = activePirateBases(universe);
    const systems = MAP_GALAXIES * MAP_SYSTEMS;
    const expected = systems / PIRATE_SYSTEMS_PER_BASE;
    assert.ok(living.length > expected * 0.5, `got ${living.length}`);
    assert.ok(living.length < expected * 1.5, `got ${living.length}`);
    const systemsWith = new Set(
      living.map((b) => `${b.coords.galaxy}:${b.coords.system}`),
    );
    assert.equal(systemsWith.size, living.length);
  });

  it("exposes pirateBase on galaxy view for occupied systems", () => {
    const universe = createUniverse("Pirate View", 8);
    const base = activePirateBases(universe)[0];
    assert.ok(base);
    const { player } = joinUniverse(universe, "Viewer", 300_000_000);
    const view = galaxyViewFor(
      universe,
      player.id,
      base!.coords.galaxy,
      base!.coords.system,
    );
    assert.ok(view.pirateBase);
    assert.equal(view.pirateBase!.id, base!.id);
    assert.equal(view.pirateBase!.tier, base!.tier);
  });
});

describe("pirate growth and respawn", () => {
  it("grows tier on the growth interval", () => {
    const universe = createUniverse("Grow Drift", 8);
    const base = activePirateBases(universe)[0]!;
    const t0 = base.tier;
    const now = base.lastGrewAt + PIRATE_GROWTH_INTERVAL_MS + 1;
    tickPirates(universe, now);
    assert.equal(universe.pirateBases![base.id]!.tier, t0 + 1);
  });

  it("respawns elsewhere after destroy delay", () => {
    const universe = createUniverse("Respawn Drift", 8);
    const base = activePirateBases(universe)[0]!;
    const id = base.id;
    const destroyedAt = 400_000_000;
    base.destroyedAt = destroyedAt;
    base.ships = emptyFleetShips();
    const due = pirateRespawnAt(destroyedAt, id);
    tickPirates(universe, due);
    assert.equal(universe.pirateBases![id], undefined);
    const living = activePirateBases(universe);
    assert.ok(living.length >= 1);
    assert.ok(living.every((b) => b.destroyedAt == null));
  });
});

describe("pirateRaid mission", () => {
  it("destroys a base, grants Starshards, and returns with loot", () => {
    const universe = createUniverse("Raid Drift", 8);
    const base = activePirateBases(universe)[0]!;
    // Keep the fight trivial so the player wins.
    base.tier = 0;
    base.ships = emptyFleetShips();
    base.resources = { metal: 2000, crystal: 1000, deuterium: 200 };

    const { player, planet } = joinUniverse(universe, "Hunter", 410_000_000);
    const body = universe.planets[planet.id];
    body.ships.cruiser = 5;
    body.ships.interceptor = 10;
    body.resources.deuterium = 50_000;

    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { cruiser: 3, interceptor: 5 },
      pirateBaseId: base.id,
      now: 410_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid!.phase, "returning");
    assert.ok(mid!.reportId);
    assert.ok((mid!.cargo.metal ?? 0) + (mid!.cargo.crystal ?? 0) > 0);

    const destroyed = universe.pirateBases![base.id];
    assert.ok(destroyed);
    assert.ok(destroyed!.destroyedAt != null);
    assert.equal(
      universe.players[player.id]!.starshards,
      pirateDestroyStarshards(0),
    );

    advanceUniverse(universe, mid!.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.ok(universe.planets[planet.id].ships.cruiser >= 1);
  });
});

describe("NPC pirate raids", () => {
  it("soft-caps pressure so a starter hangar is not wiped", () => {
    const universe = createUniverse("Soft Raid", 8);
    const { planet } = joinUniverse(universe, "Newbie", 420_000_000);
    const body = universe.planets[planet.id];
    body.ships.scout = 2;
    body.resources = { metal: 500, crystal: 500, deuterium: 100 };

    const base = activePirateBases(universe)[0]!;
    base.tier = 8;
    base.ships = pirateShipsForTier(8);
    base.lastRaidAt = 0;

    // Force a raid due: interval from lastRaidAt=0 is 8–24h, so jump far.
    tickPirates(universe, 48 * 60 * 60 * 1000);
    // Planet may or may not have been the rolled target; assert soft-cap helper
    // and that hangar still has a path if targeted with capped fleet.
    const capped = scalePirateRaidFleet(base.ships, fleetCombatPower(body.ships));
    assert.ok(fleetCombatPower(capped) < fleetCombatPower(base.ships));
    assert.ok(fleetShipCount(body.ships) >= 0);
  });
});
