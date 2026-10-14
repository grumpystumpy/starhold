import {
  BUILDING_ORDER,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  MINI_DESTROY_DEBRIS_FRAC,
  MINI_DESTROY_RESOURCE_MULT,
  MINI_FIELDS_MAX,
  MINI_FIELDS_MIN,
  MINI_SLOT_MAX,
  MINI_SLOT_MIN,
  MINI_SYSTEMS_PER,
  MINI_WORLD_EATER_MIN,
} from "./catalog.js";
import {
  buildingUpgradeCost,
  canResolveMiniPlanet,
  coordsKey,
  emptyDefenses,
  emptyFleetShips,
  fleetCargoCapacity,
  fleetShipCount,
} from "./formulas.js";
import { hashSeed } from "./formulas-position.js";
import type {
  BuildingId,
  Coordinates,
  MiniPlanetResolveChoice,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";
import { addDebris, addShipsToPlanet } from "./world-tick.js";

function emptyCargo(): Resources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

function emptyMiniBuildings(): PlanetState["buildings"] {
  return {
    metalMine: 0,
    crystalMine: 0,
    deutSynth: 0,
    solarPlant: 0,
    metalStorage: 0,
    crystalStorage: 0,
    deutTank: 0,
    shipyard: 0,
    researchLab: 0,
    lunarBase: 0,
    sensorArray: 0,
    jumpGate: 0,
    chronoLathe: 0,
    mantleLoom: 0,
    rigFoundry: 0,
    riftSiphon: 0,
    echoVault: 0,
    anomalyForge: 0,
    driftBeacon: 0,
  };
}

function planetAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PlanetState | null {
  const key = coordsKey(coords);
  return (
    Object.values(universe.planets).find(
      (p) => p.kind !== "moon" && coordsKey(p.coords) === key,
    ) ?? null
  );
}

export function isMiniPlanet(planet: PlanetState | null | undefined): boolean {
  return Boolean(planet?.flags?.mini);
}

export function isUnclaimedMini(planet: PlanetState): boolean {
  return isMiniPlanet(planet) && !planet.ownerPlayerId;
}

export function miniPlanetId(galaxy: number, system: number, slot: number): string {
  return `mini:${galaxy}:${system}:${slot}`;
}

export function rollMiniFields(seed: string): number {
  const span = MINI_FIELDS_MAX - MINI_FIELDS_MIN + 1;
  return MINI_FIELDS_MIN + (hashSeed(seed) % span);
}

export function createMiniPlanet(
  universeSeed: string,
  galaxy: number,
  system: number,
  slot: number,
  now: number,
): PlanetState {
  const id = miniPlanetId(galaxy, system, slot);
  const coords: Coordinates = { galaxy, system, slot };
  return {
    id,
    ownerPlayerId: "",
    name: `Drift Body ${galaxy}:${system}:${slot}`,
    coords,
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    fieldsCap: rollMiniFields(`${universeSeed}:mini-fields:${id}`),
    resources: { metal: 200, crystal: 200, deuterium: 50 },
    lastTickAt: now,
    buildings: emptyMiniBuildings(),
    ships: emptyFleetShips(),
    defenses: emptyDefenses(),
    buildQueue: [],
    shipQueue: [],
    defenseQueue: [],
    flags: { mini: true },
    discoveredBy: [],
  };
}

/**
 * Seed ~1 mini per MINI_SYSTEMS_PER systems into slots 20–29.
 * Idempotent: skips systems that already have a mini, keeps existing ids.
 */
export function seedUniverseMinis(
  universe: UniverseState,
  now = Date.now(),
): void {
  const seed = universe.seed ?? universe.id;
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  const existing = new Set(universe.miniPlanetIds);

  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      if (
        hashSeed(`${seed}:mini-spawn:${galaxy}:${system}`) % MINI_SYSTEMS_PER !==
        0
      ) {
        continue;
      }
      const slot =
        MINI_SLOT_MIN +
        (hashSeed(`${seed}:mini-slot:${galaxy}:${system}`) %
          (MINI_SLOT_MAX - MINI_SLOT_MIN + 1));
      const id = miniPlanetId(galaxy, system, slot);
      if (existing.has(id) || universe.planets[id]) {
        if (!existing.has(id)) {
          universe.miniPlanetIds.push(id);
          existing.add(id);
        }
        continue;
      }
      if (planetAtCoords(universe, { galaxy, system, slot })) continue;
      universe.planets[id] = createMiniPlanet(seed, galaxy, system, slot, now);
      universe.miniPlanetIds.push(id);
      existing.add(id);
    }
  }
}

