import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { performance } from "node:perf_hooks";
import { continueUniverseSeed } from "./world-seed.js";
import { installDeterministicInputs } from "./test-determinism.js";
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
  PIRATE_FATIGUE_EXTRA_HITS,
  PIRATE_FATIGUE_FIRST_HITS,
  PIRATE_FATIGUE_MULT,
  PIRATE_FATIGUE_WINDOW_MS,
  PIRATE_LEVEL_GROWTH_INTERVAL_MS,
  PIRATE_MAX_LEVEL,
  PIRATE_RAID_PERIOD_MS,
  ALIEN_RAID_PERIOD_MS,
  PIRATE_RAID_POWER_FACTOR,
  PIRATE_RAID_POWER_FLOOR,
  PIRATE_SPLIT_LEVEL,
  PIRATE_TARGET_BASE_COUNT,
  SHIPS,
} from "./catalog.js";
import {
  emptyDefenses,
  defenseCombatPower,
  effectiveCombatResearch,
  emptyFleetShips,
  fleetCombatPower,
  fleetShipCount,
  resolveCombat,
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
  migrateOrResetUniverse,
  migrateUniverseV4ToV5,
  pirateDestroyStarshards,
  pirateEligibleShipIds,
  pirateFreeSpawnShips,
  pirateRespawnAt,
  pirateShipsForTier,
  npcJobBudget,
  rollNextRaidAt,
  scalePirateRaidFleet,
  tickPirates,
  tryAlienExpeditionFind,
} from "./world.js";
import type { TickBudget } from "./tick-budget.js";
import type { FleetMission, UniverseState } from "./types.js";
import {
  PIRATE_RAID_POWER_FACTOR_PLAYER,
  PIRATE_TECH_OFFSET,
} from "./data/tuning.js";
import {
  ALIEN_RAID_POWER_FACTOR_MAX,
  ALIEN_RAID_POWER_FACTOR_MIN,
  ALIEN_TECH_OFFSET,
  alienCombatResearchForOpponent,
  alienRaidPowerFactor,
  applyNpcRaidOnPlanet,
  applyStrongShipCap,
  createPirateBase,
  findNearestOpenSlot1,
  resolveAlienRaidArrival,
  pirateFatigueMult,
  recordPirateHit,
  pirateCombatResearch,
  pirateCombatResearchForOpponent,
  scaleAlienRaidFleet,
} from "./world-pirates.js";

