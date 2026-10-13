import {
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  PIRATE_DESTROY_STARSHARDS_BASE,
  PIRATE_DESTROY_STARSHARDS_PER_TIER,
  PIRATE_GROWTH_INTERVAL_MS,
  PIRATE_RAID_INTERVAL_MAX_MS,
  PIRATE_RAID_INTERVAL_MIN_MS,
  PIRATE_RAID_POWER_FACTOR,
  PIRATE_RAID_POWER_FLOOR,
  PIRATE_RESPAWN_DELAY_MAX_MS,
  PIRATE_RESPAWN_DELAY_MIN_MS,
  PIRATE_SYSTEMS_PER_BASE,
  PIRATE_TIER_CAP,
  SHIP_ORDER,
} from "./catalog.js";
import {
  computeRaidLoot,
  defenseCombatPower,
  destroyedShipResources,
  effectiveCombatResearch,
  emptyDefenses,
  emptyFleetShips,
  fleetCombatPower,
  fleetShipCount,
  grantPlayerXp,
  normalizeFleetShips,
  resolveCombat,
  resourcesCostTotal,
  xpForCombatLose,
  xpForCombatWin,
  xpForPirateBaseDestroy,
  xpForPirateShipKills,
} from "./formulas.js";
import { hashSeed } from "./formulas-position.js";
import type {
  Coordinates,
  FleetMission,
  FleetShips,
  PirateBase,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";
import {
  grantPirateDestroyStarshards,
  grantPirateFleetKillStarshards,
} from "./world-boosts.js";
import { emptyCargo, planetAtCoords } from "./world-bootstrap.js";
import { subtractCargo } from "./world-tick.js";

const PIRATE_NAMES = [
  "Black Comet Hold",
  "Corsair Nest",
  "Rogue Drift",
  "Scarlet Wake",
  "Iron Maw Outpost",
  "Void Reaver Camp",
  "Ashen Jolly",
  "Cutlass Beacon",
] as const;

export function pirateBaseId(
  galaxy: number,
  system: number,
  slot: number,
): string {
  return `pir:${galaxy}:${system}:${slot}`;
}

export function pirateDestroyStarshards(tier: number): number {
  return (
    PIRATE_DESTROY_STARSHARDS_BASE +
    PIRATE_DESTROY_STARSHARDS_PER_TIER * Math.max(0, Math.floor(tier))
  );
}

function rollInRange(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashSeed(seed) % span);
}

function scaleShips(base: FleetShips, factor: number): FleetShips {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, Math.floor((base[id] ?? 0) * factor));
  }
  if (fleetShipCount(out) < 1 && fleetShipCount(base) > 0) {
    for (const id of SHIP_ORDER) {
      if ((base[id] ?? 0) > 0) {
        out[id] = 1;
        break;
      }
    }
  }
  return out;
}

/** Garrison / raid pool by growth tier (v1 — soft early curve). */
export function pirateShipsForTier(tier: number): FleetShips {
  const t = Math.max(0, Math.min(PIRATE_TIER_CAP, Math.floor(tier)));
  const ships = emptyFleetShips();
  ships.scout = 2 + t * 2;
  ships.interceptor = t >= 1 ? t : 0;
  ships.hauler = t >= 2 ? Math.ceil(t / 2) : 0;
  ships.cruiser = t >= 3 ? Math.floor((t - 2) / 2) : 0;
  ships.bomber = t >= 6 ? t - 5 : 0;
  return ships;
}

function pirateResourcesForTier(tier: number): Resources {
  const t = Math.max(0, Math.floor(tier));
  return {
    metal: 800 + t * 400,
    crystal: 400 + t * 250,
    deuterium: 100 + t * 80,
  };
}

function pirateName(seed: string, galaxy: number, system: number): string {
  const idx = hashSeed(`${seed}:pname:${galaxy}:${system}`) % PIRATE_NAMES.length;
  return PIRATE_NAMES[idx]!;
}

export function activePirateBases(universe: UniverseState): PirateBase[] {
  return Object.values(universe.pirateBases ?? {}).filter(
    (b) => b.destroyedAt == null,
  );
}

export function pirateBaseAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PirateBase | null {
  return (
    activePirateBases(universe).find(
      (b) =>
        b.coords.galaxy === coords.galaxy &&
        b.coords.system === coords.system &&
        b.coords.slot === coords.slot,
    ) ?? null
  );
}

function systemOccupiedByPirate(
  universe: UniverseState,
  galaxy: number,
  system: number,
  exceptId?: string,
): boolean {
  return activePirateBases(universe).some(
    (b) =>
      b.id !== exceptId &&
      b.coords.galaxy === galaxy &&
      b.coords.system === system,
  );
}