/** Rare expedition seed: create one new mini near the expedition system. */
export function seedMiniNearExpedition(
  universe: UniverseState,
  fleetId: string,
  coords: Coordinates,
  now: number,
): PlanetState | null {
  const seed = universe.seed ?? universe.id;
  const slot =
    MINI_SLOT_MIN +
    (hashSeed(`${seed}:mini-exp-slot:${fleetId}:${now}`) %
      (MINI_SLOT_MAX - MINI_SLOT_MIN + 1));
  const g = coords.galaxy;
  const s = Math.min(
    MAP_SYSTEMS,
    Math.max(
      1,
      coords.system +
        ((hashSeed(`${seed}:mini-exp-sys:${fleetId}`) % 5) - 2),
    ),
  );
  const id = miniPlanetId(g, s, slot);
  if (universe.planets[id]) return universe.planets[id];
  if (planetAtCoords(universe, { galaxy: g, system: s, slot })) return null;
  const planet = createMiniPlanet(seed, g, s, slot, now);
  universe.planets[id] = planet;
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  if (!universe.miniPlanetIds.includes(id)) universe.miniPlanetIds.push(id);
  return planet;
}

export function playerKnowsMini(
  universe: UniverseState,
  playerId: string,
  planetId: string,
): boolean {
  const planet = universe.planets[planetId];
  if (!planet || !isMiniPlanet(planet)) return false;
  if (planet.ownerPlayerId === playerId) return true;
  if (planet.discoveredBy?.includes(playerId)) return true;
  const player = universe.players[playerId];
  return Boolean(player?.discoveredMiniIds?.includes(planetId));
}

/** Reveal a mini to the finder (coords only). */
export function discoverMiniPlanet(
  universe: UniverseState,
  playerId: string,
  planetId: string,
): PlanetState | null {
  const planet = universe.planets[planetId];
  const player = universe.players[playerId];
  if (!planet || !player || !isMiniPlanet(planet)) return null;
  if (!planet.discoveredBy) planet.discoveredBy = [];
  if (!planet.discoveredBy.includes(playerId)) {
    planet.discoveredBy.push(playerId);
  }
  if (!player.discoveredMiniIds) player.discoveredMiniIds = [];
  if (!player.discoveredMiniIds.includes(planetId)) {
    player.discoveredMiniIds.push(planetId);
  }
  universe.planets[planetId] = planet;
  universe.players[playerId] = player;
  return planet;
}

/** Pick an undiscovered (by this player) mini, or seed a new one near coords. */
export function pickOrSeedMiniForDiscovery(
  universe: UniverseState,
  playerId: string,
  near: Coordinates,
  fleetId: string,
  now: number,
): PlanetState | null {
  const ids = universe.miniPlanetIds ?? [];
  const unknown = ids
    .map((id) => universe.planets[id])
    .filter(
      (p): p is PlanetState =>
        Boolean(p) &&
        isMiniPlanet(p) &&
        !playerKnowsMini(universe, playerId, p.id),
    );
  if (unknown.length > 0) {
    const idx =
      hashSeed(`${fleetId}:mini-pick:${now}`) % unknown.length;
    return unknown[idx]!;
  }
  return seedMiniNearExpedition(universe, fleetId, near, now);
}

export function buildingResidualCost(planet: PlanetState): Resources {
  let metal = 0;
  let crystal = 0;
  let deuterium = 0;
  for (const id of BUILDING_ORDER) {
    const level = planet.buildings[id] ?? 0;
    for (let L = 0; L < level; L++) {
      const c = buildingUpgradeCost(id as BuildingId, L);
      metal += c.metal;
      crystal += c.crystal;
      deuterium += c.deuterium;
    }
  }
  return { metal, crystal, deuterium };
}

