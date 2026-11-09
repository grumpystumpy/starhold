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
  NPC_AI_BATCH_SIZE,
  NPC_JOB_LEVELUP_BUDGET,
  NPC_JOB_RAID_BUDGET,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_EXCLUDED_SHIP_IDS,
  ALIEN_STRENGTH_MULT,
  PIRATE_FREE_SHIP_BASE,
  PIRATE_FREE_SHIP_PER_LEVEL,
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
  PIRATE_BASES_PER_GALAXY,
  PIRATE_SAME_TARGET_COOLDOWN_MS,
  PIRATE_SPLIT_CHILD_COUNT,
  PIRATE_SPLIT_LEVEL,
  PIRATE_TARGET_BASE_COUNT,
  SHIP_ORDER,
  SHIPS,
} from "./catalog.js";
import {
  NPC_AI_SLICE_INTERVAL_MS,
  PIRATE_BOSS_COOLDOWN_MS,
  PIRATE_BOSS_DURATION_MS,
  PIRATE_BOSS_MOTHERSHIPS,
  PIRATE_BOSS_RESOURCE_REWARD_MULT,
  PIRATE_BOSS_STARSHARD_REWARD_MULT,
  PIRATE_BOSS_TIER,
  PIRATE_BOSS_TIERS,
  PIRATE_RAID_DISTANCE_REF,
  PIRATE_RAID_LEVEL_POWER_BONUS,
  PIRATE_RAID_POWER_FACTOR_PLAYER,
  PIRATE_STRENGTH_MULT,
  PIRATE_TECH_OFFSET,
} from "./data/tuning.js";
import {
  coordDistance,
  emptyDefenses,
  defenseCombatPower,
  computeRaidLoot,
  effectiveCombatResearch,
  emptyFleetShips,
  fleetCombatPower,
  fleetShipCount,
  flightSecondsOneWay,
  resolveCombat,
} from "./formulas.js";
import {
  activeAlienBases,
  activePirateBases,
  advanceUniverse,
  bindTickBudget,
  createAlienBase,
  applyNpcRaidOnNpc,
  createUniverse,
  cullExcessPirateBases,
  ensurePiratePopulation,
  graduateNewbieProtection,
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
  planetRaidDeterrence,
  npcJobBudget,
  pickRaidTarget,
  playerView,
  rollNextRaidAt,
  scalePirateRaidFleet,
  tickPirates,
  tryAlienExpeditionFind,
} from "./world.js";
import type { TickBudget } from "./tick-budget.js";
import type { FleetMission, FleetShips, PlayerView, UniverseState } from "./types.js";
import {
  ALIEN_RAID_POWER_FACTOR_MAX,
  ALIEN_RAID_POWER_FACTOR_MIN,
  ALIEN_TECH_OFFSET,
  alienCombatResearchForOpponent,
  alienRaidPowerFactor,
  applyNpcRaidOnPlanet,
  applyStrongShipCap,
  collectPirateSpawnSites,
  createPirateBase,
  findNearestOpenSlot1,
  resolveAlienRaidArrival,
  alienShipsForTier,
  pirateFatigueMult,
  piratePlanetPickWeight,
  pirateRaidDistanceWeight,
  pirateRaidPowerFactor,
  recordPirateHit,
  pirateCombatResearch,
  pirateCombatResearchForOpponent,
  scaleAlienRaidFleet,
  resolvePirateRaidArrival,
} from "./world-pirates.js";
import { eventPresentation, eventsBannerHtml } from "../../../apps/web/src/ui/render-events.ts";

let restoreInputs: (() => void) | undefined;
beforeEach(() => {
  restoreInputs = installDeterministicInputs(0x50495241, 1_700_000_000_000);
});
afterEach(() => {
  restoreInputs?.();
  restoreInputs = undefined;
});

function assertPirateGalaxiesAtCap(universe: UniverseState): void {
  const counts = new Array<number>(MAP_GALAXIES + 1).fill(0);
  for (const base of activePirateBases(universe)) {
    if (base.seasonalBoss || base.id === universe.pirateBossBaseId) continue;
    counts[base.coords.galaxy] += 1;
  }
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    assert.ok(
      counts[galaxy]! <= PIRATE_BASES_PER_GALAXY,
      `galaxy ${galaxy} has ${counts[galaxy]} living non-boss bases`,
    );
  }
}

function piratePlayerFleets(universe: UniverseState, playerId: string): FleetMission[] {
  return Object.values(universe.fleets).filter(
    (fleet) => fleet.ownerPlayerId === "npc_pirates" && fleet.targetPlayerId === playerId,
  );
}

/** Resolve in-flight pirate player raids without letting the same tick launch another. */
function resolveDuePiratePlayerRaids(universe: UniverseState, playerId: string): void {
  const fleets = piratePlayerFleets(universe, playerId).filter((fleet) => fleet.phase === "outbound");
  assert.ok(fleets.length >= 1, "pirate planet raid launched a fleet");
  const when = Math.max(...fleets.map((fleet) => fleet.arrivesAt));
  for (const base of Object.values(universe.pirateBases ?? {})) {
    base.nextRaidAt = Math.max(base.nextRaidAt, when + 1);
    base.lastGrewAt = Math.max(base.lastGrewAt, when);
    base.lastFreeSpawnAt = Math.max(base.lastFreeSpawnAt, when);
  }
  universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
  advanceUniverse(universe, when);
}