function pickEmptySlot(
  universe: UniverseState,
  galaxy: number,
  system: number,
  seedKey: string,
): number | null {
  const start = 1 + (hashSeed(seedKey) % MAP_SLOTS);
  for (let i = 0; i < MAP_SLOTS; i++) {
    const slot = ((start - 1 + i) % MAP_SLOTS) + 1;
    const coords = { galaxy, system, slot };
    if (planetAtCoords(universe, coords)) continue;
    if (pirateBaseAtCoords(universe, coords)) continue;
    return slot;
  }
  return null;
}

export function createPirateBase(
  universeSeed: string,
  galaxy: number,
  system: number,
  slot: number,
  now: number,
  tier = 0,
): PirateBase {
  const id = pirateBaseId(galaxy, system, slot);
  return {
    id,
    coords: { galaxy, system, slot },
    name: pirateName(universeSeed, galaxy, system),
    tier,
    ships: pirateShipsForTier(tier),
    resources: pirateResourcesForTier(tier),
    lastGrewAt: now,
    lastRaidAt: now,
    destroyedAt: null,
  };
}

/**
 * Seed ~1 base per PIRATE_SYSTEMS_PER_BASE systems (deterministic).
 * Idempotent replace of living bases; keeps destroyed entries for respawn.
 */
export function seedUniversePirates(
  universe: UniverseState,
  now = Date.now(),
): void {
  const seed = universe.seed ?? universe.id;
  if (!universe.pirateBases) universe.pirateBases = {};
  const kept: Record<string, PirateBase> = {};
  for (const [id, base] of Object.entries(universe.pirateBases)) {
    if (base.destroyedAt != null) kept[id] = base;
  }

  const living: Record<string, PirateBase> = {};
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      if (
        hashSeed(`${seed}:pirate-spawn:${galaxy}:${system}`) %
          PIRATE_SYSTEMS_PER_BASE !==
        0
      ) {
        continue;
      }
      const slot = pickEmptySlot(
        universe,
        galaxy,
        system,
        `${seed}:pirate-slot:${galaxy}:${system}`,
      );
      if (slot == null) continue;
      const base = createPirateBase(seed, galaxy, system, slot, now, 0);
      living[base.id] = base;
    }
  }
  universe.pirateBases = { ...kept, ...living };
}

function nextRaidIntervalMs(baseId: string, at: number): number {
  return rollInRange(
    `${baseId}:raid-iv:${at}`,
    PIRATE_RAID_INTERVAL_MIN_MS,
    PIRATE_RAID_INTERVAL_MAX_MS,
  );
}

export function pirateRespawnAt(destroyedAt: number, baseId: string): number {
  const delay = rollInRange(
    `${baseId}:respawn:${destroyedAt}`,
    PIRATE_RESPAWN_DELAY_MIN_MS,
    PIRATE_RESPAWN_DELAY_MAX_MS,
  );
  return destroyedAt + delay;
}

/**
 * Cap NPC raid detachment so early empires take losses, not a wipe.
 */
export function scalePirateRaidFleet(
  full: FleetShips,
  defenderPower: number,
): FleetShips {
  const fullPower = Math.max(1, fleetCombatPower(full));
  const cap =
    Math.max(PIRATE_RAID_POWER_FLOOR, defenderPower * PIRATE_RAID_POWER_FACTOR) ||
    PIRATE_RAID_POWER_FLOOR;
  if (fullPower <= cap) return normalizeFleetShips(full);
  return scaleShips(full, cap / fullPower);
}

function growPirateBase(base: PirateBase, now: number): void {
  if (base.destroyedAt != null) return;
  while (
    base.tier < PIRATE_TIER_CAP &&
    now - base.lastGrewAt >= PIRATE_GROWTH_INTERVAL_MS
  ) {
    base.tier += 1;
    base.lastGrewAt += PIRATE_GROWTH_INTERVAL_MS;
    base.ships = pirateShipsForTier(base.tier);
    const stock = pirateResourcesForTier(base.tier);
    base.resources = {
      metal: Math.max(base.resources.metal, stock.metal),
      crystal: Math.max(base.resources.crystal, stock.crystal),
      deuterium: Math.max(base.resources.deuterium, stock.deuterium),
    };
  }
  if (base.tier >= PIRATE_TIER_CAP && now - base.lastGrewAt >= PIRATE_GROWTH_INTERVAL_MS) {
    base.lastGrewAt = now;
  }
}