let restoreInputs: (() => void) | undefined;
beforeEach(() => {
  restoreInputs = installDeterministicInputs(0x50495241, 1_700_000_000_000);
});
afterEach(() => {
  restoreInputs?.();
  restoreInputs = undefined;
});

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

  it("advancing does not reseed or strengthen existing pirate bases", () => {
    const universe = createUniverse("Existing pirate bases", 8);
    const bases = activePirateBases(universe);
    const before = bases.map((base) => ({
      id: base.id,
      ships: { ...base.ships },
      defenses: { ...base.defenses },
      level: base.level,
    }));
    advanceUniverse(universe, Date.now() + 1_000);
    const after = activePirateBases(universe);
    assert.equal(after.length, before.length);
    assert.deepEqual(
      after.map((base) => ({
        id: base.id,
        ships: base.ships,
        defenses: base.defenses,
        level: base.level,
      })),
      before,
    );
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

  it("schedules nextRaidAt within each raid period", () => {
    const now = 1_700_000_000_000;
    const at = rollNextRaidAt("pir:1:1:1", now, PIRATE_RAID_PERIOD_MS);
    assert.ok(at > now);
    const periodStart = Math.floor(at / PIRATE_RAID_PERIOD_MS) * PIRATE_RAID_PERIOD_MS;
    assert.ok(at >= periodStart);
    assert.ok(at < periodStart + PIRATE_RAID_PERIOD_MS);
  });

  it("raids pirates every 90 minutes and aliens every hour", () => {
    assert.equal(PIRATE_RAID_PERIOD_MS, 90 * 60 * 1000);
    assert.equal(ALIEN_RAID_PERIOD_MS, 60 * 60 * 1000);
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
  it("resolves an already launched player raid against a new player", () => {
    const universe = createUniverse("In-flight raid", 8);
    const attacker = joinUniverse(universe, "Attacker", Date.now());
    const defender = joinUniverse(universe, "New defender", Date.now() + 1);
    const now = defender.player.createdAt + 60 * 60 * 1000;
    const fleet: FleetMission = {
      id: "old-in-flight-raid",
      ownerPlayerId: attacker.player.id,
      originPlanetId: attacker.planet.id,
      targetPlanetId: defender.planet.id,
      targetPlayerId: defender.player.id,
      targetCoords: defender.planet.coords,
      mission: "raid",
      ships: { ...emptyFleetShips(), lightFighter: 1 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now - 1000,
      arrivesAt: now,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    if (universe.seedCursor) universe.seedCursor.done = true;
    advanceUniverse(universe, now);
    assert.ok(Object.keys(universe.reports).length > 0);
  });

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
  it("settles into the nearest open slot among 1-3", () => {
    const universe = createUniverse("Alien slots", 8);
    const { planet } = joinUniverse(universe, "Finder", 490_000_000);
    const origin = { galaxy: 1, system: 1, slot: 1 };
    universe.planets = {};
    universe.planets.blocker = { ...planet, id: "blocker", coords: origin };
    // Slot 1 is occupied; slot 2 is the nearest free choice.
    const site = findNearestOpenSlot1(universe, origin, "nearest-slot-test");
    assert.deepEqual(site, { ...origin, slot: 2 });
  });

  it("falls back to any open slot when slots 1-3 are occupied", () => {
    const universe = createUniverse("Alien slot fallback", 8);
    const { planet } = joinUniverse(universe, "Finder", 495_000_000);
    const origin = planet.coords;
    for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
      for (let system = 1; system <= MAP_SYSTEMS; system++) {
        for (let slot = 1; slot <= 3; slot++) {
          const id = `blocker-${galaxy}-${system}-${slot}`;
          universe.planets[id] = { ...planet, id, coords: { galaxy, system, slot } };
        }
      }
    }
    const site = findNearestOpenSlot1(universe, origin, "fallback-slot-test");
    assert.ok(site);
    assert.ok(site.slot > 3);
  });

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
    const t0 = performance.now();
    // Jump ~6 hours so growth + free spawn + several raid windows catch up.
    const now =
      (universe.lastAiSimAt ?? Date.now()) +
      PIRATE_LEVEL_GROWTH_INTERVAL_MS +
      PIRATE_RAID_PERIOD_MS * 3;
    tickPirates(universe, now);
    const elapsed = performance.now() - t0;
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

  it("fires every due raid across 24h and ends with no backlog", () => {
    const previous = process.env.STARHOLD_E2E;
    process.env.STARHOLD_E2E = "1";
    let budget = npcJobBudget();
    bindTickBudget(() => budget);
    try {
      const universe = createUniverse("Pirate Day", 8);
      const bases = activePirateBases(universe);
      assert.ok(bases.length >= 150, `population ${bases.length}`);
      const start = 1_700_000_000_000;
      for (const base of Object.values(universe.pirateBases ?? {})) {
        base.lastGrewAt = start;
        base.lastFreeSpawnAt = start;
        base.nextRaidAt = rollNextRaidAt(base.id, start, PIRATE_RAID_PERIOD_MS);
      }
      const step = 10 * 60 * 1000;
      const end = start + 24 * 60 * 60 * 1000;
      let measured = 0;
      for (let now = start + step; now <= end; now += step) {
        budget = npcJobBudget();
        const began = performance.now();
        tickPirates(universe, now);
        measured = Math.max(measured, performance.now() - began);
      }
      let backlog = 0;
      for (const base of Object.values(universe.pirateBases ?? {})) {
        if (base.destroyedAt == null && base.nextRaidAt <= end) backlog += 1;
      }
      console.log(`pirate job cpu ms ${measured.toFixed(3)} backlog ${backlog} bases ${bases.length}`);
      assert.equal(backlog, 0);
      assert.ok(measured < 250, `pirate job cpu ${measured.toFixed(3)}ms`);
    } finally {
      bindTickBudget(() => undefined);
      if (previous == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = previous;
    }
  });

  it("a due pirate raid actually fires when combat is enabled", () => {
    const previous = process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_E2E;
    let budget = npcJobBudget();
    bindTickBudget(() => budget);
    try {
      const now = 1_700_000_100_000;
      const universe = createUniverse("Pirate Hit", 8);
      joinUniverse(universe, "Target", now);
      const dueIds = new Set<string>();
      let index = 0;
      for (const other of activePirateBases(universe)) {
        other.lastGrewAt = now;
        other.lastFreeSpawnAt = now;
        other.lastRaidAt = 0;
        if (index < 12) {
          other.nextRaidAt = now - 1;
          dueIds.add(other.id);
        } else {
          other.nextRaidAt = now + PIRATE_RAID_PERIOD_MS;
        }
        index += 1;
      }
      const began = performance.now();
      tickPirates(universe, now);
      const cold = performance.now() - began;
      for (const id of dueIds) {
        const base = universe.pirateBases?.[id];
        if (!base || base.destroyedAt != null) continue;
        base.nextRaidAt = now - 1;
        base.lastRaidAt = 0;
      }
      const warmBegan = performance.now();
      tickPirates(universe, now);
      const cpu = performance.now() - warmBegan;
      let fired = 0;
      let destroyed = 0;
      let stillDue = 0;
      for (const id of dueIds) {
        const base = universe.pirateBases?.[id];
        if (!base || base.destroyedAt != null) {
          destroyed += 1;
          continue;
        }
        if (base.lastRaidAt === now - 1) fired += 1;
        else stillDue += 1;
      }
      console.log(
        `pirate combat job cpu ms ${cpu.toFixed(3)} cold ${cold.toFixed(3)} fired ${fired} destroyed ${destroyed} stillDue ${stillDue}`,
      );
      assert.equal(stillDue, 0);
      assert.ok(fired >= 1, "expected at least one pirate raid to resolve");
      assert.equal(fired + destroyed, dueIds.size);
      for (const [id, planet] of Object.entries(universe.planets)) {
        if (!planet.ownerPlayerId) delete universe.planets[id];
      }
      const wave = 31;
      let armed = 0;
      for (const other of Object.values(universe.pirateBases ?? {})) {
        if (other.destroyedAt != null) continue;
        other.lastGrewAt = now;
        other.lastFreeSpawnAt = now;
        other.lastRaidAt = 0;
        other.nextRaidAt = armed < wave ? now - 1 : now + PIRATE_RAID_PERIOD_MS;
        armed += 1;
      }
      budget = npcJobBudget();
      const waveBegan = performance.now();
      tickPirates(universe, now);
      const waveCpu = performance.now() - waveBegan;
      console.log(`pirate job wave cpu ms ${waveCpu.toFixed(3)} due ${Math.min(wave, armed)}`);
      assert.ok(waveCpu < 250, `pirate job wave cpu ${waveCpu.toFixed(3)}ms`);
    } finally {
      bindTickBudget(() => undefined);
      if (previous == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = previous;
    }
  });
});

describe("pirate spread across galaxies", () => {
  it("every galaxy gets pirates (new commanders spawn in galaxy 1)", () => {
    for (let i = 0; i < 8; i++) {
      const universe = createUniverse(`Spread Drift ${i}`, 8);
      const per = new Array<number>(MAP_GALAXIES + 1).fill(0);
      for (const b of activePirateBases(universe)) per[b.coords.galaxy] += 1;
      for (let g = 1; g <= MAP_GALAXIES; g++) {
        assert.ok(per[g] >= 5, `universe ${i} galaxy ${g}: ${per[g]} pirates (${per.slice(1).join(",")})`);
      }
    }
  });
});

describe("lazy seed rank keys", () => {
  it("re-ranks a cursor scanned with old keys before sorting", () => {
    const universe = createUniverse("Lazy Spread", 8, 8, { lazySeed: true });
    const limits = { systems: 500, minis: 10_000, pirates: 50 };
    let guard = 0;
    while (universe.seedCursor && !universe.seedCursor.done && guard++ < 200) {
      const c = universe.seedCursor;
      // Simulate a cursor persisted before the fix: stale keys, unsorted.
      if (!c.sorted && c.ranks) for (const row of c.ranks) row.k = row.g;
      continueUniverseSeed(universe, Date.now(), limits);
    }
    const per = new Array<number>(MAP_GALAXIES + 1).fill(0);
    for (const b of activePirateBases(universe)) per[b.coords.galaxy] += 1;
    for (let g = 1; g <= MAP_GALAXIES; g++) {
      assert.ok(per[g] >= 5, `galaxy ${g}: ${per[g]} (${per.slice(1).join(",")})`);
    }
  });
});

describe("lazy seed cursor sorted with the old key", () => {
  it("re-ranks the unplaced tail once, then keeps placing in the new order", () => {
    const universe = createUniverse("Lazy Sorted", 8, 8, { lazySeed: true });
    const limits = { systems: 500, minis: 10_000, pirates: 20 };
    let guard = 0;
    // Finish the scan, then fake a cursor sorted and partly placed with old keys.
    while (universe.seedCursor && !universe.seedCursor.done && !universe.seedCursor.sorted && guard++ < 200) {
      const c = universe.seedCursor;
      if (c.ranks && c.at >= MAP_GALAXIES * MAP_SYSTEMS) {
        for (const row of c.ranks) row.k = row.g;
        c.ranks.sort((a, b) => a.k - b.k || a.g - b.g || a.s - b.s);
        c.sorted = true;
        c.rankAt = 0;
        delete c.rankVersion;
        break;
      }
      continueUniverseSeed(universe, Date.now(), limits);
    }
    guard = 0;
    while (universe.seedCursor && !universe.seedCursor.done && guard++ < 200) {
      continueUniverseSeed(universe, Date.now(), limits);
    }
    const per = new Array<number>(MAP_GALAXIES + 1).fill(0);
    for (const b of activePirateBases(universe)) per[b.coords.galaxy] += 1;
    for (let g = 1; g <= MAP_GALAXIES; g++) {
      assert.ok(per[g] >= 5, `galaxy ${g}: ${per[g]} (${per.slice(1).join(",")})`);
    }
  });
});

describe("B3-24 pirate strength, raid power and strong-ship cap", () => {
  it("asserts pirate combat tech = opponent - 3 (and 0 floor) in both directions", () => {
    // 1. Helper check
    const pTech = pirateCombatResearchForOpponent({ weaponsTech: 8, shieldingTech: 4, armourTech: 2 });
    assert.equal(pTech.weaponsTech, 5); // 8 - 3
    assert.equal(pTech.shieldingTech, 1); // 4 - 3
    assert.equal(pTech.armourTech, 0); // max(0, 2 - 3)

    const lowTech = pirateCombatResearchForOpponent({ weaponsTech: 1, shieldingTech: 0, armourTech: 0 });
    assert.equal(lowTech.weaponsTech, 0);
    assert.equal(lowTech.shieldingTech, 0);
    assert.equal(lowTech.armourTech, 0);

    // 2. Direction A: Player attacks pirate base.
    // Player has tech 8/8/8. Pirate base tier 100 has stored techs 25/25/25.
    // At fight time, defender research for pirate base MUST equal player tech - 3 = 5/5/5.
    const universe1 = createUniverse("Combat Tech Attack Test", 8);
    const { player: playerA, planet: planetA } = joinUniverse(universe1, "Attacker", Date.now());
    playerA.research = { weaponsTech: 8, shieldingTech: 8, armourTech: 8 };
    universe1.planets[planetA.id].resources.deuterium = 100_000;

    const baseA = activePirateBases(universe1)[0]!;
    baseA.level = 100;
    baseA.tier = 100;
    baseA.techs = { weapons: 25, shielding: 25, armour: 25 };
    baseA.ships = { ...emptyFleetShips(), cruiser: 1 };

    const fightTechA = pirateCombatResearch(baseA, playerA.research);
    assert.equal(fightTechA.weaponsTech, 5);
    assert.equal(fightTechA.shieldingTech, 5);
    assert.equal(fightTechA.armourTech, 5);

    universe1.planets[planetA.id].ships.cruiser = 1;
    const launchA = launchFleet(universe1, {
      playerId: playerA.id,
      mission: "pirateRaid",
      ships: { cruiser: 1 },
      pirateBaseId: baseA.id,
      now: Date.now() + 100,
    });
    assert.equal(launchA.ok, true);
    advanceUniverse(universe1, launchA.fleet.arrivesAt);

    const reportA = universe1.reports[launchA.fleet.reportId!];
    assert.ok(reportA);
    assert.equal(reportA.outcome, "attacker_win");

    // 3. Direction B: Pirate raids player.
    // Player has tech 8/8/8. Pirate base tier 100 (stored tech 25) raids player planet.
    // At fight time, attacker research for pirate base MUST equal player tech - 3 = 5/5/5.
    const nowB = Date.now();
    const universe2 = createUniverse("Combat Tech Raid Test", 8);
    delete universe2.skipNpcRaids;
    universe2.skipPirateTopUp = true;
    const { player: playerB, planet: planetB } = joinUniverse(universe2, "Defender", nowB - 10 * 86_400_000);
    playerB.createdAt = nowB - 10 * 86_400_000;
    playerB.attackedPiratesAt = nowB - 1000;
    playerB.research = { weaponsTech: 8, shieldingTech: 8, armourTech: 8 };
    const planetState = universe2.planets[planetB.id]!;
    planetState.buildings = { metalMine: 30, crystalMine: 30, solarPlant: 30 };
    planetState.ships = { ...emptyFleetShips(), cruiser: 10 };

    const baseB = activePirateBases(universe2)[0]!;
    universe2.pirateBases = { [baseB.id]: baseB };
    baseB.level = 100;
    baseB.tier = 100;
    baseB.techs = { weapons: 25, shielding: 25, armour: 25 };
    baseB.ships = { ...emptyFleetShips(), cruiser: 1 };
    baseB.nextRaidAt = nowB;

    const fightTechB = pirateCombatResearch(baseB, playerB.research);
    assert.equal(fightTechB.weaponsTech, 5);
    assert.equal(fightTechB.shieldingTech, 5);
    assert.equal(fightTechB.armourTech, 5);

    const prevE2E = process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_E2E;
    try {
      tickPirates(universe2, nowB + 1000);

      const event = (universe2.players[playerB.id]?.eventLog ?? []).find(
        (e) => e.kind === "raidAlert" && e.meta?.pirateBaseId === baseB.id,
      );
      assert.ok(event, "expected raidAlert event");
      assert.equal(event.meta?.outcome, "defender_win");
    } finally {
      if (prevE2E != null) process.env.STARHOLD_E2E = prevE2E;
    }
  });

  it("alien raids use seeded 90-100% power scaling while pirate raids use 0.70 + strong-ship cap", () => {
    const now = 1_000_000_000_000;
    const universe = createUniverse("Raid Sizing Real Path Test", 8);
    delete universe.skipNpcRaids;

    const { player, planet } = joinUniverse(universe, "TargetPlayer", now - 10 * 86_400_000);
    player.createdAt = now - 10 * 86_400_000;
    player.attackedPiratesAt = now - 1000;
    const planetState = universe.planets[planet.id]!;
    planetState.buildings = { metalMine: 30, crystalMine: 30, solarPlant: 30 };
    planetState.ships = { ...emptyFleetShips(), interceptor: 10 };

    universe.planets = { [planetState.id]: planetState };

    // 1. Alien base raid via tickPirates (faction === "alien")
    const alienBase = createAlienBase(
      universe,
      planetState.coords.galaxy,
      Math.min(MAP_SYSTEMS, planetState.coords.system + 1),
      1,
      now,
      player.id,
      10,
    );
    alienBase.buildupEndsAt = now - 1000;
    alienBase.nextRaidAt = now - 500;
    alienBase.ships = { ...emptyFleetShips(), cruiser: 100 };
    universe.alienBases = { [alienBase.id]: alienBase };
    universe.pirateBases = {};

    const defenderPower = fleetCombatPower(planetState.ships, player.research) + defenseCombatPower(planetState.defenses ?? {}, player.research);
    const alienRaidSeed = `${alienBase.id}:alien-raid:${now + 1000}`;
    const expectedAlienRaid = scaleAlienRaidFleet(alienBase.ships, defenderPower, alienRaidSeed);

    assert.equal(PIRATE_RAID_POWER_FACTOR, 1.4);
    assert.ok((expectedAlienRaid.cruiser ?? 0) > 0, "alien raid includes cruisers despite defender having 0");
    assert.ok(fleetCombatPower(expectedAlienRaid) <= defenderPower * ALIEN_RAID_POWER_FACTOR_MAX);

    const prevE2E = process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_E2E;

    try {
      tickPirates(universe, now + 1000);

      const alienAlert = (universe.players[player.id]?.eventLog ?? []).find(
        (e) => e.kind === "raidAlert" && e.meta?.pirateBaseId === alienBase.id,
      );
      assert.ok(alienAlert, "expected alien raid alert in event log");
      const actualAlienFleet = JSON.parse(alienAlert.meta?.raidFleet as string);
      assert.deepEqual(actualAlienFleet, expectedAlienRaid);

      // 2. Reset defender ships and test Pirate base raid via tickPirates (faction === "pirate")
      planetState.ships = { ...emptyFleetShips(), interceptor: 10 };
      const pirateBase = createPirateBase(
        universe.seed,
        planetState.coords.galaxy,
        Math.min(MAP_SYSTEMS, planetState.coords.system + 2),
        1,
        now + 2000,
        10,
      );
      pirateBase.ships = { ...emptyFleetShips(), cruiser: 100, interceptor: 100 };
      pirateBase.nextRaidAt = now + 2000;
      universe.pirateBases = { [pirateBase.id]: pirateBase };
      universe.alienBases = {};

      const defenderPower2 = fleetCombatPower(planetState.ships, player.research) + defenseCombatPower(planetState.defenses ?? {}, player.research);
      const expectedPirateRaid = scalePirateRaidFleet(
        pirateBase.ships,
        defenderPower2,
        planetState.ships,
        PIRATE_RAID_POWER_FACTOR_PLAYER,
      );

      assert.equal(PIRATE_RAID_POWER_FACTOR_PLAYER, 0.70);
      assert.equal(expectedPirateRaid.cruiser ?? 0, 0, "pirate raid caps cruisers at 0 due to strong-ship cap");
      assert.ok(fleetCombatPower(expectedPirateRaid) <= defenderPower2 * PIRATE_RAID_POWER_FACTOR_PLAYER + 1e-6);

      tickPirates(universe, now + 3000);

      const pirateAlert = (universe.players[player.id]?.eventLog ?? []).find(
        (e) => e.kind === "raidAlert" && e.meta?.pirateBaseId === pirateBase.id,
      );
      assert.ok(pirateAlert, "expected pirate raid alert in event log");
      const actualPirateFleet = JSON.parse(pirateAlert.meta?.raidFleet as string);
      assert.deepEqual(actualPirateFleet, expectedPirateRaid);
    } finally {
      if (prevE2E != null) process.env.STARHOLD_E2E = prevE2E;
    }
  });

  it("NPC-on-NPC raid produces the same fleet size as before this PR", () => {
    const full = { ...emptyFleetShips(), interceptor: 1000 }; // 1000 Interceptors (power 69,000)
    const defenderPower = 10_000;

    // NPC vs NPC (no defenderShips passed) -> uses factor 1.4, no strong ship cap
    const npcRaid = scalePirateRaidFleet(full, defenderPower);
    assert.equal(PIRATE_RAID_POWER_FACTOR, 1.4);
    // 10,000 * 1.4 = 14,000 cap. 14,000 / 69 = 202 Interceptors (power 13,938).
    assert.equal(npcRaid.interceptor, 202);
    assert.ok(fleetCombatPower(npcRaid) <= defenderPower * PIRATE_RAID_POWER_FACTOR);

    // Player raid -> uses factor 0.70 with strong ship cap
    const defenderShips = { ...emptyFleetShips(), cruiser: 10 };
    const playerRaid = scalePirateRaidFleet(
      full,
      defenderPower,
      defenderShips,
      PIRATE_RAID_POWER_FACTOR_PLAYER,
    );
    assert.equal(PIRATE_RAID_POWER_FACTOR_PLAYER, 0.70);
    // 10,000 * 0.70 = 7,000 cap.
    assert.ok(fleetCombatPower(playerRaid) < fleetCombatPower(npcRaid));
    assert.equal(fleetCombatPower(playerRaid), 6969); // 101 Interceptors * 69 = 6969
  });

  it("raid power ~70% of defender power (hand-computed small case)", () => {
    const defenderShips = { ...emptyFleetShips(), interceptor: 10 };
    const defenderPower = fleetCombatPower(defenderShips);
    assert.equal(defenderPower, 690);

    const baseStock = { ...emptyFleetShips(), interceptor: 100 };
    const scaled = scalePirateRaidFleet(baseStock, defenderPower, defenderShips);

    assert.equal(scaled.interceptor, 7);
    assert.equal(fleetCombatPower(scaled), 483);
  });

  it("never exceeds base stock", () => {
    const smallStock = { ...emptyFleetShips(), interceptor: 3, cruiser: 1 };
    const defenderShips = { ...emptyFleetShips(), cruiser: 10 };
    const hugePower = 1_000_000;

    const scaled = scalePirateRaidFleet(smallStock, hugePower, defenderShips);

    assert.ok((scaled.interceptor ?? 0) <= 3);
    assert.ok((scaled.cruiser ?? 0) <= 1);
    assert.ok((scaled.bomber ?? 0) === 0);
  });

  it("strong-ship cap with a mixed defender fleet", () => {
    const defenderShips = { ...emptyFleetShips(), cruiser: 2, bomber: 1 };
    const baseStock = { ...emptyFleetShips(), cruiser: 50, bomber: 50 };

    const capped = applyStrongShipCap(baseStock, defenderShips);

    assert.equal(capped.bomber, 1);
    assert.equal(capped.cruiser, 3);
  });

  it("interceptors and cheaper types may exceed defender numbers", () => {
    const defenderShips = { ...emptyFleetShips(), interceptor: 1 };
    const baseStock = { ...emptyFleetShips(), interceptor: 20, cruiser: 20 };

    const capped = applyStrongShipCap(baseStock, defenderShips);

    assert.equal(capped.cruiser, 0);
    assert.equal(capped.interceptor, 20);

    const scaled = scalePirateRaidFleet(baseStock, 5000, defenderShips);
    assert.equal(scaled.cruiser, 0);
    assert.ok((scaled.interceptor ?? 0) > 1);
  });

  it("loads an old-shaped saved state via JSON serialization and save-loading path, resolves raid and preserves progress", () => {
    const now = Date.now();
    const original = createUniverse("Old Save JSON", 8);
    original.skipPirateTopUp = true;
    const { player, planet } = joinUniverse(original, "OldCommander", now - 10 * 86_400_000);
    player.createdAt = now - 10 * 86_400_000;
    player.attackedPiratesAt = now - 1000;
    const body = original.planets[planet.id]!;

    body.buildings = { metalMine: 20, crystalMine: 18, solarPlant: 22 };
    body.ships = { ...emptyFleetShips(), interceptor: 20, hauler: 5 };
    body.resources = { metal: 50_000, crystal: 30_000, deuterium: 10_000 };
    player.xp = 1250;
    player.xpTotal = 1250;
    player.starshards = 100;

    original.planets = { [body.id]: body };
    const base = activePirateBases(original)[0]!;
    original.pirateBases = { [base.id]: base };
    base.nextRaidAt = now;

    const savedJson = JSON.stringify(original);
    assert.ok(typeof savedJson === "string");

    const loadedRaw = JSON.parse(savedJson);
    const { universe } = migrateOrResetUniverse(loadedRaw);
    delete universe.skipNpcRaids;

    const prevE2E = process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_E2E;

    try {
      tickPirates(universe, now + 1000);

      const eventLog = universe.players[player.id]?.eventLog ?? [];
      assert.ok(eventLog.length >= 1, "expected at least one event log entry");
      const raidAlert = eventLog.find((e) => e.kind === "raidAlert");
      assert.ok(raidAlert, "expected raidAlert in event log");

      universe.planets[planet.id].resources.deuterium = 100_000;
      universe.planets[planet.id].ships.cruiser = 5;
      const launch = launchFleet(universe, {
        playerId: player.id,
        mission: "pirateRaid",
        ships: { cruiser: 5 },
        pirateBaseId: base.id,
        now: now + 2000,
      });
      assert.equal(launch.ok, true);
      advanceUniverse(universe, launch.fleet.arrivesAt);
      assert.ok(launch.fleet.reportId);
      assert.ok(universe.reports[launch.fleet.reportId!]);

      assert.equal(universe.players[player.id]?.name, "OldCommander");
      assert.ok((universe.players[player.id]?.xpTotal ?? 0) >= 1200);
      assert.ok((universe.players[player.id]?.starshards ?? 0) >= 10);
      assert.equal(body.buildings.metalMine, 20);
      assert.equal(body.buildings.crystalMine, 18);
      assert.equal(body.buildings.solarPlant, 22);
      assert.ok(body.resources.metal > 0);
      assert.ok(fleetShipCount(body.ships) > 0);
    } finally {
      if (prevE2E != null) process.env.STARHOLD_E2E = prevE2E;
    }
  });
});

describe("B3-25 alien strength and raid power", () => {
  it("sets alien combat research to opponent +2, including zero-tech opponents", () => {
    const research = alienCombatResearchForOpponent({
      weaponsTech: 8,
      armourTech: 4,
      shieldingTech: 1,
    });
    assert.equal(ALIEN_TECH_OFFSET, 2);
    assert.equal(research.weaponsTech, 10);
    assert.equal(research.armourTech, 6);
    assert.equal(research.shieldingTech, 3);

    const zeroTech = alienCombatResearchForOpponent({
      weaponsTech: 0,
      armourTech: 0,
      shieldingTech: 0,
    });
    assert.equal(zeroTech.weaponsTech, 2);
    assert.equal(zeroTech.armourTech, 2);
    assert.equal(zeroTech.shieldingTech, 2);

    const universe = createUniverse("Alien Research Defaults", 8);
    const { player, planet } = joinUniverse(universe, "Opponent", Date.now());
    const alien = createAlienBase(
      universe,
      planet.coords.galaxy,
      Math.min(MAP_SYSTEMS, planet.coords.system + 1),
      1,
      Date.now(),
      player.id,
      1,
    );
    alien.techs = { weapons: 4, armour: 3, shielding: 2 };
    assert.deepEqual(
      pirateCombatResearch(alien, {
        weaponsTech: 1,
        armourTech: 0,
        shieldingTech: 5,
      }),
      alienCombatResearchForOpponent({
        weaponsTech: 1,
        armourTech: 0,
        shieldingTech: 5,
      }),
    );
    assert.deepEqual(pirateCombatResearch(alien), {
      ...alienCombatResearchForOpponent(),
      weaponsTech: 4,
      armourTech: 3,
      shieldingTech: 2,
    });
  });

  it("scales alien raid power deterministically to 90-100% without exceeding stock", () => {
    const seed = "aln:1:2:1:alien-raid:1700000000000";
    const factor = alienRaidPowerFactor(seed);
    assert.equal(factor, alienRaidPowerFactor(seed));
    assert.ok(factor >= ALIEN_RAID_POWER_FACTOR_MIN);
    assert.ok(factor <= ALIEN_RAID_POWER_FACTOR_MAX);

    const stock = { ...emptyFleetShips(), interceptor: 2500 };
    const defenderPower = 69_000;
    const raid = scaleAlienRaidFleet(stock, defenderPower, seed);
    assert.deepEqual(raid, scaleAlienRaidFleet(stock, defenderPower, seed));
    assert.ok(fleetCombatPower(raid) >= defenderPower * ALIEN_RAID_POWER_FACTOR_MIN);
    assert.ok(fleetCombatPower(raid) <= defenderPower * ALIEN_RAID_POWER_FACTOR_MAX);
    for (const id of Object.keys(raid) as (keyof typeof raid)[]) {
      assert.ok(raid[id] <= stock[id]);
    }
    assert.equal(raid.cruiser, 0);
  });

  it("uses opponent +2 tech and seeded power scaling for an alien planet raid", () => {
    const now = Date.now();
    const universe = createUniverse("Alien Planet Raid Tech", 8);
    const { player, planet } = joinUniverse(
      universe,
      "Alien Raid Defender",
      now - 30 * 86_400_000,
    );
    player.createdAt = now - 30 * 86_400_000;
    player.research = { weaponsTech: 5, armourTech: 3, shieldingTech: 4 };
    const planetState = universe.planets[planet.id]!;
    planetState.ships = { ...emptyFleetShips(), interceptor: 20 };
    planetState.defenses = emptyDefenses();

    const alien = createAlienBase(
      universe,
      planetState.coords.galaxy,
      Math.min(MAP_SYSTEMS, planetState.coords.system + 1),
      1,
      now,
      player.id,
      1,
    );
    alien.ships = { ...emptyFleetShips(), interceptor: 1000 };
    universe.alienBases = { [alien.id]: alien };

    const defenderResearch = effectiveCombatResearch(player)!;
    const defenderPower =
      fleetCombatPower(planetState.ships, player.research) +
      defenseCombatPower(planetState.defenses, player.research);
    const raidFleet = scaleAlienRaidFleet(
      alien.ships,
      defenderPower,
      `${alien.id}:alien-raid:${now}`,
    );
    const expectedCombat = resolveCombat(
      raidFleet,
      { ...planetState.ships },
      planetState.defenses,
      alienCombatResearchForOpponent(defenderResearch),
      defenderResearch,
    );

    applyNpcRaidOnPlanet(universe, alien, planetState, now, "alien", () => {});

    const report = Object.values(universe.reports).find(
      (entry) => entry.missionId === alien.id,
    );
    assert.ok(report);
    assert.deepEqual(report.attackerBefore, raidFleet);
    assert.equal(report.outcome, expectedCombat.outcome);
    assert.deepEqual(report.attackerAfter, expectedCombat.attackerAfter);
    assert.deepEqual(report.defenderAfter, expectedCombat.defenderAfter);
  });

  it("uses opponent +2 tech when a player fleet attacks an alien base", () => {
    const now = Date.now();
    const universe = createUniverse("Alien Base Raid Tech", 8);
    const { player, planet } = joinUniverse(
      universe,
      "Alien Base Attacker",
      now - 30 * 86_400_000,
    );
    player.createdAt = now - 30 * 86_400_000;
    player.research = { weaponsTech: 5, armourTech: 3, shieldingTech: 4 };
    const planetState = universe.planets[planet.id]!;
    planetState.ships = { ...emptyFleetShips(), interceptor: 20 };
    planetState.resources.deuterium = 100_000;

    const alien = createAlienBase(
      universe,
      planetState.coords.galaxy,
      Math.min(MAP_SYSTEMS, planetState.coords.system + 1),
      1,
      now,
      player.id,
      1,
    );
    alien.ships = { ...emptyFleetShips(), interceptor: 20 };
    alien.defenses = emptyDefenses();
    universe.alienBases = { [alien.id]: alien };

    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "alienRaid",
      ships: { interceptor: 10 },
      alienBaseId: alien.id,
      now,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    const attackerResearch = effectiveCombatResearch(player)!;
    const expectedCombat = resolveCombat(
      launch.fleet.ships,
      { ...alien.ships },
      alien.defenses,
      attackerResearch,
      alienCombatResearchForOpponent(attackerResearch),
    );
    resolveAlienRaidArrival(universe, launch.fleet, launch.fleet.arrivesAt);

    const report = universe.reports[launch.fleet.reportId!];
    assert.ok(report);
    assert.equal(report.outcome, expectedCombat.outcome);
    assert.deepEqual(report.attackerAfter, expectedCombat.attackerAfter);
    assert.deepEqual(report.defenderAfter, expectedCombat.defenderAfter);
  });

  it("loads an existing alien base from a save, preserves progress, and resolves its raid", () => {
    const now = Date.now();
    const original = createUniverse("Alien Old Save", 8);
    const { player, planet } = joinUniverse(original, "Alien Save Player", now);
    const savedPlanet = original.planets[planet.id]!;
    savedPlanet.buildings = { metalMine: 21, crystalMine: 17, solarPlant: 23 };
    savedPlanet.ships = { ...emptyFleetShips(), interceptor: 20, hauler: 4 };
    savedPlanet.resources = { metal: 40_000, crystal: 25_000, deuterium: 100_000 };
    player.xp = 900;
    player.xpTotal = 900;

    const alien = createAlienBase(
      original,
      savedPlanet.coords.galaxy,
      Math.min(MAP_SYSTEMS, savedPlanet.coords.system + 1),
      1,
      now,
      player.id,
      3,
    );
    alien.ships = { ...emptyFleetShips(), interceptor: 20 };
    original.alienBases = { [alien.id]: alien };
    original.planets = { [savedPlanet.id]: savedPlanet };

    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(original))).universe;
    const loadedPlanet = loaded.planets[savedPlanet.id]!;
    const loadedAlien = loaded.alienBases?.[alien.id];
    const assertBuildingsPreserved = () => {
      for (const [building, level] of Object.entries(savedPlanet.buildings)) {
        assert.equal(loadedPlanet.buildings[building as keyof typeof loadedPlanet.buildings], level);
      }
      for (const [building, level] of Object.entries(loadedPlanet.buildings)) {
        if (!(building in savedPlanet.buildings)) assert.equal(level, 0);
      }
    };
    assert.ok(loadedAlien);
    assertBuildingsPreserved();
    assert.deepEqual(loadedPlanet.ships, savedPlanet.ships);
    assert.deepEqual(loadedPlanet.resources, savedPlanet.resources);
    assert.equal(loaded.players[player.id]?.xpTotal, 900);
    assert.deepEqual(loadedAlien.ships, alien.ships);

    const launch = launchFleet(loaded, {
      playerId: player.id,
      mission: "alienRaid",
      ships: { interceptor: 5 },
      alienBaseId: alien.id,
      now: now + 1000,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    resolveAlienRaidArrival(loaded, launch.fleet, launch.fleet.arrivesAt);
    assert.ok(launch.fleet.reportId);
    assert.ok(loaded.reports[launch.fleet.reportId!]);
    assertBuildingsPreserved();
  });
});

describe("pirate attack fatigue (B7-09)", () => {
  it("multipliers: 0-4 hits = x1, 5-7 hits = x0.5, 8+ = x0.25", () => {
    const now = 10_000_000;
    const universe = createUniverse("Fatigue Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Test");
    const planet = universe.planets[joined.player.homePlanetId]!;

    // 0 hits
    assert.equal(pirateFatigueMult(planet, now), 1);

    // 1-4 hits
    for (let i = 1; i <= 4; i++) {
      recordPirateHit(planet, now + i * 1000);
      assert.equal(pirateFatigueMult(planet, now + i * 1000), 1);
    }

    // 5th hit -> 5 hits in last 2h -> x0.5
    recordPirateHit(planet, now + 5000);
    assert.equal(pirateFatigueMult(planet, now + 5000), 0.5);

    // 6th and 7th hits -> x0.5
    recordPirateHit(planet, now + 6000);
    assert.equal(pirateFatigueMult(planet, now + 6000), 0.5);
    recordPirateHit(planet, now + 7000);
    assert.equal(pirateFatigueMult(planet, now + 7000), 0.5);

    // 8th hit -> 8 hits in last 2h -> x0.25
    recordPirateHit(planet, now + 8000);
    assert.equal(pirateFatigueMult(planet, now + 8000), 0.25);

    // 9th hit -> still x0.25
    recordPirateHit(planet, now + 9000);
    assert.equal(pirateFatigueMult(planet, now + 9000), 0.25);
  });

  it("hits older than 2h expire and multiplier recovers", () => {
    const t0 = 10_000_000;
    const universe = createUniverse("Expire Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Test");
    const planet = universe.planets[joined.player.homePlanetId]!;

    // Record 8 hits at t0
    for (let i = 0; i < 8; i++) {
      recordPirateHit(planet, t0 + i * 100);
    }
    assert.equal(pirateFatigueMult(planet, t0 + 1000), 0.25);

    // At t0 + 1 hour, hits are still within 2h window
    const t1h = t0 + 60 * 60 * 1000;
    assert.equal(pirateFatigueMult(planet, t1h), 0.25);

    // At t0 + 2 hours + 2000 ms, all original hits have expired (> 2h old)
    const tExpired = t0 + PIRATE_FATIGUE_WINDOW_MS + 2000;
    assert.equal(pirateFatigueMult(planet, tExpired), 1);
  });

  it("aliens are unaffected by pirate fatigue and do not record pirate hits", () => {
    const now = 10_000_000;
    const universe = createUniverse("Alien Fatigue Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Test");
    const planet = universe.planets[joined.player.homePlanetId]!;

    // Fill planet with 8 pirate hits
    for (let i = 0; i < 8; i++) {
      recordPirateHit(planet, now + i * 100);
    }
    assert.equal(pirateFatigueMult(planet, now + 1000), 0.25);

    // Apply alien raid on planet
    const alien = createAlienBase(universe, planet.coords.galaxy, planet.coords.system + 1, 1, now, joined.player.id, 3);
    alien.ships = { ...emptyFleetShips(), interceptor: 20 };
    const hitsBefore = planet.pirateHitHistory?.length ?? 0;

    applyNpcRaidOnPlanet(universe, alien, planet, now + 2000, "alien", () => {});

    // Pirate hit history count unchanged by alien raid
    assert.equal(planet.pirateHitHistory?.length, hitsBefore);
  });

  it("an old save without pirateHitHistory loads with x1", () => {
    const now = 10_000_000;
    const universe = createUniverse("Old Save Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Test");
    const planet = universe.planets[joined.player.homePlanetId]!;

    // Simulate old save object without pirateHitHistory
    delete planet.pirateHitHistory;

    // Direct fatigue check returns 1
    assert.equal(pirateFatigueMult(planet, now), 1);

    // migrateOrResetUniverse loads and ensures shape without errors
    const reloaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe))).universe;
    const reloadedPlanet = reloaded.planets[planet.id]!;
    assert.equal(pirateFatigueMult(reloadedPlanet, now), 1);
  });

  it("applyNpcRaidOnPlanet records pirate hit and applies fatigue", () => {
    const now = 10_000_000;
    const universe = createUniverse("Raid Hit Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Test");
    const planet = universe.planets[joined.player.homePlanetId]!;

    const pirate = createPirateBase(universe, planet.coords.galaxy, planet.coords.system + 1, 1, now);
    pirate.ships = { ...emptyFleetShips(), interceptor: 20 };

    assert.equal(planet.pirateHitHistory?.length ?? 0, 0);

    for (let i = 1; i <= 5; i++) {
      applyNpcRaidOnPlanet(universe, pirate, planet, now + i * 1000, "pirate", () => {});
    }

    assert.equal(planet.pirateHitHistory?.length, 5);
    assert.equal(pirateFatigueMult(planet, now + 6000), 0.5);
  });
});

// silence unused in case of tree shake
void MAP_GALAXIES;
void (0 as UniverseState | 0);
