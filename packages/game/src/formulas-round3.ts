import {
  ASTROLABE_RESEARCH_TIME,
  FRONTIER_BEACON_JUMP_CD,
  GRID_STAKE_ENERGY_CAP,
  GRID_STAKE_ENERGY_PER,
  JUMP_GATE_BASE_COOLDOWN_MS,
  LINE_DRUMMER_SPEED_CAP,
  LINE_DRUMMER_SPEED_PER,
  MANTLE_LOOM_FIELDS_PER_LEVEL,
  PLAYER_CLASS_BONUSES,
  RIG_FOUNDRY_TIME_FLOOR,
  RIG_FOUNDRY_TIME_PER_LEVEL,
  SHIPS,
  SLOT_TEMPERATURE_K,
  SOLAR_TEMP_BASELINE_K,
  SPOIL_SKIMMER_DEBRIS_FRAC,
  VAULT_SCOUT_YIELD_CAP,
  VAULT_SCOUT_YIELD_PER,
  VEIN_ANCHOR_MINE_CAP,
  VEIN_ANCHOR_MINE_PER,
} from "./catalog.js";
import type {
  FleetShips,
  PlanetState,
  PlayerClassId,
  PlayerClassState,
  PlayerState,
  Resources,
  ShipId,
  UniverseState,
} from "./types.js";

export function emptyPlayerClass(): PlayerClassState {
  return {
    classId: null,
    chosenAt: null,
    changeCount: 0,
    lastChangeAt: null,
  };
}

export function ensurePlayerClass(player: PlayerState): PlayerClassState {
  if (!player.playerClass) {
    player.playerClass = emptyPlayerClass();
  }
  return player.playerClass;
}

export function planetTemperatureK(slot: number): number {
  return SLOT_TEMPERATURE_K[slot] ?? SOLAR_TEMP_BASELINE_K;
}

export function solarTempFactor(slot: number): number {
  return planetTemperatureK(slot) / SOLAR_TEMP_BASELINE_K;
}

/** Energy from Helio Buoys parked on a planet. */
export function helioBuoyEnergy(planet: PlanetState): number {
  const count = planet.ships.helioBuoy ?? 0;
  if (count <= 0) return 0;
  return count * Math.floor(planetTemperatureK(planet.coords.slot) / 4);
}

export function mantleLoomFieldsBonus(planet: PlanetState): number {
  const level = planet.buildings.mantleLoom ?? 0;
  return MANTLE_LOOM_FIELDS_PER_LEVEL * Math.max(0, level);
}

/** Rig Foundry time factor: (1 - 0.15×lvl), floored at 0.10. */
export function rigFoundryTimeFactor(rigFoundryLevel: number): number {
  const level = Math.max(0, Math.floor(rigFoundryLevel));
  if (level <= 0) return 1;
  return Math.max(
    RIG_FOUNDRY_TIME_FLOOR,
    1 - RIG_FOUNDRY_TIME_PER_LEVEL * level,
  );
}

export function classBonuses(classId: PlayerClassId | null | undefined) {
  if (!classId) {
    return {
      name: "Unassigned",
      mineOutput: 1,
      energyOutput: 1,
      defensePower: 1,
      defenseBuildTime: 1,
      expeditionYield: 1,
      researchTime: 1,
      probeSpeed: 1,
      expeditionSlots: 0,
      attack: 1,
      fleetSpeed: 1,
      shipBuildTime: 1,
      fleetSlots: 0,
      colonySlots: 0,
      colonyShipSpeed: 1,
      buildingBuildTime: 1,
      jumpGateCooldown: 1,
    };
  }
  return PLAYER_CLASS_BONUSES[classId];
}

/** True when any owned planet hangar has ≥1 of shipId. */
export function empireOwnsShip(
  universe: UniverseState,
  playerId: string,
  shipId: ShipId,
): boolean {
  const player = universe.players[playerId];
  if (!player) return false;
  for (const pid of player.planetIds) {
    const planet = universe.planets[pid];
    if ((planet?.ships[shipId] ?? 0) >= 1) return true;
  }
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.ownerPlayerId !== playerId) continue;
    if ((fleet.ships[shipId] ?? 0) >= 1) return true;
  }
  return false;
}