function addCargoOverflowLost(
  current: Resources,
  ships: PlanetState["ships"],
  add: Resources,
): Resources {
  const cap = fleetCargoCapacity(ships);
  const used = current.metal + current.crystal + current.deuterium;
  let free = Math.max(0, Math.floor(cap - used));
  const out = { ...current };
  for (const key of ["metal", "crystal", "deuterium"] as const) {
    const take = Math.min(Math.floor(add[key]), free);
    out[key] += take;
    free -= take;
  }
  return out;
}

function retreatDefenderShips(
  universe: UniverseState,
  planet: PlanetState,
): void {
  if (fleetShipCount(planet.ships) <= 0) {
    planet.ships = emptyFleetShips();
    return;
  }
  const owner = universe.players[planet.ownerPlayerId];
  const home =
    owner &&
    (universe.planets[owner.homePlanetId] ??
      (owner.planetIds
        .map((id) => universe.planets[id])
        .find((p) => p && p.id !== planet.id && p.kind !== "moon") ??
        null));
  if (home) {
    addShipsToPlanet(home, planet.ships);
  }
  planet.ships = emptyFleetShips();
}

export function captureMiniPlanet(
  universe: UniverseState,
  attackerPlayerId: string,
  planet: PlanetState,
): void {
  const prevOwnerId = planet.ownerPlayerId;
  if (prevOwnerId && prevOwnerId !== attackerPlayerId) {
    retreatDefenderShips(universe, planet);
    const prev = universe.players[prevOwnerId];
    if (prev) {
      prev.planetIds = prev.planetIds.filter((id) => id !== planet.id);
      if (prev.activePlanetId === planet.id) {
        prev.activePlanetId = prev.homePlanetId;
      }
      universe.players[prev.id] = prev;
    }
  }
  const attacker = universe.players[attackerPlayerId];
  if (attacker) {
    if (!attacker.planetIds.includes(planet.id)) {
      attacker.planetIds.push(planet.id);
    }
    if (!attacker.discoveredMiniIds) attacker.discoveredMiniIds = [];
    if (!attacker.discoveredMiniIds.includes(planet.id)) {
      attacker.discoveredMiniIds.push(planet.id);
    }
    universe.players[attacker.id] = attacker;
  }
  planet.ownerPlayerId = attackerPlayerId;
  if (!planet.discoveredBy) planet.discoveredBy = [];
  if (!planet.discoveredBy.includes(attackerPlayerId)) {
    planet.discoveredBy.push(attackerPlayerId);
  }
  // Clear build queues from former owner mid-ups.
  planet.buildQueue = [];
  planet.shipQueue = [];
  planet.defenseQueue = [];
  universe.planets[planet.id] = planet;
}

export function destroyMiniPlanet(
  universe: UniverseState,
  attackerFleetShips: PlanetState["ships"],
  attackerCargo: Resources,
  planet: PlanetState,
  keepFleetId?: string,
): Resources {
  const payout: Resources = {
    metal: Math.floor(planet.resources.metal * MINI_DESTROY_RESOURCE_MULT),
    crystal: Math.floor(planet.resources.crystal * MINI_DESTROY_RESOURCE_MULT),
    deuterium: Math.floor(
      planet.resources.deuterium * MINI_DESTROY_RESOURCE_MULT,
    ),
  };
  const newCargo = addCargoOverflowLost(
    attackerCargo,
    attackerFleetShips,
    payout,
  );

  const residual = buildingResidualCost(planet);
  addDebris(universe, planet.coords, {
    metal: Math.floor(residual.metal * MINI_DESTROY_DEBRIS_FRAC),
    crystal: Math.floor(residual.crystal * MINI_DESTROY_DEBRIS_FRAC),
    deuterium: 0,
  });

  const owner = universe.players[planet.ownerPlayerId];
  if (owner) {
    owner.planetIds = owner.planetIds.filter((id) => id !== planet.id);
    if (owner.activePlanetId === planet.id) {
      owner.activePlanetId = owner.homePlanetId;
    }
    universe.players[owner.id] = owner;
  }

  for (const [fid, fleet] of Object.entries(universe.fleets)) {
    if (keepFleetId && fid === keepFleetId) continue;
    if (
      fleet.originPlanetId === planet.id ||
      fleet.targetPlanetId === planet.id
    ) {
      delete universe.fleets[fid];
    }
  }

  if (universe.occupations?.[planet.id]) {
    delete universe.occupations[planet.id];
  }
  if (universe.miniPlanetIds) {
    universe.miniPlanetIds = universe.miniPlanetIds.filter(
      (id) => id !== planet.id,
    );
  }
  for (const player of Object.values(universe.players)) {
    if (player.discoveredMiniIds?.includes(planet.id)) {
      player.discoveredMiniIds = player.discoveredMiniIds.filter(
        (id) => id !== planet.id,
      );
    }
  }
  delete universe.planets[planet.id];
  return newCargo;
}