function markPirateDestroyed(base: PirateBase, now: number): void {
  base.destroyedAt = now;
  base.ships = emptyFleetShips();
  base.resources = emptyCargo();
}

function findRespawnSite(
  universe: UniverseState,
  seedKey: string,
): Coordinates | null {
  const startG = 1 + (hashSeed(`${seedKey}:g`) % MAP_GALAXIES);
  const startS = 1 + (hashSeed(`${seedKey}:s`) % MAP_SYSTEMS);
  for (let dg = 0; dg < MAP_GALAXIES; dg++) {
    const galaxy = ((startG - 1 + dg) % MAP_GALAXIES) + 1;
    for (let ds = 0; ds < MAP_SYSTEMS; ds++) {
      const system = ((startS - 1 + ds) % MAP_SYSTEMS) + 1;
      if (systemOccupiedByPirate(universe, galaxy, system)) continue;
      const slot = pickEmptySlot(
        universe,
        galaxy,
        system,
        `${seedKey}:slot:${galaxy}:${system}`,
      );
      if (slot != null) return { galaxy, system, slot };
    }
  }
  return null;
}

function respawnDestroyedPirates(universe: UniverseState, now: number): void {
  const seed = universe.seed ?? universe.id;
  const bases = universe.pirateBases ?? {};
  for (const id of Object.keys(bases)) {
    const base = bases[id]!;
    if (base.destroyedAt == null) continue;
    if (now < pirateRespawnAt(base.destroyedAt, base.id)) continue;
    const site = findRespawnSite(universe, `${seed}:respawn:${base.id}:${now}`);
    delete bases[id];
    if (!site) continue;
    const next = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      0,
    );
    bases[next.id] = next;
  }
}

function planetDefensePower(planet: PlanetState, universe: UniverseState): number {
  const owner = universe.players[planet.ownerPlayerId];
  return (
    fleetCombatPower(planet.ships, owner?.research) +
    defenseCombatPower(planet.defenses ?? emptyDefenses(), owner?.research)
  );
}

function pickRaidTarget(
  universe: UniverseState,
  base: PirateBase,
  now: number,
):
  | { kind: "planet"; planet: PlanetState }
  | { kind: "pirate"; other: PirateBase }
  | null {
  const roll = hashSeed(`${base.id}:target:${base.lastRaidAt}:${now}`);
  const others = activePirateBases(universe).filter((b) => b.id !== base.id);
  const planets = Object.values(universe.planets).filter(
    (p) => p.kind !== "moon",
  );

  if (planets.length > 0 && (others.length === 0 || roll % 10 < 7)) {
    const planet = planets[roll % planets.length]!;
    return { kind: "planet", planet };
  }
  if (others.length > 0) {
    const other = others[roll % others.length]!;
    return { kind: "pirate", other };
  }
  return null;
}

function applyPirateRaidOnPlanet(
  universe: UniverseState,
  base: PirateBase,
  planet: PlanetState,
  now: number,
): void {
  const owner = universe.players[planet.ownerPlayerId];
  if (!owner) return;
  const defPower = planetDefensePower(planet, universe);
  const raidFleet = scalePirateRaidFleet(base.ships, defPower);
  if (fleetShipCount(raidFleet) < 1) return;

  const combat = resolveCombat(
    raidFleet,
    planet.ships,
    planet.defenses ?? emptyDefenses(),
    undefined,
    effectiveCombatResearch(owner),
  );
  planet.ships = combat.defenderAfter;
  planet.defenses = combat.defensesAfter;

  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(combat.attackerAfter);
  if (sent > 0) {
    const keep = survived / sent;
    base.ships = scaleShips(base.ships, Math.min(1, 0.5 + keep * 0.5));
  }

  if (combat.outcome === "attacker_win") {
    const loot = computeRaidLoot(planet.resources, combat.attackerAfter);
    subtractCargo(planet, loot);
    base.resources = {
      metal: base.resources.metal + loot.metal,
      crystal: base.resources.crystal + loot.crystal,
      deuterium: base.resources.deuterium + loot.deuterium,
    };
    grantPlayerXp(owner, xpForCombatLose());
  } else if (combat.outcome === "defender_win") {
    grantPirateFleetKillStarshards(owner);
    const killed = resourcesCostTotal(
      destroyedShipResources(raidFleet, combat.attackerAfter),
    );
    grantPlayerXp(
      owner,
      xpForCombatWin(killed) + xpForPirateShipKills(killed),
    );
  } else {
    grantPlayerXp(owner, xpForCombatLose());
  }
  universe.players[owner.id] = owner;

  if (fleetShipCount(base.ships) <= 0) {
    markPirateDestroyed(base, now);
  }
}