export function veinAnchorMineMult(planet: PlanetState): number {
  const n = Math.min(VEIN_ANCHOR_MINE_CAP, planet.ships.veinAnchor ?? 0);
  return 1 + VEIN_ANCHOR_MINE_PER * n;
}

export function gridStakeEnergyMult(planet: PlanetState): number {
  const n = Math.min(GRID_STAKE_ENERGY_CAP, planet.ships.gridStake ?? 0);
  return 1 + GRID_STAKE_ENERGY_PER * n;
}

export function vaultScoutExpeditionMult(ships: FleetShips): number {
  const n = Math.min(VAULT_SCOUT_YIELD_CAP, ships.vaultScout ?? 0);
  return 1 + VAULT_SCOUT_YIELD_PER * n;
}

export function lineDrummerFleetSpeedMult(ships: FleetShips): number {
  const n = Math.min(LINE_DRUMMER_SPEED_CAP, ships.lineDrummer ?? 0);
  return 1 + LINE_DRUMMER_SPEED_PER * n;
}

export function astrolabeResearchTimeMult(
  universe: UniverseState,
  playerId: string,
): number {
  return empireOwnsShip(universe, playerId, "astrolabeWing")
    ? ASTROLABE_RESEARCH_TIME
    : 1;
}

/**
 * Spoil Skimmer: skim 15% of debris field into cargo capacity of skimmers.
 * Returns { skimmed cargo, remaining debris }.
 */
export function spoilSkimmerDebris(
  debris: Resources,
  ships: FleetShips,
): { skimmed: Resources; remaining: Resources } {
  const count = ships.spoilSkimmer ?? 0;
  if (count <= 0) {
    return {
      skimmed: { metal: 0, crystal: 0, deuterium: 0 },
      remaining: { ...debris },
    };
  }
  const cargoFree =
    count * (SHIPS.spoilSkimmer?.cargo ?? 0);
  const fieldTotal = Math.max(0, debris.metal + debris.crystal);
  const want = Math.floor(fieldTotal * SPOIL_SKIMMER_DEBRIS_FRAC);
  const take = Math.min(cargoFree, want);
  if (take <= 0) {
    return {
      skimmed: { metal: 0, crystal: 0, deuterium: 0 },
      remaining: { ...debris },
    };
  }
  // Prefer metal first, then crystal (same as harvest).
  const metal = Math.min(debris.metal, take);
  const crystal = Math.min(debris.crystal, take - metal);
  return {
    skimmed: { metal, crystal, deuterium: 0 },
    remaining: {
      metal: debris.metal - metal,
      crystal: debris.crystal - crystal,
      deuterium: 0,
    },
  };
}

export function jumpGateCooldownMs(
  player: PlayerState,
  universe: UniverseState,
): number {
  const cls = classBonuses(player.playerClass?.classId);
  let mult = cls.jumpGateCooldown;
  if (empireOwnsShip(universe, player.id, "frontierBeacon")) {
    mult *= FRONTIER_BEACON_JUMP_CD;
  }
  return Math.max(0, Math.floor(JUMP_GATE_BASE_COOLDOWN_MS * mult));
}

export function isStationaryShip(shipId: ShipId): boolean {
  return Boolean(SHIPS[shipId]?.stationary);
}

export function shipClassAllowed(
  shipId: ShipId,
  classId: PlayerClassId | null | undefined,
): boolean {
  const need = SHIPS[shipId]?.classExclusive;
  if (!need) return true;
  return classId === need;
}

/** Colony cap: astrophysics + Expansionist + Frontier Beacon. */
export function empireColonyCap(
  player: PlayerState,
  universe: UniverseState,
  baseMaxColonies: (astro: number) => number,
): number {
  const cls = classBonuses(player.playerClass?.classId);
  let cap = baseMaxColonies(player.research.astrophysics ?? 0);
  cap += cls.colonySlots;
  if (empireOwnsShip(universe, player.id, "frontierBeacon")) cap += 1;
  return cap;
}

/** Expedition slot cap: astrophysics + Explorer. */
export function empireExpeditionCap(
  player: PlayerState,
  baseMaxExpeditions: (astro: number) => number,
): number {
  const cls = classBonuses(player.playerClass?.classId);
  return baseMaxExpeditions(player.research.astrophysics ?? 0) + cls.expeditionSlots;
}
