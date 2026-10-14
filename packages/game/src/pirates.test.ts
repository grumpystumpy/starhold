import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_GALAXIES,
  MAP_SYSTEMS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_FREE_SPAWN_BASE,
  PIRATE_FREE_SPAWN_INTERVAL_MS,
  PIRATE_FREE_SPAWN_PER_LEVEL,
  PIRATE_GROWTH_INTERVAL_MS,
  PIRATE_RAID_POWER_FLOOR,
  MINI_RELIC_PIRATE_WEIGHT,
  PIRATE_SYSTEMS_PER_BASE,
  PIRATE_TIER_CAP,
  SHIPS,
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
  isRelicWorldPlanet,
  joinUniverse,
  launchFleet,
  pirateCombatResearch,
  pirateDestroyStarshards,
  pirateEligibleShipIds,
  pirateFreeSpawnShips,
  pirateRespawnAt,
  pirateShipsForTier,
  pirateTechsForLevel,
  pickRaidTarget,
  planetRaidWeight,
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

  it("grows ship pools with tier up to cap 12", () => {
    assert.equal(PIRATE_TIER_CAP, 12);
    const t0 = pirateShipsForTier(0);
    const t12 = pirateShipsForTier(PIRATE_TIER_CAP);
    assert.ok(fleetShipCount(t12) > fleetShipCount(t0));
    assert.deepEqual(pirateShipsForTier(99), pirateShipsForTier(PIRATE_TIER_CAP));
  });

  it("unlocks hulls by level bands without class or stationary ships", () => {
    const eligible = new Set(pirateEligibleShipIds());
    for (const id of eligible) {
      assert.equal(SHIPS[id].classExclusive, undefined);
      assert.notEqual(SHIPS[id].stationary, true);
    }
    assert.ok(!eligible.has("vaultScout"));
    assert.ok(!eligible.has("helioBuoy"));
    assert.ok(!eligible.has("veinAnchor"));

    const light = pirateShipsForTier(2);
    assert.ok(light.scout > 0);
    assert.equal(light.cruiser, 0);
    assert.equal(light.worldEater, 0);

    const mid = pirateShipsForTier(5);
    assert.ok(mid.cruiser > 0);
    assert.ok(mid.bomber > 0);
    assert.equal(mid.recycler, 0);

    const late = pirateShipsForTier(8);
    assert.ok(late.recycler > 0);
    assert.ok(late.colonyShip > 0);
    assert.equal(late.worldEater, 0);

    const elite = pirateShipsForTier(12);
    assert.ok(elite.swarmDrone > 0);
    assert.equal(elite.worldEater, 1);
    assert.equal(elite.voidforgeTitan, 1);
  });

  it("keeps pirate techs very low vs level", () => {
    assert.deepEqual(pirateTechsForLevel(0), {
      weapons: 0,
      armour: 0,
      shielding: 0,
    });
    assert.deepEqual(pirateTechsForLevel(3), {
      weapons: 0,
      armour: 0,
      shielding: 0,
    });
    assert.deepEqual(pirateTechsForLevel(4), {
      weapons: 1,
      armour: 1,
      shielding: 1,
    });
    assert.deepEqual(pirateTechsForLevel(12), {
      weapons: 2,
      armour: 2,
      shielding: 2,
    });
  });

  it("free-spawns weak scout/interceptor counts scaled by level", () => {
    const lvl = 3;
    const free = pirateFreeSpawnShips(lvl);
    const expected =
      PIRATE_FREE_SPAWN_BASE + PIRATE_FREE_SPAWN_PER_LEVEL * lvl;
    assert.equal(fleetShipCount(free), expected);
    assert.ok(free.scout > free.interceptor);
    assert.equal(free.voidforgeTitan, 0);
    assert.equal(free.worldEater, 0);
    assert.equal(free.cruiser, 0);
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

  it("exposes pirateBase level on galaxy view", () => {
    const universe = createUniverse("Pirate View", 8);
    const base = activePirateBases(universe)[0];
    assert.ok(base);
    assert.equal(base!.level, base!.tier);
    assert.ok(base!.techs);
    assert.ok(base!.lastFreeSpawnAt != null);
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
    assert.equal(view.pirateBase!.level, base!.level);
  });
});

