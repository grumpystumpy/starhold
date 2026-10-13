import { BUILDINGS, DEFENSES, SHIPS } from "./catalog.js";
import {
  MOON_FIELDS_BASE,
  MOON_FIELDS_PER_LUNAR_BASE,
} from "./catalog.js";
import {
  buildingAllowedOn,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  defenseBuildSeconds,
  defenseCost,
  fieldsRemaining,
  fieldsUsed,
  levelBonuses,
  shipBuildSeconds,
  shipCost,
  spend,
} from "./formulas.js";
import type {
  BuildingId,
  DefenseId,
  FleetMission,
  PlanetState,
  PlayerState,
  ShipId,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";

export type ActionResult =
  | { ok: true; planet: PlanetState }
  | { ok: false; error: string };

export type FleetActionResult =
  | { ok: true; fleet: FleetMission; planet: PlanetState }
  | { ok: false; error: string };

export function resolveActionPlanet(
  universe: UniverseState,
  player: PlayerState,
  planetId?: string,
): PlanetState | null {
  const id = planetId || player.activePlanetId || player.homePlanetId;
  if (!player.planetIds.includes(id)) return null;
  return universe.planets[id] ?? null;
}

export function setActivePlanet(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  player.activePlanetId = planetId;
  universe.players[playerId] = player;
  return { ok: true, planet };
}

export function queueBuildingUpgrade(
  universe: UniverseState,
  playerId: string,
  buildingId: BuildingId,
  now = Date.now(),
  planetId?: string,
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!BUILDINGS[buildingId]) return { ok: false, error: "Unknown building." };

  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (!buildingAllowedOn(planet, buildingId)) {
    return {
      ok: false,
      error: planet.kind === "moon"
        ? "That structure cannot be built on a moon."
        : "That structure can only be built on a moon.",
    };
  }
  if (buildingId === "sensorArray" && (planet.buildings.lunarBase ?? 0) < 1) {
    return { ok: false, error: "Horizon Scanner needs Crater Hab level 1." };
  }
  if (buildingId === "jumpGate" && (planet.buildings.lunarBase ?? 0) < 1) {
    return { ok: false, error: "Fold Bridge needs Crater Hab level 1." };
  }
  if (planet.buildQueue) {
    return { ok: false, error: "A building is already under construction." };
  }

  const current = planet.buildings[buildingId] ?? 0;
  if (buildingId === "lunarBase") {
    const nextCap =
      MOON_FIELDS_BASE + (current + 1) * MOON_FIELDS_PER_LUNAR_BASE;
    if (nextCap < fieldsUsed(planet) + 1) {
      return { ok: false, error: "No free planet fields remaining." };
    }
  } else if (fieldsRemaining(planet) < 1) {
    return { ok: false, error: "No free planet fields remaining." };
  }

  const cost = buildingUpgradeCost(buildingId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const lb = levelBonuses(player.level ?? 1);
  const seconds = Math.max(
    1,
    Math.ceil(
      (buildingUpgradeSeconds(buildingId, current) * lb.buildTime) /
        universe.speed,
    ),
  );

  planet.resources = spend(planet.resources, cost);
  planet.buildQueue = {
    kind: "building",
    buildingId,
    targetLevel: current + 1,
    completesAt: now + seconds * 1000,
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

export function queueShipBuild(
  universe: UniverseState,
  playerId: string,
  shipId: ShipId,
  count: number,
  now = Date.now(),
  planetId?: string,
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = SHIPS[shipId];
  if (!def) return { ok: false, error: "Unknown ship." };
  const qty = Math.floor(count);
  if (qty < 1 || qty > 50) {
    return { ok: false, error: "Build between 1 and 50 ships at a time." };
  }

  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.shipQueue) {
    return { ok: false, error: "Shipyard is already busy." };
  }

  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`,
    };
  }

  const cost = shipCost(shipId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const lb = levelBonuses(player.level ?? 1);
  const seconds = Math.max(
    1,
    Math.ceil(
      (shipBuildSeconds(shipId, qty, yard) * lb.shipBuild) / universe.speed,
    ),
  );

  planet.resources = spend(planet.resources, cost);
  planet.shipQueue = {
    kind: "ship",
    shipId,
    count: qty,
    completesAt: now + seconds * 1000,
    unitSeconds: Math.ceil(seconds / qty),
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

export function queueDefenseBuild(
  universe: UniverseState,
  playerId: string,
  defenseId: DefenseId,
  count: number,
  now = Date.now(),
  planetId?: string,
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = DEFENSES[defenseId];
  if (!def) return { ok: false, error: "Unknown defense." };
  const qty = Math.floor(count);
  if (qty < 1 || qty > 50) {
    return { ok: false, error: "Build between 1 and 50 defenses at a time." };
  }

  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.defenseQueue) {
    return { ok: false, error: "Defense yard is already busy." };
  }

  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`,
    };
  }

  const cost = defenseCost(defenseId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const seconds = Math.max(
    1,
    Math.ceil(defenseBuildSeconds(defenseId, qty, yard) / universe.speed),
  );

  planet.resources = spend(planet.resources, cost);
  planet.defenseQueue = {
    kind: "defense",
    defenseId,
    count: qty,
    completesAt: now + seconds * 1000,
    unitSeconds: Math.ceil(seconds / qty),
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}
