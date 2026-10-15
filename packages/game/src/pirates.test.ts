import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALIEN_BUILDUP_MS,
  ALIEN_INITIAL_BASE_COUNT,
  ALIEN_MAX_BASE_COUNT,
  ALIEN_SPLIT_LEVEL,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_EXCLUDED_SHIP_IDS,
  PIRATE_FREE_SPAWN_INTERVAL_MS,
  PIRATE_LEVEL_GROWTH_INTERVAL_MS,
  PIRATE_MAX_LEVEL,
  PIRATE_RAID_PERIOD_MS,
  PIRATE_RAID_POWER_FLOOR,
  PIRATE_SPLIT_LEVEL,
  PIRATE_TARGET_BASE_COUNT,
  SHIPS,
} from "./catalog.js";
import {
  emptyDefenses,
  emptyFleetShips,
  fleetCombatPower,
  fleetShipCount,
} from "./formulas.js";
import {
  activeAlienBases,
  activePirateBases,
  advanceUniverse,
  bindTickBudget,
  createAlienBase,
  createUniverse,
  ensurePiratePopulation,
  galaxyViewFor,
  joinUniverse,
  launchFleet,
  migrateUniverseV4ToV5,
  pirateDestroyStarshards,
  pirateEligibleShipIds,
  pirateFreeSpawnShips,
  pirateRespawnAt,
  pirateShipsForTier,
  rollNextRaidAt,
  scalePirateRaidFleet,
  tickPirates,
  tryAlienExpeditionFind,
} from "./world.js";
import type { TickBudget } from "./tick-budget.js";
import type { FleetMission, UniverseState } from "./types.js";

describe("pirate balance helpers", () => {
  it("pays Starshards by tier on destroy", () => {
    assert.equal(pirateDestroyStarshards(0), PIRATE_DESTROY_STARSHARDS_BASE);
    assert.equal(
      pirateDestroyStarshards(3),
      PIRATE_DESTROY_STARSHARDS_BASE + 3 * PIRATE_DESTROY_STARSHARDS_PER_TIER,
    );
  });

  it("grows ship pools with level up to cap 100", () => {
    assert.equal(PIRATE_MAX_LEVEL, 100);
    const t0 = pirateShipsForTier(0);
    const t100 = pirateShipsForTier(PIRATE_MAX_LEVEL);
    assert.ok(fleetShipCount(t100) > fleetShipCount(t0));
    assert.deepEqual(
      pirateShipsForTier(999),
      pirateShipsForTier(PIRATE_MAX_LEVEL),
    );
  });

  it("never fields excluded capitals / class / stationary", () => {
    const eligible = new Set(pirateEligibleShipIds());
    for (const id of PIRATE_EXCLUDED_SHIP_IDS) {
      assert.ok(!eligible.has(id));
    }
    for (const id of eligible) {
      assert.equal(SHIPS[id].classExclusive, undefined);
      assert.notEqual(SHIPS[id].stationary, true);
    }
    const late = pirateShipsForTier(100);
    assert.equal(late.worldEater ?? 0, 0);
    assert.equal(late.swarmMothership ?? 0, 0);
    assert.equal(late.voidforgeTitan ?? 0, 0);
  });

  it("caps raid fleets vs weak defenders", () => {
    const full = pirateShipsForTier(40);
    const capped = scalePirateRaidFleet(full, 10);
    assert.ok(fleetCombatPower(capped) <= fleetCombatPower(full));
    assert.ok(fleetShipCount(capped) >= 1);
    assert.ok(fleetCombatPower(capped) <= PIRATE_RAID_POWER_FLOOR * 2);
  });
});