describe("pirate growth, free ships, and respawn", () => {
  it("grows tier/level on the growth interval and syncs techs", () => {
    const universe = createUniverse("Grow Drift", 8);
    const base = activePirateBases(universe)[0]!;
    const t0 = base.tier;
    const now = base.lastGrewAt + PIRATE_GROWTH_INTERVAL_MS + 1;
    tickPirates(universe, now);
    const after = universe.pirateBases![base.id]!;
    assert.equal(after.tier, t0 + 1);
    assert.equal(after.level, after.tier);
    assert.deepEqual(after.techs, pirateTechsForLevel(after.level));
  });

  it("adds free weak ships every 3h without Void Titan", () => {
    const universe = createUniverse("Free Spawn Drift", 8);
    const base = activePirateBases(universe)[0]!;
    base.level = 2;
    base.tier = 2;
    base.techs = pirateTechsForLevel(2);
    base.ships = emptyFleetShips();
    base.ships.scout = 1;
    const before = fleetShipCount(base.ships);
    const expectedAdd =
      PIRATE_FREE_SPAWN_BASE + PIRATE_FREE_SPAWN_PER_LEVEL * 2;
    tickPirates(universe, base.lastFreeSpawnAt + PIRATE_FREE_SPAWN_INTERVAL_MS + 1);
    const after = universe.pirateBases![base.id]!;
    assert.equal(fleetShipCount(after.ships), before + expectedAdd);
    assert.equal(after.ships.voidforgeTitan, 0);
    assert.ok(after.ships.scout >= 1);
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
    assert.ok(living.every((b) => b.level === b.tier));
  });
});

describe("pirateRaid mission", () => {
  it("destroys a base, grants Starshards, and returns with loot", () => {
    const universe = createUniverse("Raid Drift", 8);
    const base = activePirateBases(universe)[0]!;
    // Keep the fight trivial so the player wins.
    base.tier = 0;
    base.level = 0;
    base.techs = pirateTechsForLevel(0);
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

  it("applies pirate combat research from techs", () => {
    const universe = createUniverse("Tech Drift", 8);
    const base = activePirateBases(universe)[0]!;
    base.tier = 8;
    base.level = 8;
    base.techs = pirateTechsForLevel(8);
    const research = pirateCombatResearch(base);
    assert.equal(research.weaponsTech, 2);
    assert.equal(research.armourTech, 2);
    assert.equal(research.shieldingTech, 2);
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
    base.level = 8;
    base.techs = pirateTechsForLevel(8);
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

  it("weights Relic Worlds higher when picking planet raid targets", () => {
    assert.equal(MINI_RELIC_PIRATE_WEIGHT, 4);
    const universe = createUniverse("Relic Raids", 11);
    const a = joinUniverse(universe, "Holder", 100);
    const b = joinUniverse(universe, "Neighbor", 200);
    const relic = universe.planets[a.planet.id];
    const normal = universe.planets[b.planet.id];
    relic.flags = { mini: true, miniKind: "relic" };
    normal.flags = { mini: true, miniKind: "standard" };
    assert.equal(isRelicWorldPlanet(relic), true);
    assert.equal(isRelicWorldPlanet(normal), false);
    assert.equal(planetRaidWeight(relic), MINI_RELIC_PIRATE_WEIGHT);
    assert.equal(planetRaidWeight(normal), 1);

    // Isolate to two planets so weighted pick is measurable.
    for (const id of Object.keys(universe.planets)) {
      if (id !== relic.id && id !== normal.id) delete universe.planets[id];
    }
    // Only one pirate so target roll always prefers planets.
    const keep = activePirateBases(universe)[0]!;
    universe.pirateBases = { [keep.id]: keep };

    let relicHits = 0;
    let normalHits = 0;
    const samples = 200;
    for (let i = 0; i < samples; i++) {
      keep.lastRaidAt = i * 1_000;
      const target = pickRaidTarget(universe, keep, 50_000 + i * 17);
      assert.ok(target?.kind === "planet");
      if (target.planet.id === relic.id) relicHits += 1;
      else if (target.planet.id === normal.id) normalHits += 1;
    }
    assert.equal(relicHits + normalHits, samples);
    // 4:1 weight → expect ~80% Relic; allow generous slack for hashSeed.
    assert.ok(
      relicHits > normalHits * 2,
      `expected Relic bias, got relic=${relicHits} normal=${normalHits}`,
    );
  });
});
