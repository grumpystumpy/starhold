import {
  HOME_SLOT_PREFERENCE,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  SHIP_ORDER,
  STARTING_RESOURCES,
  UNIVERSE_SCHEMA_VERSION,
} from "./catalog.js";
import {
  coordsKey,
  emptyDefenses,
  emptyFleetShips,
  emptyResearch,
  rollPlanetFields,
} from "./formulas.js";
import type {
  Coordinates,
  PlanetState,
  PlayerState,
  Resources,
  UniverseState,
} from "./types.js";
import { seedUniverseAsteroids } from "./world-asteroids.js";
import { ensurePlayerFleetPresets } from "./world-fleet-presets.js";
import { seedUniversePirates } from "./world-pirates.js";

export function emptyBuildings(): PlanetState["buildings"] {
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
  };
}

export function emptyShips(): PlanetState["ships"] {
  return emptyFleetShips();
}

export function emptyCargo(): Resources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

export function fieldsSeedForCoords(
  universeSeed: string,
  coords: Coordinates,
): string {
  return `${universeSeed}:fields:${coords.galaxy}:${coords.system}:${coords.slot}`;
}

export function createUniverse(
  name = "Alpha Drift",
  speed = 1,
  fleetSpeed = speed,
): UniverseState {
  const now = Date.now();
  const id = `uni_${now.toString(36)}`;
  const universe: UniverseState = {
    id,
    name,
    speed,
    fleetSpeed,
    createdAt: now,
    schemaVersion: UNIVERSE_SCHEMA_VERSION,
    seed: `seed_${id}`,
    players: {},
    planets: {},
    fleets: {},
    reports: {},
    spyReports: {},
    expeditionReports: {},
    debris: {},
    asteroids: {},
    pirateBases: {},
    occupations: {},
    miniPlanetIds: [],
  };
  seedUniverseAsteroids(universe);
  seedUniversePirates(universe, now);
  return universe;
}

export function nextCoords(universe: UniverseState): Coordinates {
  const used = new Set(
    Object.values(universe.planets)
      .filter((p) => p.kind !== "moon")
      .map((p) => coordsKey(p.coords)),
  );
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      for (const slot of HOME_SLOT_PREFERENCE) {
        if (slot < 1 || slot > MAP_SLOTS) continue;
        const key = `${galaxy}:${system}:${slot}`;
        if (!used.has(key)) {
          return { galaxy, system, slot };
        }
      }
    }
  }
  throw new Error("Universe planet slots are full.");
}