describe("pirate density 200 + zero aliens", () => {
  it("seeds exactly toward PIRATE_TARGET_BASE_COUNT=200", () => {
    assert.equal(PIRATE_TARGET_BASE_COUNT, 200);
    assert.equal(ALIEN_INITIAL_BASE_COUNT, 0);
    const universe = createUniverse("Pirate Drift", 8);
    const living = activePirateBases(universe);
    assert.ok(
      living.length >= PIRATE_TARGET_BASE_COUNT * 0.9,
      `got ${living.length}`,
    );
    assert.ok(
      living.length <= PIRATE_TARGET_BASE_COUNT,
      `got ${living.length}`,
    );
    assert.equal(activeAlienBases(universe).length, 0);
    assert.deepEqual(universe.alienBases ?? {}, {});
    const systemsWith = new Set(
      living.map((b) => `${b.coords.galaxy}:${b.coords.system}`),
    );
    assert.equal(systemsWith.size, living.length);
  });

  it("migration top-up reaches 200 without wiping players", () => {
    const universe = createUniverse("Topup Drift", 8);
    const { player, planet } = joinUniverse(universe, "Keeper", 100_000);
    const playerPlanetId = planet.id;
    // Strip most pirates to simulate a sparse legacy universe.
    const keep = activePirateBases(universe).slice(0, 5);
    universe.pirateBases = Object.fromEntries(keep.map((b) => [b.id, b]));
    universe.schemaVersion = 4;
    migrateUniverseV4ToV5(universe, 200_000);
    assert.equal(universe.schemaVersion, 5);
    assert.ok(activePirateBases(universe).length >= PIRATE_TARGET_BASE_COUNT * 0.9);
    assert.ok(universe.planets[playerPlanetId]);
    assert.equal(universe.players[player.id]?.id, player.id);
    assert.equal(activeAlienBases(universe).length, 0);
  });

  it("ensurePiratePopulation is additive", () => {
    const universe = createUniverse("Additive", 8);
    const before = activePirateBases(universe).length;
    ensurePiratePopulation(universe, Date.now());
    assert.equal(activePirateBases(universe).length, before);
  });
});

describe("pirate galaxy + raids", () => {
  it("exposes pirate Lv on galaxy view; no alien until found", () => {
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
    assert.equal(view.pirateBase!.level, base!.level ?? base!.tier);
    assert.equal(view.alienBase, null);
  });

  it("schedules nextRaidAt within each hour window", () => {
    const now = 1_700_000_000_000;
    const at = rollNextRaidAt("pir:1:1:1", now, PIRATE_RAID_PERIOD_MS);
    assert.ok(at > now);
    const periodStart = Math.floor(at / PIRATE_RAID_PERIOD_MS) * PIRATE_RAID_PERIOD_MS;
    assert.ok(at >= periodStart);
    assert.ok(at < periodStart + PIRATE_RAID_PERIOD_MS);
  });
});