function applyPirateRaidOnPirate(
  universe: UniverseState,
  base: PirateBase,
  other: PirateBase,
  now: number,
): void {
  const raidFleet = scalePirateRaidFleet(
    base.ships,
    fleetCombatPower(other.ships),
  );
  if (fleetShipCount(raidFleet) < 1) return;

  const combat = resolveCombat(raidFleet, other.ships, emptyDefenses());
  other.ships = combat.defenderAfter;

  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(combat.attackerAfter);
  if (sent > 0) {
    const keep = survived / sent;
    base.ships = scaleShips(base.ships, Math.min(1, 0.5 + keep * 0.5));
  }

  if (combat.outcome === "attacker_win") {
    const loot = computeRaidLoot(other.resources, combat.attackerAfter);
    other.resources = {
      metal: Math.max(0, other.resources.metal - loot.metal),
      crystal: Math.max(0, other.resources.crystal - loot.crystal),
      deuterium: Math.max(0, other.resources.deuterium - loot.deuterium),
    };
    base.resources = {
      metal: base.resources.metal + loot.metal,
      crystal: base.resources.crystal + loot.crystal,
      deuterium: base.resources.deuterium + loot.deuterium,
    };
  }

  if (fleetShipCount(other.ships) <= 0) {
    markPirateDestroyed(other, now);
  }
  if (fleetShipCount(base.ships) <= 0) {
    markPirateDestroyed(base, now);
  }
}

function runDuePirateRaids(universe: UniverseState, now: number): void {
  for (const base of activePirateBases(universe)) {
    const dueAt = base.lastRaidAt + nextRaidIntervalMs(base.id, base.lastRaidAt);
    if (now < dueAt) continue;
    const target = pickRaidTarget(universe, base, now);
    base.lastRaidAt = now;
    if (!target) continue;
    if (target.kind === "planet") {
      applyPirateRaidOnPlanet(universe, base, target.planet, now);
    } else {
      applyPirateRaidOnPirate(universe, base, target.other, now);
    }
  }
}

/** Growth, NPC raids, and respawns (tick-on-read). */
export function tickPirates(universe: UniverseState, now: number): void {
  if (!universe.pirateBases) universe.pirateBases = {};
  for (const base of Object.values(universe.pirateBases)) {
    growPirateBase(base, now);
  }
  runDuePirateRaids(universe, now);
  respawnDestroyedPirates(universe, now);
}

/**
 * Player pirateRaid arrival: combat vs base; destroy + Starshards on win.
 */
export function resolvePirateRaidArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  const baseId = fleet.targetPirateBaseId;
  const base = baseId ? universe.pirateBases?.[baseId] : null;
  if (!base || base.destroyedAt != null) {
    return;
  }

  const owner = universe.players[fleet.ownerPlayerId];
  const defenderBefore = { ...base.ships };
  const tierAtFight = base.tier;
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    emptyDefenses(),
    effectiveCombatResearch(owner),
  );
  base.ships = combat.defenderAfter;

  const killed = resourcesCostTotal(
    destroyedShipResources(defenderBefore, combat.defenderAfter),
  );

  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(base.resources, combat.attackerAfter);
    base.resources = {
      metal: Math.max(0, base.resources.metal - loot.metal),
      crystal: Math.max(0, base.resources.crystal - loot.crystal),
      deuterium: Math.max(0, base.resources.deuterium - loot.deuterium),
    };
    markPirateDestroyed(base, now);
    if (owner) {
      grantPirateDestroyStarshards(owner, tierAtFight);
      grantPlayerXp(
        owner,
        xpForCombatWin(killed) +
          xpForPirateBaseDestroy(tierAtFight) +
          xpForPirateShipKills(killed),
      );
      universe.players[owner.id] = owner;
    }
  } else if (owner) {
    grantPlayerXp(owner, xpForCombatLose());
    universe.players[owner.id] = owner;
  }

  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  universe.reports[reportId] = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    attackerPlayerId: fleet.ownerPlayerId,
    defenderPlayerId: "npc_pirates",
    attackerName: owner?.name ?? "Unknown",
    defenderName: base.name,
    targetCoords: { ...base.coords },
    attackerBefore: { ...fleet.ships },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore: emptyDefenses(),
    defensesAfter: emptyDefenses(),
    loot,
    debrisCreated: emptyCargo(),
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary:
      combat.outcome === "attacker_win"
        ? `${combat.summary} Pirate base destroyed (+${pirateDestroyStarshards(tierAtFight)} Starshards).`
        : combat.summary,
    moonFormed: false,
  };

  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}