export type MiniResolveResult =
  | { ok: true; planet: PlanetState | null; choice: MiniPlanetResolveChoice }
  | { ok: false; error: string };

/**
 * Apply capture/destroy after an eligible raid win on a colonized mini.
 */
export function applyMiniPlanetResolve(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  choice: MiniPlanetResolveChoice,
): MiniResolveResult {
  const fleet = universe.fleets[fleetId];
  if (!fleet || fleet.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  if (!canResolveMiniPlanet(fleet.ships)) {
    return {
      ok: false,
      error: `Need at least ${MINI_WORLD_EATER_MIN} World Eaters.`,
    };
  }
  const report = fleet.reportId ? universe.reports[fleet.reportId] : null;
  if (!report || report.outcome !== "attacker_win") {
    return { ok: false, error: "No winning raid report on this fleet." };
  }
  if (report.miniResolved) {
    return { ok: false, error: "Mini planet already resolved." };
  }
  if (!report.miniResolveAvailable && !report.miniPlanetId) {
    return { ok: false, error: "No mini-planet resolve pending." };
  }

  const planetId = report.miniPlanetId ?? fleet.targetPlanetId;
  if (!planetId) return { ok: false, error: "Fleet has no target." };
  const planet = universe.planets[planetId];
  if (!planet || !isMiniPlanet(planet)) {
    return { ok: false, error: "Target is not a mini planet." };
  }
  if (!planet.ownerPlayerId) {
    return { ok: false, error: "Mini planet is unclaimed — colonize it first." };
  }
  if (planet.ownerPlayerId === playerId) {
    return { ok: false, error: "You already own this mini planet." };
  }

  const resolved: MiniPlanetResolveChoice =
    choice === "destroy" ? "destroy" : "capture";

  if (resolved === "capture") {
    captureMiniPlanet(universe, playerId, planet);
    report.miniResolved = "capture";
    report.miniResolveAvailable = false;
    report.summary = `${report.summary} Mini planet captured.`;
    universe.reports[report.id] = report;
    return { ok: true, planet, choice: "capture" };
  }

  fleet.cargo = destroyMiniPlanet(
    universe,
    fleet.ships,
    fleet.cargo ?? emptyCargo(),
    planet,
    fleet.id,
  );
  report.miniResolved = "destroy";
  report.miniResolveAvailable = false;
  report.summary = `${report.summary} Mini planet destroyed — salvage payout loaded (overflow lost).`;
  universe.reports[report.id] = report;
  universe.fleets[fleet.id] = fleet;
  return { ok: true, planet: null, choice: "destroy" };
}

/** Empire Drift Beacon bonus: +1 expedition slot if any owned mini has beacon ≥1. */
export function empireDriftBeaconExpeditionBonus(
  universe: UniverseState,
  playerId: string,
): number {
  const player = universe.players[playerId];
  if (!player) return 0;
  for (const id of player.planetIds) {
    const p = universe.planets[id];
    if (p && isMiniPlanet(p) && (p.buildings.driftBeacon ?? 0) >= 1) {
      return 1;
    }
  }
  return 0;
}
