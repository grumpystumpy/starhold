import {
  BUILDING_ORDER,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  MINI_DESTROY_DEBRIS_FRAC,
  MINI_DESTROY_RESOURCE_MULT,
  MINI_DRIFT_INTERVAL_MS,
  MINI_DRIFT_SYSTEM_STEP,
  MINI_FIELDS_MAX,
  MINI_FIELDS_MIN,
  MINI_FORTRESS_RELOCATE_ACCURACY,
  MINI_FORTRESS_RELOCATE_DEUT_BASE,
  MINI_FORTRESS_RELOCATE_DEUT_PER_GALAXY,
  MINI_FORTRESS_RELOCATE_DEUT_PER_SYSTEM,
  MINI_FORTRESS_RELOCATE_GALAXY_RANGE,
  MINI_FORTRESS_SYSTEMS_PER,
  MINI_GALAXY_VISIBLE_AFTER_MS,
  MINI_IRONWATER_SYSTEMS_PER,
  MINI_RELIC_EXPEDITION_FIND,
  MINI_RELIC_RESEARCH_TIME,
  MINI_RELIC_SYSTEMS_PER,
  MINI_SLOT_MAX,
  MINI_SLOT_MIN,
  MINI_SYSTEMS_PER,
  MINI_WORLD_EATER_MIN,
} from "./catalog.js";
import {
  buildingUpgradeCost,
  canDestroyMiniPlanet,
  canDirectCaptureMini,
  emptyDefenses,
  emptyFleetShips,
  fleetCargoCapacity,
  fleetShipCount,
} from "./formulas.js";
import { hashSeed } from "./formulas-position.js";
import { consumeTickBudget } from "./tick-budget.js";
import {
  notePlanetAdded,
  notePlanetMoved,
  planetAtCoords,
} from "./planet-index.js";
import type {
  BuildingId,
  Coordinates,
  MiniPlanetResolveChoice,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";
import { recordMiniPlanetSighting } from "./world-event-log.js";
import { addDebris, addShipsToPlanet } from "./world-tick.js";

export type MiniKind = "standard" | "ironwater" | "fortress" | "relic";

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

export function isMiniPlanet(planet: PlanetState | null | undefined): boolean {
  return Boolean(planet?.flags?.mini);
}

export function miniKindOf(planet: PlanetState | null | undefined): MiniKind {
  const k = planet?.flags?.miniKind;
  if (k === "ironwater" || k === "fortress" || k === "relic") return k;
  return "standard";
}

export function isUnclaimedMini(planet: PlanetState): boolean {
  return isMiniPlanet(planet) && !planet.ownerPlayerId;
}

export function isMovingFortress(planet: PlanetState | null | undefined): boolean {
  return isMiniPlanet(planet) && miniKindOf(planet) === "fortress";
}

export function isRelicWorld(planet: PlanetState | null | undefined): boolean {
  return isMiniPlanet(planet) && miniKindOf(planet) === "relic";
}

export function isIronwaterRock(planet: PlanetState | null | undefined): boolean {
  return isMiniPlanet(planet) && miniKindOf(planet) === "ironwater";
}

export function miniPlanetId(galaxy: number, system: number, slot: number): string {
  return `mini:${galaxy}:${system}:${slot}`;
}

export function rollMiniFields(seed: string): number {
  const span = MINI_FIELDS_MAX - MINI_FIELDS_MIN + 1;
  return MINI_FIELDS_MIN + (hashSeed(seed) % span);
}

function displayNameForKind(
  kind: MiniKind,
  galaxy: number,
  system: number,
  slot: number,
): string {
  switch (kind) {
    case "ironwater":
      return `Ironwater Rock ${galaxy}:${system}:${slot}`;
    case "fortress":
      return `Moving Fortress ${galaxy}:${system}:${slot}`;
    case "relic":
      return `Relic World ${galaxy}:${system}:${slot}`;
    case "standard":
      return `Drift Body ${galaxy}:${system}:${slot}`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** All mini kinds that spawn in a system this roll (multiple OK). */
export function rollMiniKindsForSystem(
  seed: string,
  galaxy: number,
  system: number,
): MiniKind[] {
  const key = `${seed}:mini-kind:${galaxy}:${system}`;
  const kinds: MiniKind[] = [];
  if (hashSeed(`${key}:ironwater`) % MINI_IRONWATER_SYSTEMS_PER === 0) {
    kinds.push("ironwater");
  }
  if (hashSeed(`${key}:fortress`) % MINI_FORTRESS_SYSTEMS_PER === 0) {
    kinds.push("fortress");
  }
  if (hashSeed(`${key}:relic`) % MINI_RELIC_SYSTEMS_PER === 0) {
    kinds.push("relic");
  }
  if (hashSeed(`${seed}:mini-spawn:${galaxy}:${system}`) % MINI_SYSTEMS_PER === 0) {
    kinds.push("standard");
  }
  return kinds;
}

function freeMiniSlots(
  universe: UniverseState,
  galaxy: number,
  system: number,
): number[] {
  const free: number[] = [];
  for (let slot = MINI_SLOT_MIN; slot <= MINI_SLOT_MAX; slot++) {
    if (!planetAtCoords(universe, { galaxy, system, slot })) free.push(slot);
  }
  return free;
}

function pickFreeMiniSlot(
  universe: UniverseState,
  galaxy: number,
  system: number,
  salt: string,
): number | null {
  const free = freeMiniSlots(universe, galaxy, system);
  if (free.length === 0) return null;
  return free[hashSeed(salt) % free.length]!;
}

export function createMiniPlanet(
  universeSeed: string,
  galaxy: number,
  system: number,
  slot: number,
  now: number,
  kind: MiniKind = "standard",
): PlanetState {
  const id = miniPlanetId(galaxy, system, slot);
  const coords: Coordinates = { galaxy, system, slot };
  return {
    id,
    ownerPlayerId: "",
    name: displayNameForKind(kind, galaxy, system, slot),
    coords,
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    fieldsCap: rollMiniFields(`${universeSeed}:mini-fields:${id}`),
    resources: { metal: 400, crystal: 400, deuterium: 100 },
    lastTickAt: now,
    buildings: emptyMiniBuildings(),
    ships: emptyFleetShips(),
    defenses: emptyDefenses(),
    buildQueue: [],
    shipQueue: [],
    defenseQueue: [],
    flags: { mini: true, miniKind: kind },
    discoveredBy: [],
    lastDriftAt: now,
  };
}

/**
 * Seed standard + super-rare minis into slots 20–29.
 * Multiple minis may share a system (different slots). Idempotent on ids.
 */
/** Minis for one system. Returns how many new bodies were created. */
export function seedMinisInSystem(
  universe: UniverseState,
  galaxy: number,
  system: number,
  now: number,
): number {
  const seed = universe.seed ?? universe.id;
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  const kinds = rollMiniKindsForSystem(seed, galaxy, system);
  let created = 0;
  let i = 0;
  for (const kind of kinds) {
    const slot = pickFreeMiniSlot(
      universe,
      galaxy,
      system,
      `${seed}:mini-slot:${galaxy}:${system}:${kind}:${i}`,
    );
    i += 1;
    if (slot == null) continue;
    const id = miniPlanetId(galaxy, system, slot);
    if (universe.planets[id]) {
      if (!universe.miniPlanetIds.includes(id)) universe.miniPlanetIds.push(id);
      continue;
    }
    const mini = createMiniPlanet(seed, galaxy, system, slot, now, kind);
    universe.planets[id] = mini;
    notePlanetAdded(universe, mini);
    universe.miniPlanetIds.push(id);
    created += 1;
  }
  return created;
}

export function seedUniverseMinis(
  universe: UniverseState,
  now = Date.now(),
): void {
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  for (const id of universe.miniPlanetIds) {
    const p = universe.planets[id];
    if (p?.flags?.mini && !p.flags.miniKind) p.flags.miniKind = "standard";
  }

  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      seedMinisInSystem(universe, galaxy, system, now);
    }
  }
}

/** Rare expedition seed: create one new standard mini near the expedition system. */
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
  const planet = createMiniPlanet(seed, g, s, slot, now, "standard");
  universe.planets[id] = planet;
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  if (!universe.miniPlanetIds.includes(id)) universe.miniPlanetIds.push(id);
  return planet;
}