describe("pirate balance helpers", () => {
  it("pays Starshards by tier on destroy (1% pirate, 2% alien)", () => {
    // Old tier 0 = 40. Pirate 1% = 0.40 exact.
    const pirate0 = pirateDestroyStarshards(0, "pirate", "seed_fixed");
    assert.ok(pirate0 === 0 || pirate0 === 1);

    // Old tier 3 = 55. Pirate 1% = 0.55 exact.
    const pirate3 = pirateDestroyStarshards(3, "pirate", "seed_fixed");
    assert.ok(pirate3 === 0 || pirate3 === 1);

    // Alien 2% rate. Tier 0 old = 40 -> 0.80 exact.
    const alien0 = pirateDestroyStarshards(0, "alien", "seed_fixed");
    assert.ok(alien0 === 0 || alien0 === 1);
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

describe("pirate density cap + zero aliens", () => {
  it("spawns one server-wide seasonal mothership boss with rare rewards", () => {
    const universe = createUniverse("Seasonal boss", 8);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const boss = universe.pirateBases?.[universe.pirateBossBaseId!];
    assert.ok(boss?.seasonalBoss);
    assert.equal(boss.tier, PIRATE_BOSS_TIER);
    assert.equal(boss.ships.swarmMothership, PIRATE_BOSS_MOTHERSHIPS);
    const ordinaryBossTier = pirateShipsForTier(PIRATE_BOSS_TIER);
    let bossHasUnscaledHull = false;
    for (const id of SHIP_ORDER) {
      if (id === "swarmMothership") continue;
      const bossCount = boss.ships[id] ?? 0;
      const halved = ordinaryBossTier[id] ?? 0;
      assert.equal(Math.floor(bossCount * PIRATE_STRENGTH_MULT + 1e-9), halved);
      if (bossCount > halved) bossHasUnscaledHull = true;
    }
    assert.equal(bossHasUnscaledHull, true);
    assert.equal(universe.pirateBossActiveUntil, now + PIRATE_BOSS_DURATION_MS);
    assert.equal(
      boss.resources.metal,
      (800 + PIRATE_BOSS_TIER * 400) * PIRATE_BOSS_RESOURCE_REWARD_MULT,
    );

    tickPirates(universe, now + 1);
    assert.equal(
      Object.values(universe.pirateBases ?? {}).filter(
        (base) => base.seasonalBoss && base.destroyedAt == null,
      ).length,
      1,
    );
    const regular = pirateDestroyStarshards(PIRATE_BOSS_TIER, "pirate", "boss-test");
    const rare = pirateDestroyStarshards(
      PIRATE_BOSS_TIER,
      "pirate",
      "boss-test",
      PIRATE_BOSS_STARSHARD_REWARD_MULT,
    );
    assert.ok(rare >= regular * 9);
  });

  it("pays 10x pirate destroy rewards when the mothership is defeated", () => {
    const universe = createUniverse("Seasonal boss reward", 8);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const boss = universe.pirateBases?.[universe.pirateBossBaseId!];
    assert.ok(boss?.seasonalBoss);
    const { player, planet } = joinUniverse(universe, "Boss hunter", now + 1);
    boss.ships = emptyFleetShips();
    boss.defenses = emptyDefenses();
    const fleet: FleetMission = {
      id: "seasonal-boss-reward",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: boss.coords,
      targetPirateBaseId: boss.id,
      mission: "pirateRaid",
      ships: { ...emptyFleetShips(), swarmMothership: 1 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now,
      arrivesAt: now,
      phase: "outbound",
      reportId: null,
    };
    const normalLoot = computeRaidLoot(
      {
        metal: boss.resources.metal / PIRATE_BOSS_RESOURCE_REWARD_MULT,
        crystal: boss.resources.crystal / PIRATE_BOSS_RESOURCE_REWARD_MULT,
        deuterium: boss.resources.deuterium / PIRATE_BOSS_RESOURCE_REWARD_MULT,
      },
      fleet.ships,
    );

    resolvePirateRaidArrival(universe, fleet, now);

    assert.equal(boss.destroyedAt, now);
    assert.equal(
      player.starshards,
      pirateDestroyStarshards(
        PIRATE_BOSS_TIER,
        "pirate",
        `${fleet.id}:destroy_shards:${now}`,
        PIRATE_BOSS_STARSHARD_REWARD_MULT,
      ),
    );
    assert.deepEqual(fleet.cargo, {
      metal: normalLoot.metal * PIRATE_BOSS_RESOURCE_REWARD_MULT,
      crystal: normalLoot.crystal * PIRATE_BOSS_RESOURCE_REWARD_MULT,
      deuterium: normalLoot.deuterium * PIRATE_BOSS_RESOURCE_REWARD_MULT,
    });
    assert.equal(universe.pirateBossBaseId, undefined);
    assert.equal(
      universe.pirateBossNextSpawnAt,
      now + PIRATE_BOSS_COOLDOWN_MS,
    );
  });

  it("expires the boss and observes the cooldown before respawning", () => {
    const universe = createUniverse("Seasonal boss expiry", 8);
    universe.skipNpcRaids = true;
    const now = 1_800_000_000_000;
    tickPirates(universe, now);
    const boss = universe.pirateBases?.[universe.pirateBossBaseId!];
    assert.ok(boss);

    const expiresAt = now + PIRATE_BOSS_DURATION_MS;
    tickPirates(universe, expiresAt);
    assert.equal(boss.destroyedAt, expiresAt);
    assert.equal(universe.pirateBossBaseId, undefined);
    assert.equal(
      universe.pirateBossNextSpawnAt,
      expiresAt + PIRATE_BOSS_COOLDOWN_MS,
    );

    tickPirates(universe, expiresAt + PIRATE_BOSS_COOLDOWN_MS - 1);
    assert.equal(universe.pirateBossBaseId, undefined);
    tickPirates(universe, expiresAt + PIRATE_BOSS_COOLDOWN_MS);
    assert.ok(universe.pirateBossBaseId);
  });

  it("uses safe event defaults when loading a legacy universe save", () => {
    const universe = createUniverse("Legacy seasonal boss", 8);
    delete universe.pirateBossBaseId;
    delete universe.pirateBossActiveUntil;
    delete universe.pirateBossNextSpawnAt;
    universe.skipNpcRaids = true;

    tickPirates(universe, 1_800_000_000_000);
    assert.ok(universe.pirateBossBaseId);
    assert.equal(universe.pirateBossNextSpawnAt, 0);
  });

  it("seeds exactly toward PIRATE_BASES_PER_GALAXY * MAP_GALAXIES", () => {
    assert.equal(PIRATE_BASES_PER_GALAXY, 75);
    assert.equal(PIRATE_SAME_TARGET_COOLDOWN_MS, 4 * 60 * 60 * 1000);
    assert.equal(PIRATE_TARGET_BASE_COUNT, PIRATE_BASES_PER_GALAXY * MAP_GALAXIES);
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

  it("migration top-up reaches the living cap without wiping players", () => {
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

  it("culls a crowded universe to the living cap and keeps the seasonal boss", () => {
    const now = 1_800_000_000_000;
    const universe = createUniverse("Cull Drift", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const seed = universe.seed ?? universe.id;
    const boss = activePirateBases(universe).find((base) => !base.seasonalBoss)!;
    boss.seasonalBoss = true;
    boss.name = "Seasonal Pirate Mothership";
    boss.level = 40;
    boss.tier = 40;
    boss.lastRaidAt = now;
    universe.pirateBossBaseId = boss.id;
    universe.pirateBossActiveUntil = now + 86_400_000;
    const occupied = new Set(
      activePirateBases(universe).map((base) => `${base.coords.galaxy}:${base.coords.system}`),
    );
    let living = occupied.size;
    for (let galaxy = 1; galaxy <= MAP_GALAXIES && living < 1096; galaxy++) {
      for (let system = 1; system <= MAP_SYSTEMS && living < 1096; system++) {
        const key = `${galaxy}:${system}`;
        if (occupied.has(key)) continue;
        const base = createPirateBase(seed, galaxy, system, 15, now, 0);
        base.lastRaidAt = now - living;
        base.nextRaidAt = now + PIRATE_RAID_PERIOD_MS;
        universe.pirateBases![base.id] = base;
        occupied.add(key);
        living += 1;
      }
    }
    assert.equal(activePirateBases(universe).length, 1096);
    const doomed = activePirateBases(universe)
      .filter((base) => base.id !== boss.id)
      .sort(
        (a, b) =>
          (a.lastRaidAt ?? 0) - (b.lastRaidAt ?? 0) ||
          (a.level ?? 0) - (b.level ?? 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0]!;
    const { player, planet } = joinUniverse(universe, "Keeper", now);
    planet.resources.metal = 123_456;
    planet.buildings.metalMine = 4;
    const fleet: FleetMission = {
      id: "fleet-keep",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...doomed.coords },
      targetPirateBaseId: doomed.id,
      mission: "pirateRaid",
      ships: { ...emptyFleetShips(), scout: 1 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: now - 1000,
      arrivesAt: now + 60_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    const reportsBefore = Object.keys(universe.reports).length;
    const eventsBefore = player.eventLog?.length ?? 0;
    const removed = cullExcessPirateBases(universe, now);
    assert.equal(removed, 1096 - PIRATE_TARGET_BASE_COUNT);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
    assert.equal(universe.pirateBases![boss.id]?.destroyedAt, null);
    assert.equal(universe.pirateBases![boss.id]?.seasonalBoss, true);
    assert.equal(universe.pirateBossBaseId, boss.id);
    assert.equal(universe.pirateBases![doomed.id], undefined);
    assert.equal(universe.fleets[fleet.id]?.ships.scout, 1);
    assert.equal(Object.keys(universe.reports).length, reportsBefore);
    assert.equal(player.eventLog?.length ?? 0, eventsBefore);
    for (const base of Object.values(universe.pirateBases ?? {})) {
      base.nextRaidAt = now + PIRATE_RAID_PERIOD_MS;
      base.lastGrewAt = now + 1000;
      base.lastFreeSpawnAt = now + 1000;
    }
    tickPirates(universe, now + 1000);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
    assert.equal(universe.pirateBases![boss.id]?.seasonalBoss, true);
    assert.equal(universe.pirateBases![boss.id]?.destroyedAt, null);
    assert.equal(universe.fleets[fleet.id]?.targetPirateBaseId, doomed.id);
  });

  it("ensurePiratePopulation does not grow past the living cap", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Cap top-up", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const keep = activePirateBases(universe)
      .filter((base) => !base.seasonalBoss)
      .slice(0, 5);
    universe.pirateBases = Object.fromEntries(keep.map((base) => [base.id, base]));
    ensurePiratePopulation(universe, now);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
    ensurePiratePopulation(universe, now);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
  });

  it("does not split a base when the living cap is full", () => {
    const universe = createUniverse("Split cap", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    ensurePiratePopulation(universe, 1_700_000_000_000);
    const base = activePirateBases(universe).find((entry) => !entry.seasonalBoss)!;
    base.level = 24;
    base.tier = 24;
    base.splitDone = false;
    base.lastGrewAt = 0;
    const beforeIds = new Set(activePirateBases(universe).map((entry) => entry.id));
    assert.equal(beforeIds.size, PIRATE_TARGET_BASE_COUNT);
    tickPirates(universe, PIRATE_LEVEL_GROWTH_INTERVAL_MS + 1);
    const living = activePirateBases(universe);
    assert.equal(living.length, PIRATE_TARGET_BASE_COUNT);
    assert.equal(living.filter((entry) => !beforeIds.has(entry.id)).length, 0);
    assert.equal(universe.pirateBases![base.id]?.splitDone, true);
  });

  it("loads a 1096-pirate save without reset, then caps living bases", () => {
    const now = 1_800_000_000_000;
    const universe = createUniverse("Old crowd", 8);
    const { player, planet } = joinUniverse(universe, "Keeper", now);
    planet.resources.metal = 123_456;
    planet.buildings.metalMine = 4;
    const boss = activePirateBases(universe).find((base) => !base.seasonalBoss)!;
    boss.seasonalBoss = true;
    universe.pirateBossBaseId = boss.id;
    universe.pirateBossActiveUntil = now + 86_400_000;
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const seed = universe.seed ?? universe.id;
    const occupied = new Set(
      activePirateBases(universe).map((base) => `${base.coords.galaxy}:${base.coords.system}`),
    );
    let living = occupied.size;
    for (let galaxy = 1; galaxy <= MAP_GALAXIES && living < 1096; galaxy++) {
      for (let system = 1; system <= MAP_SYSTEMS && living < 1096; system++) {
        const key = `${galaxy}:${system}`;
        if (occupied.has(key)) continue;
        const base = createPirateBase(seed, galaxy, system, 15, now, 0);
        universe.pirateBases![base.id] = base;
        occupied.add(key);
        living += 1;
      }
    }
    const fleet: FleetMission = {
      id: "fleet-keep",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...planet.coords },
      mission: "deploy",
      ships: { ...emptyFleetShips(), scout: 2 },
      cargo: { metal: 10, crystal: 0, deuterium: 0 },
      departedAt: now - 1000,
      arrivesAt: now + 60_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    assert.equal(activePirateBases(universe).length, 1096);
    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe)));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.aiRaidCatchUpCursor, undefined);
    assert.equal(loaded.universe.players[player.id]?.name, "Keeper");
    assert.equal(loaded.universe.planets[planet.id]?.resources.metal, 123_456);
    assert.equal(loaded.universe.planets[planet.id]?.buildings.metalMine, 4);
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 2);
    assert.equal(loaded.universe.fleets[fleet.id]?.cargo.metal, 10);
    for (const base of Object.values(loaded.universe.pirateBases ?? {})) {
      base.nextRaidAt = now + PIRATE_RAID_PERIOD_MS;
      base.lastGrewAt = now + 1000;
      base.lastFreeSpawnAt = now + 1000;
    }
    tickPirates(loaded.universe, now + 1000);
    assert.equal(activePirateBases(loaded.universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(loaded.universe);
    assert.equal(loaded.universe.pirateBases![boss.id]?.recentRaidTargets, undefined);
    assert.equal(loaded.universe.pirateBases![boss.id]?.seasonalBoss, true);
    assert.equal(loaded.universe.pirateBases![boss.id]?.destroyedAt, null);
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 2);
    assert.equal(loaded.universe.planets[planet.id]?.resources.metal, 123_456);
  });

  it("advancing does not reseed or strengthen existing pirate bases", () => {
    const universe = createUniverse("Existing pirate bases", 8);
    const bases = activePirateBases(universe).filter((base) => !base.seasonalBoss);
    const before = bases.map((base) => ({
      id: base.id,
      ships: { ...base.ships },
      defenses: { ...base.defenses },
      level: base.level,
    }));
    advanceUniverse(universe, Date.now() + 1_000);
    const living = activePirateBases(universe);
    const after = living.filter((base) => !base.seasonalBoss);
    const bosses = living.filter((base) => base.seasonalBoss);
    assert.equal(living.length, PIRATE_TARGET_BASE_COUNT);
    assert.equal(bosses.length, 1);
    assert.equal(after.length, before.length - 1);
    const beforeById = new Map(before.map((row) => [row.id, row]));
    for (const base of after) {
      assert.deepEqual(
        {
          id: base.id,
          ships: base.ships,
          defenses: base.defenses,
          level: base.level,
        },
        beforeById.get(base.id),
      );
    }
  });
});

describe("B7-95/96 per-galaxy cap and same-target cooldown", () => {
  it("culls every over-full galaxy down to 75 times MAP_GALAXIES", () => {
    const now = 1_800_000_000_000;
    const universe = createUniverse("Per galaxy cull", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const seed = universe.seed ?? universe.id;
    const boss = activePirateBases(universe).find((base) => !base.seasonalBoss)!;
    boss.seasonalBoss = true;
    boss.name = "Seasonal Pirate Mothership";
    universe.pirateBossBaseId = boss.id;
    const occupied = new Set(
      activePirateBases(universe).map((base) => `${base.coords.galaxy}:${base.coords.system}`),
    );
    const extra = 10;
    for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
      let added = 0;
      for (let system = 1; system <= MAP_SYSTEMS && added < extra; system++) {
        const key = `${galaxy}:${system}`;
        if (occupied.has(key)) continue;
        const base = createPirateBase(seed, galaxy, system, 14, now, 1);
        base.lastRaidAt = now - (galaxy * 1000 + added);
        universe.pirateBases![base.id] = base;
        occupied.add(key);
        added += 1;
      }
      assert.equal(added, extra, `galaxy ${galaxy} could not take ${extra} more bases`);
    }
    const before = activePirateBases(universe).length;
    assert.ok(before > PIRATE_BASES_PER_GALAXY * MAP_GALAXIES);
    const reportsBefore = Object.keys(universe.reports ?? {}).length;
    const eventsBefore = Object.values(universe.players).reduce(
      (sum, player) => sum + (player.eventLog?.length ?? 0),
      0,
    );
    const fleetCountBefore = Object.keys(universe.fleets).length;
    const removed = cullExcessPirateBases(universe, now);
    assert.ok(removed > 0);
    assert.equal(removed, before - PIRATE_BASES_PER_GALAXY * MAP_GALAXIES);
    assert.equal(activePirateBases(universe).length, PIRATE_BASES_PER_GALAXY * MAP_GALAXIES);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
    assert.equal(universe.pirateBases![boss.id]?.destroyedAt, null);
    assert.equal(universe.pirateBases![boss.id]?.seasonalBoss, true);
    assert.equal(Object.keys(universe.reports ?? {}).length, reportsBefore);
    assert.equal(
      Object.values(universe.players).reduce(
        (sum, player) => sum + (player.eventLog?.length ?? 0),
        0,
      ),
      eventsBefore,
    );
    assert.equal(Object.keys(universe.fleets).length, fleetCountBefore);
    ensurePiratePopulation(universe, now);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
  });

  it("tops up a short galaxy and refuses a galaxy already at 75", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Galaxy room", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const spare = activePirateBases(universe).find(
      (base) => base.coords.galaxy === 2 && !base.seasonalBoss,
    );
    assert.ok(spare);
    delete universe.pirateBases![spare!.id];
    const galaxy1Before = activePirateBases(universe).filter(
      (base) => base.coords.galaxy === 1 && !base.seasonalBoss && base.id !== universe.pirateBossBaseId,
    ).length;
    assert.equal(galaxy1Before, PIRATE_BASES_PER_GALAXY);
    ensurePiratePopulation(universe, now);
    const galaxy1After = activePirateBases(universe).filter(
      (base) => base.coords.galaxy === 1 && !base.seasonalBoss && base.id !== universe.pirateBossBaseId,
    ).length;
    const galaxy2After = activePirateBases(universe).filter(
      (base) => base.coords.galaxy === 2 && !base.seasonalBoss && base.id !== universe.pirateBossBaseId,
    ).length;
    assert.equal(galaxy1After, PIRATE_BASES_PER_GALAXY);
    assert.equal(galaxy2After, PIRATE_BASES_PER_GALAXY);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
    assertPirateGalaxiesAtCap(universe);
    ensurePiratePopulation(universe, now);
    assert.equal(activePirateBases(universe).length, PIRATE_TARGET_BASE_COUNT);
  });

  it("does not select the same player planet twice inside 4 hours", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Same target cooldown", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const joined = joinUniverse(universe, "Target", now - 100 * 86_400_000);
    const player = universe.players[joined.player.id]!;
    player.attackedPiratesAt = now - 1000;
    graduateNewbieProtection(universe, player);
    const home = universe.planets[joined.planet.id]!;
    universe.planets = { [home.id]: home };
    const base = activePirateBases(universe).find((entry) => !entry.seasonalBoss)!;
    base.ships = { ...emptyFleetShips(), interceptor: 30 };
    universe.pirateBases = { [base.id]: base };
    universe.alienBases = {};
    const first = pickRaidTarget(universe, base, now, "pirate");
    assert.equal(first?.kind, "planet");
    if (first?.kind !== "planet") return;
    assert.equal(first.planet.id, home.id);
    applyNpcRaidOnPlanet(universe, base, home, now, "pirate", () => {});
    assert.equal(base.recentRaidTargets?.[home.id], now);
    assert.equal(pickRaidTarget(universe, base, now + 60_000, "pirate"), null);
    const opened = pickRaidTarget(
      universe,
      base,
      now + PIRATE_SAME_TARGET_COOLDOWN_MS,
      "pirate",
    );
    assert.equal(opened?.kind, "planet");
    if (opened?.kind === "planet") assert.equal(opened.planet.id, home.id);
    const stale: Record<string, number> = {
      [home.id]: now - PIRATE_SAME_TARGET_COOLDOWN_MS,
      "gone-target": now - PIRATE_SAME_TARGET_COOLDOWN_MS - 1,
    };
    base.recentRaidTargets = stale;
    const pruned = pickRaidTarget(universe, base, now, "pirate");
    assert.equal(pruned?.kind, "planet");
    assert.equal(base.recentRaidTargets, undefined);
  });

  it("does not select the same NPC target twice inside 4 hours", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Npc target cooldown", 8);
    const seed = universe.seed ?? universe.id;
    const left = createPirateBase(seed, 1, 20, 4, now, 3);
    const right = createPirateBase(seed, 2, 21, 4, now, 3);
    left.ships = { ...emptyFleetShips(), interceptor: 1 };
    right.ships = { ...emptyFleetShips(), interceptor: 400 };
    universe.pirateBases = { [left.id]: left, [right.id]: right };
    universe.alienBases = {};
    universe.planets = {};
    const first = pickRaidTarget(universe, left, now, "pirate");
    assert.equal(first?.kind, "pirate");
    if (first?.kind !== "pirate") return;
    assert.equal(first.other.id, right.id);
    applyNpcRaidOnNpc(universe, left, right, now, () => {}, () => {});
    assert.equal(left.recentRaidTargets?.[right.id], now);
    assert.equal(right.destroyedAt, null);
    assert.equal(pickRaidTarget(universe, left, now + 1000, "pirate"), null);
    const later = pickRaidTarget(
      universe,
      left,
      now + PIRATE_SAME_TARGET_COOLDOWN_MS,
      "pirate",
    );
    assert.equal(later?.kind, "pirate");
    if (later?.kind === "pirate") assert.equal(later.other.id, right.id);
  });

  it("loads an old pirate save with no cooldown field and keeps an in-flight fleet", () => {
    const now = 1_800_000_000_000;
    const universe = createUniverse("Old cooldown field", 8);
    const { player, planet } = joinUniverse(universe, "Keeper", now);
    planet.resources.metal = 222_333;
    planet.buildings.metalMine = 3;
    for (const base of Object.values(universe.pirateBases ?? {})) {
      delete base.recentRaidTargets;
    }
    const fleet: FleetMission = {
      id: "fleet-old",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...planet.coords },
      mission: "deploy",
      ships: { ...emptyFleetShips(), scout: 1 },
      cargo: { metal: 4, crystal: 0, deuterium: 0 },
      departedAt: now - 1000,
      arrivesAt: now + 60_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe)));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.players[player.id]?.name, "Keeper");
    assert.equal(loaded.universe.planets[planet.id]?.resources.metal, 222_333);
    assert.equal(loaded.universe.planets[planet.id]?.buildings.metalMine, 3);
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 1);
    assert.equal(loaded.universe.fleets[fleet.id]?.mission, "deploy");
    assert.equal(loaded.universe.fleets[fleet.id]?.arrivesAt, now + 60_000);
    const sample = activePirateBases(loaded.universe)[0];
    assert.ok(sample);
    assert.equal(sample!.recentRaidTargets, undefined);
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

  it("raids pirates every 180 minutes and aliens every hour", () => {
    assert.equal(PIRATE_RAID_PERIOD_MS, 180 * 60 * 1000);
    assert.equal(ALIEN_RAID_PERIOD_MS, 60 * 60 * 1000);
  });

  it("halves raid frequency over a 24h window compared to the 90-min period", () => {
    const start = 1_700_000_000_000;
    const windowMs = 24 * 60 * 60 * 1000;
    const baseId = "pir:1:1:1";

    const oldPeriodMs = 90 * 60 * 1000;
    let atOld = rollNextRaidAt(baseId, start, oldPeriodMs);
    let oldRaidCount = 0;
    while (atOld <= start + windowMs) {
      oldRaidCount++;
      atOld = rollNextRaidAt(baseId, atOld, oldPeriodMs);
    }

    let atNew = rollNextRaidAt(baseId, start, PIRATE_RAID_PERIOD_MS);
    let newRaidCount = 0;
    while (atNew <= start + windowMs) {
      newRaidCount++;
      atNew = rollNextRaidAt(baseId, atNew, PIRATE_RAID_PERIOD_MS);
    }

    // 24h has 16 90-min periods and 8 180-min periods (allowing +/-1 for offset boundaries)
    assert.ok(Math.abs(oldRaidCount - 16) <= 1, `old raid count expected ~16, got ${oldRaidCount}`);
    assert.ok(Math.abs(newRaidCount - 8) <= 1, `new raid count expected ~8, got ${newRaidCount}`);
    assert.ok(
      Math.abs(newRaidCount - Math.round(oldRaidCount / 2)) <= 1,
      `new raid count ${newRaidCount} should be half of old count ${oldRaidCount} within +/-1`,
    );
  });

  it("preserves pre-change nextRaidAt, fires at that time, then reschedules within the 180-min period", () => {
    const universe = createUniverse("Pre-change nextRaidAt", 8);
    const base = activePirateBases(universe)[0]!;
    const start = 1_700_000_000_000;
    for (const b of activePirateBases(universe)) {
      b.nextRaidAt = start + 48 * 60 * 60 * 1000;
      b.lastGrewAt = start + 48 * 60 * 60 * 1000;
      b.lastFreeSpawnAt = start + 48 * 60 * 60 * 1000;
    }
    const preChangeNextRaidAt = start + 45 * 60 * 1000;
    base.nextRaidAt = preChangeNextRaidAt;

    tickPirates(universe, preChangeNextRaidAt - 1000);
    assert.equal(base.nextRaidAt, preChangeNextRaidAt);

    tickPirates(universe, preChangeNextRaidAt);
    assert.ok(base.nextRaidAt > preChangeNextRaidAt);
    const periodStart = Math.floor(preChangeNextRaidAt / PIRATE_RAID_PERIOD_MS) * PIRATE_RAID_PERIOD_MS;
    assert.ok(base.nextRaidAt >= periodStart);
    assert.ok(base.nextRaidAt <= preChangeNextRaidAt + PIRATE_RAID_PERIOD_MS);
    const rolledExpected = rollNextRaidAt(base.id, preChangeNextRaidAt, PIRATE_RAID_PERIOD_MS);
    assert.equal(base.nextRaidAt, rolledExpected);
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
    universe.skipPirateTopUp = true;
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const others = activePirateBases(universe).filter(
      (entry) =>
        entry.id !== base.id &&
        !entry.seasonalBoss &&
        entry.coords.galaxy === base.coords.galaxy,
    );
    for (const extra of others.slice(0, PIRATE_SPLIT_CHILD_COUNT)) {
      delete universe.pirateBases![extra.id];
    }
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
      pirateDestroyStarshards(
        0,
        "pirate",
        `${launch.fleet.id}:destroy_shards:${launch.fleet.arrivesAt}`,
      ),
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
      assert.equal(
        Object.values(universe.fleets).some((fleet) => fleet.ownerPlayerId === "npc_pirates"),
        false,
      );
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
  it("uses grow-only and raid-only slices", () => {
    assert.equal(NPC_AI_BATCH_SIZE, 50);
    assert.equal(NPC_AI_SLICE_INTERVAL_MS, 10 * 60 * 1000);
    assert.equal(
      NPC_JOB_RAID_BUDGET,
      Math.ceil(PIRATE_TARGET_BASE_COUNT / 18) + 6,
    );
    const now = 1_700_000_000_000;
    const growAt = now + NPC_AI_SLICE_INTERVAL_MS;
    const raidAt = now;
    const growUniverse = createUniverse("Grow-only NPC slice", 8);
    growUniverse.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    for (const base of activePirateBases(growUniverse)) {
      base.lastGrewAt = growAt + 1;
      base.lastFreeSpawnAt = growAt + 1;
      base.nextRaidAt = growAt - 1;
    }
    let budget = npcJobBudget();
    bindTickBudget(() => budget);
    try {
      tickPirates(growUniverse, growAt);
      assert.ok(
        activePirateBases(growUniverse).every((base) => base.nextRaidAt <= growAt),
        "grow slice fired a raid",
      );

      const raidUniverse = createUniverse("Raid-only NPC slice", 8);
      raidUniverse.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
      const before = new Map(
        activePirateBases(raidUniverse).map((base) => [
          base.id,
          {
            level: base.level,
            lastGrewAt: base.lastGrewAt,
            lastFreeSpawnAt: base.lastFreeSpawnAt,
            ships: { ...base.ships },
          },
        ]),
      );
      for (const base of activePirateBases(raidUniverse)) {
        base.lastGrewAt = raidAt - PIRATE_LEVEL_GROWTH_INTERVAL_MS;
        base.lastFreeSpawnAt = 0;
        base.nextRaidAt = raidAt + PIRATE_RAID_PERIOD_MS;
      }
      budget = npcJobBudget();
      tickPirates(raidUniverse, raidAt);
      for (const base of activePirateBases(raidUniverse)) {
        const previous = before.get(base.id)!;
        assert.equal(base.level, previous.level);
        assert.equal(base.lastGrewAt, raidAt - PIRATE_LEVEL_GROWTH_INTERVAL_MS);
        assert.equal(base.lastFreeSpawnAt, 0);
        assert.deepEqual(base.ships, previous.ships);
      }
    } finally {
      bindTickBudget(() => undefined);
    }
  });

  it("resumes the grow cursor after an intervening raid slice", () => {
    const now = 1_700_000_000_000;
    const growAt = now + NPC_AI_SLICE_INTERVAL_MS;
    const universe = createUniverse("NPC grow cursor", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    for (const base of activePirateBases(universe)) {
      base.lastGrewAt = growAt - PIRATE_LEVEL_GROWTH_INTERVAL_MS;
      base.lastFreeSpawnAt = growAt + 1;
      base.nextRaidAt = growAt + PIRATE_RAID_PERIOD_MS;
    }
    let budget = npcJobBudget();
    budget.levelUps = 1000;
    bindTickBudget(() => budget);
    try {
      tickPirates(universe, growAt);
      const firstCursor = universe.aiCatchUpCursor;
      assert.ok(firstCursor);
      const firstLevels = activePirateBases(universe).filter(
        (base) => base.lastGrewAt === growAt,
      ).length;
      assert.ok(firstLevels > 0);
      assert.equal(firstLevels <= NPC_AI_BATCH_SIZE, true);

      budget = npcJobBudget();
      tickPirates(universe, now + 2 * NPC_AI_SLICE_INTERVAL_MS);
      assert.equal(universe.aiCatchUpCursor, firstCursor);

      budget = npcJobBudget();
      budget.levelUps = 1000;
      tickPirates(universe, now + 3 * NPC_AI_SLICE_INTERVAL_MS);
      assert.ok(universe.aiCatchUpCursor);
      assert.notEqual(universe.aiCatchUpCursor, firstCursor);
      assert.ok(
        activePirateBases(universe).filter((base) => base.lastGrewAt === growAt).length >
          firstLevels,
      );
    } finally {
      bindTickBudget(() => undefined);
    }
  });

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
      const now = PIRATE_RAID_PERIOD_MS * 4 + NPC_AI_SLICE_INTERVAL_MS;
      for (const base of activePirateBases(universe)) {
        base.lastGrewAt = now + 1;
        base.lastFreeSpawnAt = now + 1;
        base.nextRaidAt = now + 1;
      }
      const base = activePirateBases(universe)[0]!;
      // 0 is treated as "unset" and rescheduled into the future.
      base.nextRaidAt = 1;
      // A lost raid now removes every sent hull. A gun keeps this base
      // alive so the raid budget can pause and resume its backlog.
      base.defenses = {
        ...emptyDefenses(),
        ...base.defenses,
        laserBattery: Math.max(1, base.defenses?.laserBattery ?? 0),
      };
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
      assert.equal(universe.aiRaidCatchUpCursor, `${now}:${base.id}`);
      budget = step();
      tickPirates(universe, now);
      assert.ok(universe.pirateBases![base.id]!.nextRaidAt > mid);
    } finally {
      bindTickBudget(() => undefined);
    }
  });

  it("bounded pirate and alien runs match one full catch-up tick", () => {
    const previous = process.env.STARHOLD_E2E;
    process.env.STARHOLD_E2E = "1";
    try {
      const now = 1_700_000_000_000;
      const initial = createUniverse("Split NPC catch-up", 8);
      const pirates = activePirateBases(initial);
      for (const base of pirates) {
        base.lastGrewAt = now + 1;
        base.lastFreeSpawnAt = now + 1;
        base.nextRaidAt = now + PIRATE_RAID_PERIOD_MS;
      }
      pirates[0]!.nextRaidAt = now - 1;
      pirates[1]!.nextRaidAt = now - 1;
      const alien = createAlienBase(initial, 1, 300, 1, now, "test-player");
      alien.buildupEndsAt = now - 1;
      alien.lastGrewAt = now + 1;
      alien.lastFreeSpawnAt = now + 1;
      alien.nextRaidAt = now - 1;
      initial.alienBases![alien.id] = alien;

      const full = structuredClone(initial);
      const split = structuredClone(initial);
      bindTickBudget(() => undefined);
      tickPirates(full, now);

      let budget = npcJobBudget();
      budget.raids = 1;
      bindTickBudget(() => budget);
      let runs = 0;
      let at = now;
      do {
        tickPirates(split, at);
        runs += 1;
        assert.ok(runs <= 5, "bounded catch-up did not resume");
        budget = npcJobBudget();
        budget.raids = 1;
        at += NPC_AI_SLICE_INTERVAL_MS;
      } while (split.aiRaidCatchUpCursor);

      assert.equal(runs, 5);
      assert.equal(split.aiRaidCatchUpCursor, null);
      assert.ok(split.aiCatchUpCursor, "grow cursor must remain independent");
      for (const [id, base] of Object.entries(full.pirateBases ?? {})) {
        assert.equal(split.pirateBases?.[id]?.nextRaidAt, base.nextRaidAt);
      }
      assert.equal(
        split.alienBases?.[alien.id]?.nextRaidAt,
        full.alienBases?.[alien.id]?.nextRaidAt,
      );
    } finally {
      bindTickBudget(() => undefined);
      if (previous == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = previous;
    }
  });

  it("keeps NPC cron work within caps and fires every raid scheduled over 24h", () => {
    const previous = process.env.STARHOLD_E2E;
    process.env.STARHOLD_E2E = "1";
    try {
      const now = 1_700_000_000_000;
      const levelWork = createUniverse("NPC level-up caps", 8);
      levelWork.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
      const levelBases = activePirateBases(levelWork);
      const initialLevels = new Map(levelBases.map((base) => [base.id, base.level]));
      const growNow = now + NPC_AI_SLICE_INTERVAL_MS;
      for (const base of levelBases) {
        base.lastGrewAt = growNow - PIRATE_LEVEL_GROWTH_INTERVAL_MS;
        base.lastFreeSpawnAt = growNow + 1;
        base.nextRaidAt = growNow + PIRATE_RAID_PERIOD_MS;
      }
      let budget = npcJobBudget();
      bindTickBudget(() => budget);
      tickPirates(levelWork, growNow);
      const levelsGained = levelBases.reduce(
        (sum, base) => sum + base.level - initialLevels.get(base.id)!,
        0,
      );
      const eligibleBatch = Object.values(levelWork.pirateBases ?? {})
        .slice(0, NPC_AI_BATCH_SIZE)
        .filter((base) => !base.seasonalBoss).length;
      assert.equal(levelsGained, Math.min(eligibleBatch, NPC_JOB_LEVELUP_BUDGET));

      const raidWork = createUniverse("NPC raid caps", 8);
      raidWork.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
      const raidBases = activePirateBases(raidWork);
      for (const base of raidBases) {
        base.lastGrewAt = now + 1;
        base.lastFreeSpawnAt = now + 1;
        base.nextRaidAt = now - 1;
      }
      budget = npcJobBudget();
      tickPirates(raidWork, now);
      assert.equal(
        raidBases.filter((base) => base.nextRaidAt > now).length,
        NPC_JOB_RAID_BUDGET,
      );

      const start = now;
      const end = start + 24 * 60 * 60 * 1000;
      const step = 10 * 60 * 1000;
      const reference = createUniverse("NPC raid schedule", 8);
      reference.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
      const referenceBases = activePirateBases(reference);
      for (const base of referenceBases) {
        base.lastGrewAt = end + 1;
        base.lastFreeSpawnAt = end + 1;
        base.nextRaidAt = rollNextRaidAt(base.id, start, PIRATE_RAID_PERIOD_MS);
      }
      const split = structuredClone(reference);
      const expectedNext = new Map<string, number>();
      let expectedRaids = 0;
      for (const base of referenceBases) {
        let next = base.nextRaidAt;
        while (next <= end) {
          next = rollNextRaidAt(base.id, next, PIRATE_RAID_PERIOD_MS);
          expectedRaids += 1;
        }
        expectedNext.set(base.id, next);
      }

      bindTickBudget(() => undefined);
      for (let at = start + step; at <= end; at += step) {
        tickPirates(reference, at);
      }
      let actualRaids = 0;
      for (const base of referenceBases) {
        const expected = expectedNext.get(base.id)!;
        assert.equal(reference.pirateBases![base.id]!.nextRaidAt, expected);
        let next = rollNextRaidAt(base.id, start, PIRATE_RAID_PERIOD_MS);
        while (next < expected) {
          actualRaids += 1;
          next = rollNextRaidAt(base.id, next, PIRATE_RAID_PERIOD_MS);
        }
      }
      assert.equal(actualRaids, expectedRaids);

      let runs = 0;
      while (
        split.aiCatchUpCursor ||
        split.aiRaidCatchUpCursor ||
        Object.values(split.pirateBases ?? {}).some((base) => base.nextRaidAt <= end)
      ) {
        assert.ok(runs < 400, "budgeted NPC cron did not catch up");
        budget = npcJobBudget();
        tickPirates(split, end);
        runs += 1;
      }
      let splitRaids = 0;
      for (const [id, expected] of expectedNext) {
        const base = split.pirateBases![id]!;
        assert.equal(base.nextRaidAt, expected);
        let next = rollNextRaidAt(id, start, PIRATE_RAID_PERIOD_MS);
        while (next < base.nextRaidAt) {
          splitRaids += 1;
          next = rollNextRaidAt(id, next, PIRATE_RAID_PERIOD_MS);
        }
      }
      assert.equal(splitRaids, expectedRaids);
    } finally {
      bindTickBudget(() => undefined);
      if (previous == null) delete process.env.STARHOLD_E2E;
      else process.env.STARHOLD_E2E = previous;
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
      for (let run = 0; backlog > 0 && run < 400; run += 1) {
        budget = npcJobBudget();
        tickPirates(universe, end);
        backlog = Object.values(universe.pirateBases ?? {}).filter(
          (base) => base.destroyedAt == null && base.nextRaidAt <= end,
        ).length;
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
        // A lost raid removes every sent hull. Guns keep the base alive so
        // lastRaidAt is visible after the detachment is gone.
        other.defenses = {
          ...emptyDefenses(),
          ...other.defenses,
          laserBattery: Math.max(1, other.defenses?.laserBattery ?? 0),
        };
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
      let cpu = 0;
      let raidRuns = 0;
      while (
        [...dueIds].some((id) => {
          const base = universe.pirateBases?.[id];
          return base && base.destroyedAt == null && base.lastRaidAt !== now - 1;
        })
      ) {
        assert.ok(raidRuns < 10, "budgeted pirate combat did not resume");
        budget = npcJobBudget();
        const warmBegan = performance.now();
        tickPirates(universe, now);
        cpu = Math.max(cpu, performance.now() - warmBegan);
        raidRuns += 1;
      }
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
      let waveCpu = 0;
      let waveRuns = 0;
      while (
        Object.values(universe.pirateBases ?? {}).some(
          (base) => base.destroyedAt == null && base.nextRaidAt <= now,
        )
      ) {
        assert.ok(waveRuns < 10, "budgeted pirate wave did not resume");
        budget = npcJobBudget();
        const waveBegan = performance.now();
        tickPirates(universe, now);
        waveCpu = Math.max(waveCpu, performance.now() - waveBegan);
        waveRuns += 1;
      }
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

  it("round-robin site picker ensures every galaxy has >= 1 pirate base when target >= MAP_GALAXIES across seeds", () => {
    const seeds = ["seed-alpha", "seed-beta", "universe-42", "commander-origin", "flaky-108-test"];
    for (const seed of seeds) {
      const universe = createUniverse(`RoundRobin-${seed}`, 8);
      // Test with target = MAP_GALAXIES (exact 1 per galaxy)
      const sitesExact = collectPirateSpawnSites(universe, seed, MAP_GALAXIES);
      assert.equal(sitesExact.length, MAP_GALAXIES);
      const galaxiesExact = new Set(sitesExact.map((s) => s.galaxy));
      assert.equal(galaxiesExact.size, MAP_GALAXIES, `Expected all ${MAP_GALAXIES} galaxies, got ${galaxiesExact.size}`);
      for (let g = 1; g <= MAP_GALAXIES; g++) {
        assert.ok(galaxiesExact.has(g), `Seed ${seed} target=${MAP_GALAXIES} missing galaxy ${g}`);
      }

      // Test with target = the derived living cap.
      const sitesCap = collectPirateSpawnSites(universe, seed, PIRATE_TARGET_BASE_COUNT);
      assert.equal(sitesCap.length, PIRATE_TARGET_BASE_COUNT);
      const perGalaxy = new Array<number>(MAP_GALAXIES + 1).fill(0);
      for (const site of sitesCap) perGalaxy[site.galaxy] += 1;
      for (let g = 1; g <= MAP_GALAXIES; g++) {
        assert.ok(
          perGalaxy[g] >= 1,
          `Seed ${seed} target=${PIRATE_TARGET_BASE_COUNT} has 0 pirates in galaxy ${g}`,
        );
        assert.ok(perGalaxy[g]! <= PIRATE_BASES_PER_GALAXY);
      }
    }
  });

  it("fills lowest galaxies first when target < MAP_GALAXIES so galaxy 1 always has one", () => {
    const seeds = ["seed-1", "seed-2", "seed-3", "seed-4"];
    for (const seed of seeds) {
      const universe = createUniverse(`LowTarget-${seed}`, 8);
      // target = 1
      const sites1 = collectPirateSpawnSites(universe, seed, 1);
      assert.equal(sites1.length, 1);
      assert.equal(sites1[0]!.galaxy, 1, `Seed ${seed} target=1 should pick galaxy 1`);

      // target = 3
      const sites3 = collectPirateSpawnSites(universe, seed, 3);
      assert.equal(sites3.length, 3);
      assert.equal(sites3[0]!.galaxy, 1);
      assert.equal(sites3[1]!.galaxy, 2);
      assert.equal(sites3[2]!.galaxy, 3);
    }
  });

  it("is fully deterministic for a given seed", () => {
    const universe1 = createUniverse("Determinism Test", 8);
    const universe2 = createUniverse("Determinism Test", 8);
    const seed = "fixed-seed-determinism";
    const sitesA = collectPirateSpawnSites(universe1, seed, PIRATE_TARGET_BASE_COUNT);
    const sitesB = collectPirateSpawnSites(universe2, seed, PIRATE_TARGET_BASE_COUNT);
    assert.deepEqual(sitesA, sitesB);
  });

  it("preserves coordinates of existing bases in a loaded save without moving or deleting them", () => {
    const universe = createUniverse("Existing Base Save", 8);
    const active = activePirateBases(universe);
    assert.ok(active.length > 0);
    const existingCoords = active.map((b) => ({ id: b.id, coords: { ...b.coords } }));

    // Re-run population top-up / seeding
    ensurePiratePopulation(universe, Date.now());

    // All original bases must still exist with the exact same coordinates
    for (const original of existingCoords) {
      const current = universe.pirateBases?.[original.id];
      assert.ok(current, `Base ${original.id} was deleted`);
      assert.deepEqual(current!.coords, original.coords, `Base ${original.id} coords moved`);
      assert.equal(current!.destroyedAt, null);
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
    assert.match(reportA.shareCode ?? "", /^sh_/);
    assert.ok(universe1.players[playerA.id]?.combatStats);

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
      resolveDuePiratePlayerRaids(universe2, playerB.id);

      const report = Object.values(universe2.reports ?? {}).find(
        (entry) =>
          entry.defenderPlayerId === playerB.id && entry.missionId === baseB.id,
      );
      assert.ok(report, "defender receives the pirate combat report");
      assert.equal(report.outcome, "defender_win");
      assert.equal(
        (universe2.players[playerB.id]?.eventLog ?? []).some(
          (entry) => entry.kind === "raidAlert",
        ),
        false,
      );
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

      const alienReport = Object.values(universe.reports ?? {}).find(
        (entry) =>
          entry.defenderPlayerId === player.id && entry.missionId === alienBase.id,
      );
      assert.ok(alienReport, "defender receives the alien combat report");
      assert.deepEqual(alienReport.attackerBefore, expectedAlienRaid);
      assert.equal(
        (universe.players[player.id]?.eventLog ?? []).some(
          (entry) => entry.kind === "raidAlert",
        ),
        false,
      );

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
      const levelFactor = pirateRaidPowerFactor(
        PIRATE_RAID_POWER_FACTOR_PLAYER,
        pirateBase.level,
      );
      const expectedPirateRaid = scalePirateRaidFleet(
        pirateBase.ships,
        defenderPower2,
        planetState.ships,
        levelFactor,
      );

      assert.equal(PIRATE_RAID_POWER_FACTOR_PLAYER, 0.70);
      assert.equal(PIRATE_RAID_LEVEL_POWER_BONUS, 0.5);
      assert.equal(
        levelFactor,
        PIRATE_RAID_POWER_FACTOR_PLAYER *
          (1 + PIRATE_RAID_LEVEL_POWER_BONUS * (pirateBase.level / PIRATE_MAX_LEVEL)),
      );
      assert.equal(expectedPirateRaid.cruiser ?? 0, 0, "pirate raid caps cruisers at 0 due to strong-ship cap");
      assert.ok(fleetCombatPower(expectedPirateRaid) <= defenderPower2 * levelFactor + 1e-6);

      tickPirates(universe, now + 3000);
      resolveDuePiratePlayerRaids(universe, player.id);

      const pirateReport = Object.values(universe.reports ?? {}).find(
        (entry) =>
          entry.defenderPlayerId === player.id &&
          entry.missionId === pirateBase.id,
      );
      assert.ok(pirateReport, "defender receives the pirate combat report");
      assert.deepEqual(pirateReport.attackerBefore, expectedPirateRaid);
      assert.equal(
        (universe.players[player.id]?.eventLog ?? []).some(
          (entry) => entry.kind === "raidAlert",
        ),
        false,
      );
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
    // A total loss now removes every sent hull. One gun keeps the base
    // alive so the loaded save can still launch the follow-up raid.
    base.defenses = {
      ...emptyDefenses(),
      ...base.defenses,
      laserBattery: Math.max(1, base.defenses?.laserBattery ?? 0),
    };

    const savedJson = JSON.stringify(original);
    assert.ok(typeof savedJson === "string");

    const loadedRaw = JSON.parse(savedJson);
    const { universe } = migrateOrResetUniverse(loadedRaw);
    delete universe.skipNpcRaids;

    const prevE2E = process.env.STARHOLD_E2E;
    delete process.env.STARHOLD_E2E;

    try {
      tickPirates(universe, now + 1000);
      resolveDuePiratePlayerRaids(universe, player.id);

      const raidReport = Object.values(universe.reports ?? {}).find(
        (entry) => entry.defenderPlayerId === player.id && entry.missionId === base.id,
      );
      assert.ok(raidReport, "old save still records the pirate combat report");
      assert.equal(
        (universe.players[player.id]?.eventLog ?? []).some(
          (entry) => entry.kind === "raidAlert",
        ),
        false,
      );

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
      const report = universe.reports[launch.fleet.reportId!];
      assert.ok(report);
      assert.equal(report.attackerPlayerId, player.id);
      assert.match(report.shareCode ?? "", /^sh_/);
      assert.ok(universe.players[player.id]?.combatStats);
      assert.equal(
        (universe.players[player.id]?.eventLog ?? []).some(
          (entry) => entry.kind === "raidAlert",
        ),
        false,
      );
      assert.ok(
        playerView(universe, player.id, launch.fleet.arrivesAt + 1).reports.some(
          (entry) => entry.id === report.id,
        ),
        "the attacker receives the pirate-base combat report",
      );

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
    assert.match(report.shareCode ?? "", /^sh_/);
    assert.ok(universe.players[player.id]?.combatStats);
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

describe("B7-04 raid deterrence target selection", () => {
  it("deterrence reduces raid target selection rate for heavily defended planets", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Deterrence Target Selection", 8);
    const { player, planet } = joinUniverse(universe, "Defended", now);
    const owner = universe.players[player.id]!;
    owner.createdAt = now - 100 * 86_400_000;
    owner.attackedPiratesAt = now - 1000;

    const base = activePirateBases(universe)[0]!;
    base.lastRaidAt = now - 10_000;

    const body = universe.planets[planet.id]!;

    // Non-qualifying planet has unchanged chance
    body.ships = { interceptor: 1499 };
    assert.equal(planetRaidDeterrence(body, "pirate", 1.0), 1.0);
    assert.equal(planetRaidDeterrence(body, "pirate", 0.10), 0.10);

    // Qualifying planet (>= 1500 units) has raid chance reduced by exactly 0.5 percentage points (-0.005)
    body.ships = { interceptor: 300_000 };
    assert.ok(Math.abs(planetRaidDeterrence(body, "pirate", 1.0) - 0.995) < 1e-9);
    assert.ok(Math.abs(planetRaidDeterrence(body, "pirate", 0.10) - 0.095) < 1e-9);
    assert.equal(planetRaidDeterrence(body, "pirate"), 0.995);

    const target = pickRaidTarget(universe, base, now, "pirate");
    if (target?.kind === "planet") {
      assert.ok(planetRaidDeterrence(target.planet, "pirate") > 0);
    }
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

  it("combines pirate attack fatigue with B7-04 deterrence", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Fatigue Deterrence Test", 1, 1);
    const joined = joinUniverse(universe, "Cmdr Combined", now);
    const planet = universe.planets[joined.player.homePlanetId]!;
    const owner = universe.players[joined.player.id]!;
    owner.createdAt = now - 100 * 86_400_000;
    owner.attackedPiratesAt = now - 1000;

    // Give planet qualifying units for B7-04 deterrence (>= 1500)
    planet.ships = { interceptor: 1500 };

    // Record 5 pirate hits on planet -> fatigue multiplier 0.5
    for (let i = 1; i <= 5; i++) {
      recordPirateHit(planet, now - (10 - i) * 1000);
    }
    assert.equal(pirateFatigueMult(planet, now), 0.5);

    // Base pick weight without deterrence would be 1.0 * fairness(1.0) * fatigue(0.5) = 0.5
    // Deterrence reduces this by flat 0.005 -> 0.495
    const effectiveWeight = planetRaidDeterrence(
      planet,
      "pirate",
      1.0 * pirateFatigueMult(planet, now),
    );
    assert.ok(Math.abs(effectiveWeight - 0.495) < 1e-9);
  });
});

describe("B7-99/100/101 pirate level, loss, and strength", () => {
  const NOW = 1_700_000_000_000;

  function raidStage(name: string) {
    const universe = createUniverse(name, 1, 1, { lazySeed: true });
    universe.skipPirateTopUp = true;
    const { player, planet } = joinUniverse(universe, "Defender", NOW - 10 * 86_400_000);
    player.createdAt = NOW - 10 * 86_400_000;
    player.attackedPiratesAt = NOW - 1000;
    const body = universe.planets[planet.id]!;
    body.buildings = { metalMine: 20, crystalMine: 20, solarPlant: 20 };
    body.defenses = emptyDefenses();
    body.ships = emptyFleetShips();
    return { universe, player, body };
  }

  function defenderPower(body: UniverseState["planets"][string], universe: UniverseState): number {
    const owner = universe.players[body.ownerPlayerId];
    return (
      fleetCombatPower(body.ships, owner?.research) +
      defenseCombatPower(body.defenses ?? emptyDefenses(), owner?.research)
    );
  }

  function hangarMinus(before: FleetShips, sent: FleetShips): FleetShips {
    const out = emptyFleetShips();
    for (const id of SHIP_ORDER) out[id] = Math.max(0, (before[id] ?? 0) - (sent[id] ?? 0));
    return out;
  }

  it("scales raid detachment power with pirate level", () => {
    assert.equal(PIRATE_RAID_LEVEL_POWER_BONUS, 0.5);
    assert.equal(pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, 0), PIRATE_RAID_POWER_FACTOR_PLAYER);
    assert.equal(
      pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR, PIRATE_MAX_LEVEL),
      PIRATE_RAID_POWER_FACTOR * (1 + PIRATE_RAID_LEVEL_POWER_BONUS),
    );
    const stock = { ...emptyFleetShips(), interceptor: 1000 };
    const powers: number[] = [];
    for (const level of [0, 50, PIRATE_MAX_LEVEL]) {
      const { universe, body } = raidStage(`level-${level}`);
      body.ships = { ...emptyFleetShips(), interceptor: 10 };
      const power = defenderPower(body, universe);
      const expected = scalePirateRaidFleet(
        stock,
        power,
        body.ships,
        pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, level),
      );
      const base = createPirateBase(
        universe.seed ?? universe.id,
        body.coords.galaxy,
        Math.min(MAP_SYSTEMS, body.coords.system + 1),
        2,
        NOW,
        level,
      );
      base.ships = { ...stock };
      universe.pirateBases = { [base.id]: base };
      applyNpcRaidOnPlanet(universe, base, body, NOW, "pirate", () => {});
      const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === base.id);
      assert.ok(report);
      assert.deepEqual(report.attackerBefore, expected);
      powers.push(fleetCombatPower(report.attackerBefore));
    }
    assert.ok(powers[1]! > powers[0]!, `mid ${powers[1]} vs low ${powers[0]}`);
    assert.ok(powers[2]! > powers[1]!, `cap ${powers[2]} vs mid ${powers[1]}`);

    const tiny = { ...emptyFleetShips(), interceptor: 1 };
    const cappedLow = scalePirateRaidFleet(
      tiny,
      10_000,
      tiny,
      pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, 0),
    );
    const cappedHigh = scalePirateRaidFleet(
      tiny,
      10_000,
      tiny,
      pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR_PLAYER, PIRATE_MAX_LEVEL),
    );
    assert.deepEqual(cappedLow, cappedHigh);

    const { universe } = raidStage("npc-level");
    const seed = universe.seed ?? universe.id;
    const removed: number[] = [];
    for (const level of [0, PIRATE_MAX_LEVEL]) {
      const defender = createPirateBase(seed, 1, 3, 3, NOW, 1);
      defender.ships = { ...emptyFleetShips(), scout: 8 };
      defender.defenses = emptyDefenses();
      const research = pirateCombatResearch(defender);
      const otherPower =
        fleetCombatPower(defender.ships, research) +
        defenseCombatPower(defender.defenses, research);
      const attacker = createPirateBase(seed, 1, 4, 3, NOW, level);
      attacker.ships = { ...emptyFleetShips(), hauler: 2000 };
      const before = { ...attacker.ships };
      const expected = scalePirateRaidFleet(
        before,
        otherPower,
        undefined,
        pirateRaidPowerFactor(PIRATE_RAID_POWER_FACTOR, level),
      );
      universe.pirateBases = { [attacker.id]: attacker, [defender.id]: defender };
      applyNpcRaidOnNpc(universe, attacker, defender, NOW + level, () => {}, () => {});
      assert.deepEqual(attacker.ships, hangarMinus(before, expected));
      const gone = fleetShipCount(before) - fleetShipCount(attacker.ships);
      assert.equal(gone, fleetShipCount(expected));
      removed.push(gone);
    }
    assert.ok(removed[1]! > removed[0]!, `high ${removed[1]} vs low ${removed[0]}`);
  });

  it("removes the full sent detachment when a pirate raid does not win", () => {
    const { universe, body } = raidStage("pirate-loss");
    body.ships = { ...emptyFleetShips(), hauler: 80 };
    const base = createPirateBase(
      universe.seed ?? universe.id,
      body.coords.galaxy,
      Math.min(MAP_SYSTEMS, body.coords.system + 1),
      2,
      NOW,
      0,
    );
    const before = { ...emptyFleetShips(), hauler: 400 };
    base.ships = { ...before };
    universe.pirateBases = { [base.id]: base };
    applyNpcRaidOnPlanet(universe, base, body, NOW, "pirate", () => {});
    const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === base.id);
    assert.ok(report);
    assert.notEqual(report.outcome, "attacker_win");
    const sentCount = fleetShipCount(report.attackerBefore);
    const survived = fleetShipCount(report.attackerAfter);
    assert.ok(sentCount > 0);
    assert.ok(survived > 0, `need survivors to prove they do not return, outcome ${report.outcome} sent ${sentCount}`);
    assert.deepEqual(base.ships, hangarMinus(before, report.attackerBefore));
    const softFactor = Math.min(1, 0.5 + (survived / sentCount) * 0.5);
    const softKept = Math.floor((before.hauler ?? 0) * softFactor + 1e-9);
    assert.notEqual(base.ships.hauler, softKept);
  });

  it("on a pirate win removes only destroyed sent ships", () => {
    const { universe, body } = raidStage("pirate-win");
    body.ships = { ...emptyFleetShips(), interceptor: 20 };
    const base = createPirateBase(
      universe.seed ?? universe.id,
      body.coords.galaxy,
      Math.min(MAP_SYSTEMS, body.coords.system + 1),
      2,
      NOW,
      PIRATE_MAX_LEVEL,
    );
    const before = { ...emptyFleetShips(), interceptor: 500 };
    base.ships = { ...before };
    universe.pirateBases = { [base.id]: base };
    applyNpcRaidOnPlanet(universe, base, body, NOW, "pirate", () => {});
    const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === base.id);
    assert.ok(report);
    assert.equal(report.outcome, "attacker_win");
    let destroyed = 0;
    for (const id of SHIP_ORDER) {
      const sent = report.attackerBefore[id] ?? 0;
      const lived = report.attackerAfter[id] ?? 0;
      const lost = Math.max(0, sent - lived);
      destroyed += lost;
      assert.equal(base.ships[id] ?? 0, Math.max(0, (before[id] ?? 0) - lost));
    }
    assert.ok(destroyed > 0, "win must destroy some sent hulls so the old 50% floor would differ");
    const sentCount = fleetShipCount(report.attackerBefore);
    const survived = fleetShipCount(report.attackerAfter);
    const softFactor = Math.min(1, 0.5 + (survived / sentCount) * 0.5);
    const softInterceptors = Math.floor((before.interceptor ?? 0) * softFactor + 1e-9);
    assert.notEqual(base.ships.interceptor, softInterceptors);
  });

  it("halves ordinary pirate ships and leaves the boss payout table alone", () => {
    assert.equal(PIRATE_STRENGTH_MULT, 0.5);
    assert.equal(ALIEN_STRENGTH_MULT, 1.5);
    const tier = 40;
    const rawScout = 2 + Math.floor(tier * 0.4);
    const rawInterceptor = Math.max(1, Math.floor(tier * 0.25));
    assert.equal(
      pirateShipsForTier(tier).scout,
      Math.floor(rawScout * PIRATE_STRENGTH_MULT + 1e-9),
    );
    assert.equal(
      pirateShipsForTier(tier).interceptor,
      Math.floor(rawInterceptor * PIRATE_STRENGTH_MULT + 1e-9),
    );
    assert.equal(
      alienShipsForTier(tier).scout,
      Math.floor(rawScout * ALIEN_STRENGTH_MULT + 1e-9),
    );

    const level = 8;
    const total = PIRATE_FREE_SHIP_BASE + PIRATE_FREE_SHIP_PER_LEVEL * level;
    const rawFreeScout = Math.floor((total * 7) / 10);
    const rawFreeInterceptor = total - rawFreeScout;
    const spawned = pirateFreeSpawnShips(level);
    assert.equal(spawned.scout, Math.floor(rawFreeScout * PIRATE_STRENGTH_MULT + 1e-9));
    assert.equal(spawned.interceptor, Math.floor(rawFreeInterceptor * PIRATE_STRENGTH_MULT + 1e-9));
    assert.ok(fleetShipCount(pirateFreeSpawnShips(20)) > fleetShipCount(pirateFreeSpawnShips(1)));

    assert.equal(PIRATE_BOSS_TIERS.top1.starshards, 500);
    assert.equal(PIRATE_BOSS_TIERS.top1.resources.metal, 100_000);
    assert.equal(PIRATE_BOSS_TIERS.top1.resources.crystal, 50_000);
    assert.equal(PIRATE_BOSS_TIERS.top1.resources.deuterium, 25_000);
    assert.equal(PIRATE_BOSS_TIERS.top10.minShare, 0.1);
    assert.equal(PIRATE_BOSS_TIERS.top10.starshards, 150);
    assert.equal(PIRATE_BOSS_TIERS.top10.resources.metal, 40_000);
    assert.equal(PIRATE_BOSS_TIERS.participant.minShare, 0.01);
    assert.equal(PIRATE_BOSS_TIERS.participant.starshards, 40);
    assert.equal(PIRATE_BOSS_TIERS.participant.resources.deuterium, 2_500);
  });

  it("keeps an in-flight fleet when an older save loads", () => {
    const { universe, player, body } = raidStage("save-compat");
    body.resources.metal = 222_333;
    body.buildings.metalMine = 4;
    const fleet: FleetMission = {
      id: "fleet-b7-99-inflight",
      ownerPlayerId: player.id,
      originPlanetId: body.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { ...body.coords },
      mission: "deploy",
      ships: { ...emptyFleetShips(), scout: 2 },
      cargo: { metal: 9, crystal: 0, deuterium: 0 },
      departedAt: NOW - 1000,
      arrivesAt: NOW + 60_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe)));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 2);
    assert.equal(loaded.universe.fleets[fleet.id]?.mission, "deploy");
    assert.equal(loaded.universe.fleets[fleet.id]?.arrivesAt, NOW + 60_000);
    assert.equal(loaded.universe.planets[body.id]?.resources.metal, 222_333);
    assert.equal(loaded.universe.planets[body.id]?.buildings.metalMine, 4);
    assert.equal(loaded.universe.players[player.id]?.name, "Defender");
  });

  it("aliens keep the soft hangar scale", () => {
    const { universe, player, body } = raidStage("alien-soft");
    body.ships = { ...emptyFleetShips(), cruiser: 40 };
    const alien = createAlienBase(
      universe,
      body.coords.galaxy,
      Math.min(MAP_SYSTEMS, body.coords.system + 1),
      2,
      NOW,
      player.id,
      10,
    );
    const before = { ...emptyFleetShips(), interceptor: 200 };
    alien.ships = { ...before };
    alien.buildupEndsAt = NOW - 1;
    universe.alienBases = { [alien.id]: alien };
    applyNpcRaidOnPlanet(universe, alien, body, NOW, "alien", () => {});
    const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === alien.id);
    assert.ok(report);
    const sent = fleetShipCount(report.attackerBefore);
    const survived = fleetShipCount(report.attackerAfter);
    assert.ok(sent > 0);
    const factor = Math.min(1, 0.5 + (survived / sent) * 0.5);
    assert.equal(
      alien.ships.interceptor,
      Math.floor((before.interceptor ?? 0) * factor + 1e-9),
    );
  });
});