export function planetAtCoords(
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

export function moonAtCoords(
  universe: UniverseState,
  coords: Coordinates,
): PlanetState | null {
  const key = coordsKey(coords);
  return (
    Object.values(universe.planets).find(
      (p) => p.kind === "moon" && coordsKey(p.coords) === key,
    ) ?? null
  );
}

export function ensureUniverseShape(universe: UniverseState): void {
  if (!universe.fleets) universe.fleets = {};
  if (!universe.reports) universe.reports = {};
  if (!universe.spyReports) universe.spyReports = {};
  if (!universe.expeditionReports) universe.expeditionReports = {};
  if (!universe.debris) universe.debris = {};
  if (!universe.asteroids) universe.asteroids = {};
  if (!universe.pirateBases) universe.pirateBases = {};
  if (!universe.occupations) universe.occupations = {};
  if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
  if (!universe.fleetSpeed) universe.fleetSpeed = universe.speed || 1;
  if (!universe.seed) universe.seed = `seed_${universe.id}`;
  for (const player of Object.values(universe.players)) {
    if (!player.planetIds?.length) {
      player.planetIds = [player.homePlanetId];
    }
    if (!player.activePlanetId) {
      player.activePlanetId = player.homePlanetId;
    }
    if (!player.research) player.research = emptyResearch();
    if (player.research.swarmHold === undefined) player.research.swarmHold = 0;
    if (player.research.queueLogistics === undefined) player.research.queueLogistics = 0;
    if (player.research.queueLogistics == null) player.research.queueLogistics = 0;
    if (player.research.swarmHold == null) player.research.swarmHold = 0;
    if (!Array.isArray(player.researchQueue)) {
      player.researchQueue = player.researchQueue
        ? [player.researchQueue as never]
        : [];
    }
    if (player.starshards === undefined) player.starshards = 0;
    if (!player.officers) player.officers = [];
    if (!player.skillsUnlocked) player.skillsUnlocked = [];
    if (player.highscoreStarshardsClaimed === undefined) {
      player.highscoreStarshardsClaimed = false;
    }
    if (player.level == null || player.level < 1) player.level = 1;
    if (player.xp == null || player.xp < 0) player.xp = 0;
    if (player.xpTotal == null || player.xpTotal < 0) player.xpTotal = 0;
    ensurePlayerFleetPresets(player);
  }
  const seed = universe.seed ?? universe.id;
  for (const planet of Object.values(universe.planets)) {
    if (!planet.kind) planet.kind = "planet";
    if (planet.parentPlanetId === undefined) planet.parentPlanetId = null;
    if (planet.moonId === undefined) planet.moonId = null;
    if (!planet.defenses) planet.defenses = emptyDefenses();
    if (!Array.isArray(planet.buildQueue)) {
      planet.buildQueue = planet.buildQueue ? [planet.buildQueue as never] : [];
    }
    if (!Array.isArray(planet.shipQueue)) {
      planet.shipQueue = planet.shipQueue ? [planet.shipQueue as never] : [];
    }
    if (!Array.isArray(planet.defenseQueue)) {
      planet.defenseQueue = planet.defenseQueue
        ? [planet.defenseQueue as never]
        : [];
    }
    if (!planet.buildings.researchLab) planet.buildings.researchLab = 0;
    if (!planet.buildings.lunarBase) planet.buildings.lunarBase = 0;
    if (!planet.buildings.sensorArray) planet.buildings.sensorArray = 0;
    if (!planet.buildings.jumpGate) planet.buildings.jumpGate = 0;
    if (!planet.buildings.chronoLathe) planet.buildings.chronoLathe = 0;
    if (
      planet.kind !== "moon" &&
      (typeof planet.fieldsCap !== "number" || planet.fieldsCap <= 0)
    ) {
      planet.fieldsCap = rollPlanetFields(
        planet.coords.slot,
        fieldsSeedForCoords(seed, planet.coords),
      );
    }
    for (const id of SHIP_ORDER) {
      if (planet.ships[id] === undefined) planet.ships[id] = 0;
    }
    if (!planet.ownerPlayerId) {
      const owner = Object.values(universe.players).find(
        (p) =>
          p.homePlanetId === planet.id || p.planetIds?.includes(planet.id),
      );
      planet.ownerPlayerId = owner?.id ?? "";
    }
  }
}

export function joinUniverse(
  universe: UniverseState,
  playerName: string,
  now = Date.now(),
): { player: PlayerState; planet: PlanetState } {
  ensureUniverseShape(universe);
  const trimmed = playerName.trim().slice(0, 24);
  if (!trimmed) {
    throw new Error("Commander name is required.");
  }
  const existing = Object.values(universe.players).find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) {
    const planet =
      universe.planets[existing.activePlanetId] ??
      universe.planets[existing.homePlanetId];
    if (!planet) throw new Error("Player home planet missing.");
    return { player: existing, planet };
  }

  const playerId = `plyr_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const planetId = `plnt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const coords = nextCoords(universe);
  const seed = universe.seed ?? universe.id;
  const fieldsCap = rollPlanetFields(
    coords.slot,
    fieldsSeedForCoords(seed, coords),
  );

  const planet: PlanetState = {
    id: planetId,
    ownerPlayerId: playerId,
    name: `${trimmed}'s Outpost`,
    coords,
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    fieldsCap,
    resources: { ...STARTING_RESOURCES },
    lastTickAt: now,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    defenses: emptyDefenses(),
    buildQueue: [],
    shipQueue: [],
    defenseQueue: [],
  };

  planet.buildings.metalMine = 1;
  planet.buildings.crystalMine = 1;
  planet.buildings.solarPlant = 1;

  const player: PlayerState = {
    id: playerId,
    name: trimmed,
    homePlanetId: planetId,
    planetIds: [planetId],
    activePlanetId: planetId,
    research: emptyResearch(),
    researchQueue: [],
    createdAt: now,
    level: 1,
    xp: 0,
    xpTotal: 0,
    starshards: 0,
    officers: [],
    skillsUnlocked: [],
    highscoreStarshardsClaimed: false,
    fleetPresets: [],
  };
  ensurePlayerFleetPresets(player);

  universe.players[playerId] = player;
  universe.planets[planetId] = planet;
  return { player, planet };
}

export function activePlanet(
  universe: UniverseState,
  player: PlayerState,
): PlanetState | null {
  const id = player.activePlanetId || player.homePlanetId;
  return universe.planets[id] ?? universe.planets[player.homePlanetId] ?? null;
}

export function bestLabLevel(universe: UniverseState, player: PlayerState): number {
  let best = 0;
  for (const id of player.planetIds) {
    const p = universe.planets[id];
    if (p) best = Math.max(best, p.buildings.researchLab ?? 0);
  }
  return best;
}