/** True once colonizedAt + 8h has elapsed (galaxy-visible to everyone). */
export function isMiniGalaxyPublic(
  planet: PlanetState,
  now = Date.now(),
): boolean {
  if (!isMiniPlanet(planet) || planet.colonizedAt == null) return false;
  return now >= planet.colonizedAt + MINI_GALAXY_VISIBLE_AFTER_MS;
}

export function playerKnowsMini(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  now = Date.now(),
): boolean {
  const planet = universe.planets[planetId];
  if (!planet || !isMiniPlanet(planet)) return false;
  if (planet.ownerPlayerId === playerId) return true;
  if (isMiniGalaxyPublic(planet, now)) return true;
  if (planet.discoveredBy?.includes(playerId)) return true;
  const player = universe.players[playerId];
  return Boolean(player?.discoveredMiniIds?.includes(planetId));
}

/** Reveal a mini to the finder (coords only). Nearby empires get an alert. */
export function discoverMiniPlanet(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  now = Date.now(),
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
    recordMiniPlanetSighting(universe, planet.coords, playerId, now, planet.id);
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
    const idx = hashSeed(`${fleetId}:mini-pick:${now}`) % unknown.length;
    return unknown[idx]!;
  }
  return seedMiniNearExpedition(universe, fleetId, near, now);
}