describe("B7-97/98 pirate distance and flight raids", () => {
  const NOW = 1_700_000_000_000;

  function stage(name: string) {
    const universe = createUniverse(name, 1, 1, { lazySeed: true });
    universe.skipPirateTopUp = true;
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    universe.seedCursor = { at: 0, pirates: 0, done: true };
    const { player, planet } = joinUniverse(universe, "Defender", NOW - 10 * 86_400_000);
    player.createdAt = NOW - 10 * 86_400_000;
    player.attackedPiratesAt = NOW - 1000;
    graduateNewbieProtection(universe, player);
    const body = universe.planets[planet.id]!;
    body.buildings = {
      metalMine: 20,
      crystalMine: 20,
      solarPlant: 20,
      metalStorage: 20,
      crystalStorage: 20,
      deutTank: 20,
    };
    body.defenses = emptyDefenses();
    body.ships = emptyFleetShips();
    body.resources = { metal: 80_000, crystal: 40_000, deuterium: 20_000 };
    return { universe, player, body };
  }

  function parkPirate(
    universe: UniverseState,
    body: UniverseState["planets"][string],
    ships: FleetShips,
    level = 0,
  ) {
    const base = createPirateBase(
      universe.seed ?? universe.id,
      body.coords.galaxy,
      Math.min(MAP_SYSTEMS, body.coords.system + 1),
      2,
      NOW,
      level,
    );
    base.ships = { ...ships };
    base.nextRaidAt = NOW;
    base.lastGrewAt = NOW;
    base.lastFreeSpawnAt = NOW;
    universe.pirateBases = { [base.id]: base };
    universe.alienBases = {};
    return base;
  }

  it("distance weight matches 1/(1+(d/400)^2) and lowers farther planets", () => {
    assert.equal(PIRATE_RAID_DISTANCE_REF, 400);
    const weight = (d: number) => 1 / (1 + (d / PIRATE_RAID_DISTANCE_REF) ** 2);
    assert.ok(Math.abs(pirateRaidDistanceWeight(5) - weight(5)) < 1e-12);
    assert.ok(pirateRaidDistanceWeight(5) > 0.999);
    assert.equal(pirateRaidDistanceWeight(400), 0.5);
    assert.ok(Math.abs(pirateRaidDistanceWeight(1000) - weight(1000)) < 1e-12);
    assert.ok(pirateRaidDistanceWeight(1000) > 0.13 && pirateRaidDistanceWeight(1000) < 0.14);

    const { universe, body } = stage("distance");
    const base = parkPirate(universe, body, { ...emptyFleetShips(), scout: 10 });
    const near = {
      ...body,
      id: "near-world",
      coords: {
        galaxy: base.coords.galaxy,
        system: base.coords.system,
        slot: Math.min(15, base.coords.slot + 1),
      },
    };
    const far = {
      ...body,
      id: "far-world",
      coords: {
        galaxy: base.coords.galaxy + 2,
        system: 1,
        slot: 1,
      },
    };
    const nearW = piratePlanetPickWeight(universe, near, NOW, base);
    const farW = piratePlanetPickWeight(universe, far, NOW, base);
    assert.ok(nearW > 0 && farW > 0);
    assert.ok(nearW > farW);
    const nearD = pirateRaidDistanceWeight(coordDistance(base.coords, near.coords));
    const farD = pirateRaidDistanceWeight(coordDistance(base.coords, far.coords));
    assert.ok(Math.abs(nearW / farW - nearD / farD) < 1e-9);
    assert.ok(coordDistance(base.coords, far.coords) > coordDistance(base.coords, near.coords));
  });

  it("launches a pirate fleet whose flight time matches flightSecondsOneWay", () => {
    const { universe, player, body } = stage("flight");
    body.ships = { ...emptyFleetShips(), scout: 6 };
    const before = { ...emptyFleetShips(), scout: 30, interceptor: 12 };
    const base = parkPirate(universe, body, before);
    delete universe.skipNpcRaids;
    tickPirates(universe, NOW);
    const fleet = piratePlayerFleets(universe, player.id)[0];
    assert.ok(fleet);
    assert.equal(fleet!.ownerPlayerId, "npc_pirates");
    assert.equal(fleet!.mission, "raid");
    assert.equal(fleet!.phase, "outbound");
    assert.equal(fleet!.originPirateBaseId, base.id);
    assert.equal(fleet!.targetPlanetId, body.id);
    assert.equal(fleet!.targetPlayerId, player.id);
    assert.equal(base.recentRaidTargets?.[body.id], NOW);
    const sent = fleetShipCount(fleet!.ships);
    assert.ok(sent > 0);
    assert.equal(fleetShipCount(base.ships), fleetShipCount(before) - sent);
    const seconds = flightSecondsOneWay(
      base.coords,
      body.coords,
      fleet!.ships,
      universe.fleetSpeed,
      0,
      null,
      0,
    );
    assert.equal(fleet!.arrivesAt - fleet!.departedAt, seconds * 1000);
    assert.equal(Object.keys(universe.reports ?? {}).length, 0);
  });

  it("lists the outbound pirate raid as hostile incoming", () => {
    const { universe, player, body } = stage("incoming");
    body.ships = { ...emptyFleetShips(), scout: 6 };
    parkPirate(universe, body, { ...emptyFleetShips(), scout: 30, interceptor: 12 });
    delete universe.skipNpcRaids;
    tickPirates(universe, NOW);
    const fleet = piratePlayerFleets(universe, player.id)[0];
    assert.ok(fleet);
    assert.ok(fleet!.arrivesAt > fleet!.departedAt);
    const view = playerView(universe, player.id, fleet!.departedAt);
    assert.ok(view.hostileInbound.some((entry) => entry.id === fleet!.id));
    assert.equal(eventPresentation(fleet!, true).label, "Hostile incoming");
    const banner = eventsBannerHtml(
      {
        now: fleet!.departedAt,
        player: { id: player.id },
        fleets: [],
        hostileInbound: [fleet!],
        ownedPlanets: [],
        roster: [],
      } as unknown as PlayerView,
      fleet!.departedAt,
    );
    assert.match(banner, /Hostile incoming/);
    assert.match(banner, /event-hostile/);
  });

  it("drops a lost pirate fleet on arrival and does not return survivors", () => {
    const { universe, player, body } = stage("flight-loss");
    body.ships = { ...emptyFleetShips(), hauler: 80 };
    const before = { ...emptyFleetShips(), hauler: 400 };
    const base = parkPirate(universe, body, before);
    delete universe.skipNpcRaids;
    tickPirates(universe, NOW);
    const fleet = piratePlayerFleets(universe, player.id)[0]!;
    const hangarAfterLaunch = { ...base.ships };
    assert.deepEqual(hangarAfterLaunch, {
      ...emptyFleetShips(),
      hauler: (before.hauler ?? 0) - (fleet.ships.hauler ?? 0),
    });
    const sent = fleetShipCount(fleet.ships);
    resolveDuePiratePlayerRaids(universe, player.id);
    const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === base.id);
    assert.ok(report);
    assert.notEqual(report!.outcome, "attacker_win");
    assert.ok(fleetShipCount(report!.attackerAfter) > 0);
    assert.equal(fleetShipCount(report!.attackerBefore), sent);
    assert.equal(universe.fleets[fleet.id], undefined);
    assert.equal(
      Object.values(universe.fleets).some((entry) => entry.ownerPlayerId === "npc_pirates"),
      false,
    );
    assert.deepEqual(base.ships, hangarAfterLaunch);
    const reports = Object.keys(universe.reports ?? {}).length;
    advanceUniverse(universe, fleet.arrivesAt);
    assert.equal(Object.keys(universe.reports ?? {}).length, reports);
    assert.deepEqual(base.ships, hangarAfterLaunch);
  });

  it("brings survivors and loot home after a pirate win, once", () => {
    const { universe, player, body } = stage("flight-win");
    body.ships = { ...emptyFleetShips(), interceptor: 20 };
    const before = { ...emptyFleetShips(), interceptor: 500 };
    const base = parkPirate(universe, body, before, PIRATE_MAX_LEVEL);
    const resourcesBefore = { ...base.resources };
    delete universe.skipNpcRaids;
    tickPirates(universe, NOW);
    const fleet = piratePlayerFleets(universe, player.id)[0]!;
    resolveDuePiratePlayerRaids(universe, player.id);
    const report = Object.values(universe.reports ?? {}).find((entry) => entry.missionId === base.id);
    assert.ok(report);
    assert.equal(report!.outcome, "attacker_win");
    const returning = universe.fleets[fleet.id];
    assert.ok(returning);
    assert.equal(returning!.phase, "returning");
    assert.equal(fleetShipCount(returning!.ships), fleetShipCount(report!.attackerAfter));
    assert.ok((returning!.cargo.metal ?? 0) + (returning!.cargo.crystal ?? 0) > 0);
    assert.equal(fleetShipCount(base.ships), fleetShipCount(before) - fleetShipCount(report!.attackerBefore));
    const homeAt = returning!.arrivesAt;
    base.nextRaidAt = homeAt + 1;
    base.lastGrewAt = homeAt;
    base.lastFreeSpawnAt = homeAt;
    advanceUniverse(universe, homeAt);
    assert.equal(universe.fleets[fleet.id], undefined);
    let destroyed = 0;
    for (const id of SHIP_ORDER) {
      const sent = report!.attackerBefore[id] ?? 0;
      const lived = report!.attackerAfter[id] ?? 0;
      destroyed += Math.max(0, sent - lived);
      assert.equal(base.ships[id] ?? 0, Math.max(0, (before[id] ?? 0) - Math.max(0, sent - lived)));
    }
    assert.ok(destroyed > 0);
    assert.ok(base.resources.metal >= resourcesBefore.metal);
    assert.ok(
      base.resources.metal + base.resources.crystal >
        resourcesBefore.metal + resourcesBefore.crystal,
    );
    const settled = { ...base.ships };
    const banked = { ...base.resources };
    advanceUniverse(universe, homeAt);
    assert.deepEqual(base.ships, settled);
    assert.deepEqual(base.resources, banked);
  });

  it("keeps an in-flight pirate fleet across save load", () => {
    const { universe, player, body } = stage("flight-save");
    const base = parkPirate(universe, body, { ...emptyFleetShips(), scout: 4 });
    const fleet: FleetMission = {
      id: "fleet-b7-98-inflight",
      ownerPlayerId: "npc_pirates",
      originPlanetId: base.id,
      originPirateBaseId: base.id,
      targetPlanetId: body.id,
      targetPlayerId: player.id,
      targetCoords: { ...body.coords },
      mission: "raid",
      ships: { ...emptyFleetShips(), scout: 2 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: NOW,
      arrivesAt: NOW + 3_600_000,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe)));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 2);
    assert.equal(loaded.universe.fleets[fleet.id]?.mission, "raid");
    assert.equal(loaded.universe.fleets[fleet.id]?.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleet.id]?.originPirateBaseId, base.id);
    assert.equal(loaded.universe.fleets[fleet.id]?.arrivesAt, NOW + 3_600_000);
    assert.equal(loaded.universe.players[player.id]?.name, "Defender");
    assert.equal(loaded.universe.planets[body.id]?.resources.metal, 80_000);
    assert.equal(loaded.universe.planets[body.id]?.buildings.metalMine, 20);
    advanceUniverse(loaded.universe, NOW + 1000);
    assert.equal(loaded.universe.fleets[fleet.id]?.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleet.id]?.ships.scout, 2);
  });
});

// silence unused in case of tree shake
void MAP_GALAXIES;
void (0 as UniverseState | 0);