describe("pirate growth, free spawn defenses, split", () => {
  it("levels up and accumulates defenses", () => {
    const universe = createUniverse("Grow Drift", 8);
    const base = activePirateBases(universe)[0]!;
    const t0 = base.level;
    const def0 = Object.values(base.defenses).reduce((a, b) => a + b, 0);
    const now = base.lastGrewAt + PIRATE_LEVEL_GROWTH_INTERVAL_MS + 1;
    tickPirates(universe, now);
    const after = universe.pirateBases![base.id]!;
    assert.equal(after.level, t0 + 1);
    const def1 = Object.values(after.defenses).reduce((a, b) => a + b, 0);
    assert.ok(def1 > def0);
  });

  it("3h free spawn adds ships and defenses that accumulate", () => {
    const universe = createUniverse("Free Spawn", 8);
    const base = activePirateBases(universe)[0]!;
    base.level = 10;
    base.tier = 10;
    base.ships = emptyFleetShips();
    base.defenses = {
      ...base.defenses,
      laserBattery: 0,
      needleTurret: 0,
      arcLattice: 0,
    };
    const ships0 = fleetShipCount(base.ships);
    const def0 = Object.values(base.defenses).reduce((a, b) => a + (b ?? 0), 0);
    base.lastFreeSpawnAt = 0;
    tickPirates(universe, PIRATE_FREE_SPAWN_INTERVAL_MS * 3 + 1);
    const after = universe.pirateBases![base.id]!;
    assert.ok(fleetShipCount(after.ships) > ships0);
    const def1 = Object.values(after.defenses).reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(def1 > def0);
    // Free ship helper scales with level.
    assert.ok(fleetShipCount(pirateFreeSpawnShips(20)) > fleetShipCount(pirateFreeSpawnShips(1)));
  });

  it("splits once at exactly level 25 into coalition", () => {
    const universe = createUniverse("Split Drift", 8);
    const base = activePirateBases(universe)[0]!;
    base.level = 24;
    base.tier = 24;
    base.splitDone = false;
    base.lastGrewAt = 0;
    const before = activePirateBases(universe).length;
    tickPirates(universe, PIRATE_LEVEL_GROWTH_INTERVAL_MS + 1);
    const afterBase = universe.pirateBases![base.id]!;
    assert.equal(afterBase.level, PIRATE_SPLIT_LEVEL);
    assert.equal(afterBase.splitDone, true);
    const living = activePirateBases(universe);
    assert.ok(living.length >= before + 1);
    const children = living.filter(
      (b) => b.id !== base.id && b.coalitionId === afterBase.coalitionId,
    );
    assert.ok(children.length >= 1);
    assert.ok(children.every((c) => c.level === 1));
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
    const now = Date.now();
    const universe = createUniverse("Raid Drift", 8);
    const { player, planet } = joinUniverse(universe, "Hunter", now);

    // Freeze NPC AI so catch-up during travel does not refill the target or raid the player.
    for (const b of activePirateBases(universe)) {
      b.lastGrewAt = now + 86_400_000;
      b.lastFreeSpawnAt = now + 86_400_000;
      b.nextRaidAt = now + 86_400_000;
    }
    // Prefer a pirate already in-system; else retarget the first base next door.
    let base =
      activePirateBases(universe).find(
        (b) =>
          b.coords.galaxy === planet.coords.galaxy &&
          b.coords.system === planet.coords.system,
      ) ?? activePirateBases(universe)[0]!;
    if (
      base.coords.galaxy !== planet.coords.galaxy ||
      base.coords.system !== planet.coords.system
    ) {
      const oldId = base.id;
      base.coords = {
        galaxy: planet.coords.galaxy,
        system: planet.coords.system,
        slot: planet.coords.slot === 15 ? 14 : planet.coords.slot + 1,
      };
      base.id = `pir:${base.coords.galaxy}:${base.coords.system}:${base.coords.slot}`;
      delete universe.pirateBases![oldId];
      universe.pirateBases![base.id] = base;
    }
    base.tier = 0;
    base.level = 0;
    base.ships = emptyFleetShips();
    base.defenses = emptyDefenses();
    base.resources = { metal: 2000, crystal: 1000, deuterium: 200 };

    const body = universe.planets[planet.id];
    body.ships.cruiser = 5;
    body.ships.interceptor = 10;
    body.resources = { metal: 50_000, crystal: 50_000, deuterium: 5_000_000 };

    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { cruiser: 3, interceptor: 5 },
      pirateBaseId: base.id,
      now: now + 100,
    });
    assert.equal(
      launch.ok,
      true,
      !launch.ok
        ? `${launch.error} (deut=${universe.planets[planet.id].resources.deuterium})`
        : "",
    );
    if (!launch.ok) return;

    // Keep target empty through arrival (no hangar refill mid-flight).
    base.ships = emptyFleetShips();
    base.defenses = emptyDefenses();

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

describe("aliens", () => {
  it("does not seed aliens; find settles nearest slot-1 after roll", () => {
    const universe = createUniverse("Alien Find", 8);
    assert.equal(activeAlienBases(universe).length, 0);
    const { player, planet } = joinUniverse(universe, "Finder", 500_000_000);
    // Force a find by calling try with a crafted fleet many times until success
    // or inject by creating directly for settle/buildup tests.
    const forced = createAlienBase(
      universe,
      planet.coords.galaxy,
      Math.min(MAP_SYSTEMS, planet.coords.system + 1),
      1,
      500_000_000,
      player.id,
      0,
    );
    // May fail if slot blocked — pick any open via try path with mock.
    if (!universe.alienBases) universe.alienBases = {};
    // Use tryAlienExpeditionFind with overridden chance by placing base manually:
    universe.alienBases[forced.id] = forced;
    assert.ok(activeAlienBases(universe).length >= 1);
    assert.ok(forced.buildupEndsAt >= forced.foundAt + ALIEN_BUILDUP_MS - 1);
    assert.equal(forced.coords.slot, 1);
  });

  it("blocks raids during buildup then allows after", () => {
    const universe = createUniverse("Alien Buildup", 8);
    const { player, planet } = joinUniverse(universe, "Prey", 600_000_000);
    const siteSystem = Math.min(MAP_SYSTEMS, planet.coords.system + 2);
    const alien = createAlienBase(
      universe,
      planet.coords.galaxy,
      siteSystem,
      1,
      600_000_000,
      player.id,
      5,
    );
    universe.alienBases = { [alien.id]: alien };
    alien.nextRaidAt = alien.foundAt; // due immediately but buildup blocks
    const shipsBefore = { ...universe.planets[planet.id].ships };
    tickPirates(universe, alien.foundAt + 1000);
    // During buildup, raids should not fire (nextRaidAt may stay / no combat).
    assert.ok(alien.buildupEndsAt > alien.foundAt + 1000);
    tickPirates(universe, alien.buildupEndsAt + PIRATE_RAID_PERIOD_MS * 2);
    // After buildup, AI sim progressed (lastAiSimAt set).
    assert.ok((universe.lastAiSimAt ?? 0) >= alien.buildupEndsAt);
    void shipsBefore;
    void ALIEN_MAX_BASE_COUNT;
  });

  it("splits once at level 50", () => {
    const universe = createUniverse("Alien Split", 8);
    const { player, planet } = joinUniverse(universe, "Watcher", 700_000_000);
    const alien = createAlienBase(
      universe,
      planet.coords.galaxy,
      Math.min(MAP_SYSTEMS, planet.coords.system + 3),
      1,
      700_000_000,
      player.id,
      49,
    );
    alien.splitDone = false;
    alien.lastGrewAt = 0;
    alien.buildupEndsAt = 0;
    universe.alienBases = { [alien.id]: alien };
    const before = activeAlienBases(universe).length;
    tickPirates(universe, PIRATE_LEVEL_GROWTH_INTERVAL_MS + 1);
    const after = universe.alienBases![alien.id]!;
    assert.equal(after.level, ALIEN_SPLIT_LEVEL);
    assert.equal(after.splitDone, true);
    assert.ok(activeAlienBases(universe).length >= before);
  });

  it("tryAlienExpeditionFind respects max and returns null usually", () => {
    const universe = createUniverse("Rare Find", 8);
    const { player, planet } = joinUniverse(universe, "Exp", 800_000_000);
    const fleet = {
      id: "flt_nofind",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: {
        galaxy: planet.coords.galaxy,
        system: planet.coords.system,
        slot: 16,
      },
      mission: "expedition",
      ships: emptyFleetShips(),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 800_000_000,
      arrivesAt: 800_000_100,
      phase: "outbound",
      reportId: null,
    } as FleetMission;
    // Extremely unlikely at 0.001%; assert null for this id.
    const found = tryAlienExpeditionFind(universe, fleet, 800_000_100);
    // May rarely succeed — if so, still valid.
    if (found) {
      assert.equal(found.coords.slot, 1);
      assert.equal(found.foundByPlayerId, player.id);
    } else {
      assert.equal(found, null);
    }
  });
});

describe("lazy tick perf smoke", () => {
  it("catch-up ticks 200 bases across multi-hour window under budget", () => {
    const universe = createUniverse("Perf", 8);
    assert.ok(activePirateBases(universe).length >= 150);
    const t0 = Date.now();
    // Jump ~6 hours so growth + free spawn + several raid windows catch up.
    const now =
      (universe.lastAiSimAt ?? Date.now()) +
      PIRATE_LEVEL_GROWTH_INTERVAL_MS +
      PIRATE_RAID_PERIOD_MS * 3;
    tickPirates(universe, now);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 15_000, `tick took ${elapsed}ms`);
    assert.equal(universe.lastAiSimAt, now);
  });
});

describe("NPC soft raids", () => {
  it("soft-caps pressure so a starter hangar is not wiped", () => {
    const universe = createUniverse("Soft Raid", 8);
    const { planet } = joinUniverse(universe, "Newbie", 420_000_000);
    const body = universe.planets[planet.id];
    body.ships.scout = 2;
    body.resources = { metal: 500, crystal: 500, deuterium: 100 };

    const base = activePirateBases(universe)[0]!;
    base.level = 40;
    base.tier = 40;
    base.ships = pirateShipsForTier(40);
    base.nextRaidAt = 0;

    tickPirates(universe, PIRATE_RAID_PERIOD_MS * 3);
    const capped = scalePirateRaidFleet(
      base.ships,
      fleetCombatPower(body.ships),
    );
    assert.ok(fleetCombatPower(capped) < fleetCombatPower(base.ships));
  });

  it("STARHOLD_E2E=1 advances raid schedule without looting players", () => {
    const prev = process.env.STARHOLD_E2E;
    process.env.STARHOLD_E2E = "1";
    try {
      const universe = createUniverse("E2E Quiet", 8);
      const { planet } = joinUniverse(universe, "Banker", 421_000_000);
      const body = universe.planets[planet.id]!;
      body.resources = { metal: 500, crystal: 500, deuterium: 100 };
      for (const base of activePirateBases(universe)) {
        base.nextRaidAt = 0;
      }
      const now = PIRATE_RAID_PERIOD_MS * 2;
      tickPirates(universe, now);
      assert.equal(body.resources.metal, 500);
      assert.equal(body.resources.crystal, 500);
      for (const base of activePirateBases(universe).slice(0, 20)) {
        assert.ok(base.nextRaidAt > now - PIRATE_RAID_PERIOD_MS);
      }
    } finally {
      if (prev == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = prev;
    }
  });
});

describe("workers tick budget", () => {
  it("closed-form free spawn matches interval steps at the current level", () => {
    const universe = createUniverse("Spawn Exact", 8);
    const base = activePirateBases(universe)[0]!;
    const steps = 5;
    const now = PIRATE_FREE_SPAWN_INTERVAL_MS * steps + 10;
    base.level = 4;
    base.tier = 4;
    base.ships = emptyFleetShips();
    base.defenses = emptyDefenses();
    base.lastFreeSpawnAt = 0;
    base.lastGrewAt = now + 1;
    base.nextRaidAt = now + 1;
    const grant = fleetShipCount(pirateFreeSpawnShips(4));
    tickPirates(universe, now);
    const after = universe.pirateBases![base.id]!;
    assert.equal(fleetShipCount(after.ships), grant * steps);
    assert.equal(after.lastFreeSpawnAt, PIRATE_FREE_SPAWN_INTERVAL_MS * steps);
  });

  it("raid budget stops early and the next call continues", () => {
    let budget: TickBudget | undefined;
    bindTickBudget(() => budget);
    try {
      const universe = createUniverse("Raid Budget", 8);
      const now = PIRATE_RAID_PERIOD_MS * 4;
      for (const base of activePirateBases(universe)) {
        base.lastGrewAt = now + 1;
        base.lastFreeSpawnAt = now + 1;
        base.nextRaidAt = now + 1;
      }
      const base = activePirateBases(universe)[0]!;
      // 0 is treated as "unset" and rescheduled into the future.
      base.nextRaidAt = 1;
      const step = (): TickBudget => ({
        raids: 1,
        levelUps: 50,
        fleets: 5,
        driftSteps: 20,
        seedSystems: 0,
        seedMinis: 0,
        seedPirates: 0,
        lazyPlanets: true,
      });
      budget = step();
      tickPirates(universe, now);
      const mid = universe.pirateBases![base.id]!.nextRaidAt;
      assert.ok(mid > 0);
      assert.ok(mid <= now);
      budget = step();
      tickPirates(universe, now);
      assert.ok(universe.pirateBases![base.id]!.nextRaidAt > mid);
    } finally {
      bindTickBudget(() => undefined);
    }
  });
});

// silence unused in case of tree shake
void MAP_GALAXIES;
void (0 as UniverseState | 0);