export function playerOwnsMiniKind(
  universe: UniverseState,
  playerId: string,
  kind: MiniKind,
): boolean {
  if (kind === "standard" || kind === "ironwater") return false;
  const player = universe.players[playerId];
  if (!player) return false;
  for (const id of player.planetIds) {
    const p = universe.planets[id];
    if (p && isMiniPlanet(p) && miniKindOf(p) === kind) return true;
  }
  return false;
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

/** Remove owner; leave mini unoccupied (buildings remain). */
export function vacateMiniPlanet(
  universe: UniverseState,
  planet: PlanetState,
): void {
  const prevOwnerId = planet.ownerPlayerId;
  if (prevOwnerId) {
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
  planet.ownerPlayerId = "";
  planet.buildQueue = [];
  planet.shipQueue = [];
  planet.defenseQueue = [];
  universe.planets[planet.id] = planet;
}

export function captureMiniPlanet(
  universe: UniverseState,
  attackerPlayerId: string,
  planet: PlanetState,
): { ok: true } | { ok: false; error: string } {
  const kind = miniKindOf(planet);
  if (
    (kind === "fortress" || kind === "relic") &&
    playerOwnsMiniKind(universe, attackerPlayerId, kind)
  ) {
    return {
      ok: false,
      error:
        kind === "fortress"
          ? "You already hold a Moving Fortress — cannot capture another."
          : "You already hold a Relic World — cannot capture another.",
    };
  }

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
  if (planet.colonizedAt == null) planet.colonizedAt = Date.now();
  planet.buildQueue = [];
  planet.shipQueue = [];
  planet.defenseQueue = [];
  universe.planets[planet.id] = planet;
  return { ok: true };
}

/** Immediately reseed same kind into discoverable pool (no respawn timer). */
export function reseedMiniAfterDestroy(
  universe: UniverseState,
  near: Coordinates,
  kind: MiniKind,
  now: number,
  salt: string,
): PlanetState | null {
  const seed = universe.seed ?? universe.id;
  for (let attempt = 0; attempt < 24; attempt++) {
    const sys = Math.min(
      MAP_SYSTEMS,
      Math.max(
        1,
        near.system + ((hashSeed(`${salt}:sys:${attempt}`) % 9) - 4),
      ),
    );
    const slot = pickFreeMiniSlot(
      universe,
      near.galaxy,
      sys,
      `${salt}:slot:${attempt}`,
    );
    if (slot == null) continue;
    const planet = createMiniPlanet(
      seed,
      near.galaxy,
      sys,
      slot,
      now,
      kind,
    );
    universe.planets[planet.id] = planet;
    if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
    if (!universe.miniPlanetIds.includes(planet.id)) {
      universe.miniPlanetIds.push(planet.id);
    }
    return planet;
  }
  return null;
}

/**
 * Destroy payout: metal + crystal only — never deuterium.
 */
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
    deuterium: 0,
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
 * Apply capture/destroy after a raid win on a colonized mini.
 * Capture: Void Titan / Mothership / World Eater only.
 * Destroy: ≥1 World Eater; immediate reseed into discoverable pool.
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
  if (planet.ownerPlayerId === playerId) {
    return { ok: false, error: "You already own this mini planet." };
  }

  const resolved: MiniPlanetResolveChoice =
    choice === "destroy" ? "destroy" : "capture";

  if (resolved === "destroy") {
    if (!canDestroyMiniPlanet(fleet.ships)) {
      return {
        ok: false,
        error: `Need at least ${MINI_WORLD_EATER_MIN} World Eater to destroy.`,
      };
    }
    if (!planet.ownerPlayerId) {
      return { ok: false, error: "Mini already unoccupied — nothing to destroy." };
    }
    const kind = miniKindOf(planet);
    const coords = { ...planet.coords };
    fleet.cargo = destroyMiniPlanet(
      universe,
      fleet.ships,
      fleet.cargo ?? emptyCargo(),
      planet,
      fleet.id,
    );
    reseedMiniAfterDestroy(
      universe,
      coords,
      kind,
      report.at,
      `${fleet.id}:reseed`,
    );
    report.miniResolved = "destroy";
    report.miniResolveAvailable = false;
    report.summary = `${report.summary} Mini planet destroyed — metal/crystal salvage loaded; body returns to discoverable pool.`;
    universe.reports[report.id] = report;
    universe.fleets[fleet.id] = fleet;
    return { ok: true, planet: null, choice: "destroy" };
  }

  if (!canDirectCaptureMini(fleet.ships)) {
    return {
      ok: false,
      error:
        "Ordinary fleets only clear the owner — reclaim with a Colonizer mission.",
    };
  }
  if (!planet.ownerPlayerId) {
    return {
      ok: false,
      error: "Mini is unoccupied — send a Colonizer to claim it.",
    };
  }
  const cap = captureMiniPlanet(universe, playerId, planet);
  if (!cap.ok) {
    return { ok: false, error: cap.error };
  }
  report.miniResolved = "capture";
  report.miniResolveAvailable = false;
  report.summary = `${report.summary} Mini planet captured.`;
  universe.reports[report.id] = report;
  return { ok: true, planet, choice: "capture" };
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

/** Relic World: research time factor for empire (1 if none owned). */
export function empireRelicResearchTimeFactor(
  universe: UniverseState,
  playerId: string,
): number {
  if (playerOwnsMiniKind(universe, playerId, "relic")) {
    return MINI_RELIC_RESEARCH_TIME;
  }
  return 1;
}

/** Relic World: expedition find mult for empire. */
export function empireRelicExpeditionFindMult(
  universe: UniverseState,
  playerId: string,
): number {
  if (playerOwnsMiniKind(universe, playerId, "relic")) {
    return MINI_RELIC_EXPEDITION_FIND;
  }
  return 1;
}

/**
 * Periodic drift: minis shift system within the galaxy; ownership kept.
 */
export function tickMiniDrift(universe: UniverseState, now: number): void {
  const seed = universe.seed ?? universe.id;
  let budgetHit = false;
  for (const id of universe.miniPlanetIds ?? []) {
    if (budgetHit) break;
    const planet = universe.planets[id];
    if (!planet || !isMiniPlanet(planet)) continue;
    const last = planet.lastDriftAt ?? planet.lastTickAt ?? now;
    if (now - last < MINI_DRIFT_INTERVAL_MS) continue;

    const steps = Math.floor((now - last) / MINI_DRIFT_INTERVAL_MS);
    let system = planet.coords.system;
    let drifted = false;
    let done = 0;
    for (let i = 0; i < steps; i++) {
      if (!consumeTickBudget("driftSteps")) {
        budgetHit = true;
        break;
      }
      done += 1;
      const delta =
        (hashSeed(`${seed}:drift:${id}:${last}:${i}`) %
          (MINI_DRIFT_SYSTEM_STEP * 2 + 1)) -
        MINI_DRIFT_SYSTEM_STEP;
      if (delta === 0) continue;
      const next = Math.min(MAP_SYSTEMS, Math.max(1, system + delta));
      if (next === system) continue;
      const nextCoords = {
        galaxy: planet.coords.galaxy,
        system: next,
        slot: planet.coords.slot,
      };
      const blocker = planetAtCoords(universe, nextCoords);
      if (blocker && blocker.id !== planet.id) continue;
      system = next;
      drifted = true;
    }
    // Unfinished steps stay due: lastDriftAt only covers steps actually taken.
    planet.lastDriftAt = last + done * MINI_DRIFT_INTERVAL_MS;
    if (drifted) {
      const prev = { ...planet.coords };
      planet.coords = {
        galaxy: planet.coords.galaxy,
        system,
        slot: planet.coords.slot,
      };
      notePlanetMoved(universe, planet, prev);
      planet.name = displayNameForKind(
        miniKindOf(planet),
        planet.coords.galaxy,
        planet.coords.system,
        planet.coords.slot,
      );
    }
    universe.planets[id] = planet;
    if (done < steps) budgetHit = true;
  }
}

export type MiniRelocateResult =
  | { ok: true; planet: PlanetState; landed: Coordinates; cost: number }
  | { ok: false; error: string };

/** Landing window for UI: chosen aim ± accuracy, clamped to 1–MAP_SYSTEMS. */
export function fortressRelocateLandingWindow(
  chosenGalaxy: number,
  chosenSystem: number,
): { galaxy: number; systemMin: number; systemMax: number } {
  const g = Math.min(MAP_GALAXIES, Math.max(1, Math.floor(chosenGalaxy)));
  const s = Math.min(MAP_SYSTEMS, Math.max(1, Math.floor(chosenSystem)));
  return {
    galaxy: g,
    systemMin: Math.max(1, s - MINI_FORTRESS_RELOCATE_ACCURACY),
    systemMax: Math.min(MAP_SYSTEMS, s + MINI_FORTRESS_RELOCATE_ACCURACY),
  };
}

export function fortressRelocateDeutCost(
  from: Coordinates,
  chosenGalaxy: number,
  chosenSystem: number,
): number {
  const dg = Math.abs(Math.floor(chosenGalaxy) - from.galaxy);
  const ds = Math.abs(Math.floor(chosenSystem) - from.system);
  return (
    MINI_FORTRESS_RELOCATE_DEUT_BASE +
    dg * MINI_FORTRESS_RELOCATE_DEUT_PER_GALAXY +
    ds * MINI_FORTRESS_RELOCATE_DEUT_PER_SYSTEM
  );
}

/**
 * Moving Fortress jump: aim at galaxy/system (galaxy ±1 max), pay deut,
 * land random system within ±ACCURACY of aim (clamped 1–399), free mini slot.
 */
export function relocateMovingFortress(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  targetGalaxy: number,
  targetSystem: number,
  now: number,
): MiniRelocateResult {
  const planet = universe.planets[planetId];
  const player = universe.players[playerId];
  if (!planet || !player || !isMovingFortress(planet)) {
    return { ok: false, error: "Not a Moving Fortress you can relocate." };
  }
  if (planet.ownerPlayerId !== playerId) {
    return { ok: false, error: "You do not own this fortress." };
  }
  const aimG = Math.floor(targetGalaxy);
  const aimS = Math.floor(targetSystem);
  if (aimG < 1 || aimG > MAP_GALAXIES || aimS < 1 || aimS > MAP_SYSTEMS) {
    return { ok: false, error: "Invalid target galaxy/system." };
  }
  const galaxyDelta = Math.abs(aimG - planet.coords.galaxy);
  if (galaxyDelta > MINI_FORTRESS_RELOCATE_GALAXY_RANGE) {
    return {
      ok: false,
      error: `Jump limited to current galaxy or ±${MINI_FORTRESS_RELOCATE_GALAXY_RANGE} galaxy.`,
    };
  }
  if (galaxyDelta === 0 && aimS === planet.coords.system) {
    return { ok: false, error: "Already in that system." };
  }
  const cost = fortressRelocateDeutCost(planet.coords, aimG, aimS);
  if (Math.floor(planet.resources.deuterium) < cost) {
    return { ok: false, error: `Need ${cost} deuterium on the fortress.` };
  }

  const window = fortressRelocateLandingWindow(aimG, aimS);
  const span = window.systemMax - window.systemMin + 1;
  const landedSystem =
    window.systemMin +
    (hashSeed(
      `${universe.seed ?? universe.id}:fort-land:${planet.id}:${now}:${aimG}:${aimS}`,
    ) %
      span);

  let landedSlot: number | null = null;
  for (let attempt = 0; attempt < MINI_SLOT_MAX - MINI_SLOT_MIN + 1; attempt++) {
    const slot = pickFreeMiniSlot(
      universe,
      aimG,
      landedSystem,
      `${planet.id}:fort-slot:${now}:${attempt}`,
    );
    if (slot == null) break;
    // pickFreeMiniSlot already ensures empty; use first hit
    landedSlot = slot;
    break;
  }
  if (landedSlot == null) {
    // Try other systems in the landing window for a free mini slot.
    for (let s = window.systemMin; s <= window.systemMax; s++) {
      const slot = pickFreeMiniSlot(
        universe,
        aimG,
        s,
        `${planet.id}:fort-slot-scan:${now}:${s}`,
      );
      if (slot != null) {
        const nextCoords: Coordinates = {
          galaxy: aimG,
          system: s,
          slot,
        };
        planet.resources.deuterium -= cost;
        planet.coords = nextCoords;
        planet.name = displayNameForKind(
          "fortress",
          nextCoords.galaxy,
          nextCoords.system,
          nextCoords.slot,
        );
        planet.lastDriftAt = now;
        universe.planets[planet.id] = planet;
        return { ok: true, planet, landed: nextCoords, cost };
      }
    }
    return {
      ok: false,
      error: "No free mini slot in the landing window.",
    };
  }

  const nextCoords: Coordinates = {
    galaxy: aimG,
    system: landedSystem,
    slot: landedSlot,
  };
  planet.resources.deuterium -= cost;
  planet.coords = nextCoords;
  planet.name = displayNameForKind(
    "fortress",
    nextCoords.galaxy,
    nextCoords.system,
    nextCoords.slot,
  );
  planet.lastDriftAt = now;
  universe.planets[planet.id] = planet;
  return { ok: true, planet, landed: nextCoords, cost };
}
