import { BUILDINGS, DEFENSES, SHIPS } from "./catalog.js";
import {
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  CHRONO_LATHE_SHIPYARD_REQ,
  MANTLE_LOOM_LAB_REQ,
  MANTLE_LOOM_SOLAR_REQ,
  MOON_FIELDS_BASE,
  MOON_FIELDS_PER_LUNAR_BASE,
  RIG_FOUNDRY_SHIPYARD_REQ,
} from "./catalog.js";
import {
  buildingAllowedOn,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  classBonuses,
  defenseCost,
  defenseUnitBuildSeconds,
  fieldsRemaining,
  fieldsUsed,
  levelBonuses,
  shipClassAllowed,
  shipCost,
  shipResearchReqMet,
  shipUnitBuildSeconds,
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
import { isPlanetOccupied } from "./world-occupation.js";
import { yardQueueCap } from "./world-queue-caps.js";
import {
  ensureQueueFrontStarted,
  newQueueItemId,
} from "./world-queue-normalize.js";

export type ActionResult =
  | { ok: true; planet: PlanetState }
  | { ok: false; error: string };

export type FleetActionResult =
  | { ok: true; fleet: FleetMission; planet: PlanetState }
  | { ok: false; error: string };

/**
 * Chrono Lathe level (Thread J). H left a Nanite Factory hook; Chrono Lathe
 * is the Round 2 building that fills it (`0.1^level` via constructionTimeMultiplier).
 */
export function naniteFactoryLevel(planet: PlanetState): number {
  return Math.max(0, Math.floor(planet.buildings.chronoLathe ?? 0));
}

/** Alias for call sites / tests that prefer the Chrono Lathe name. */
export const chronoLatheLevel = naniteFactoryLevel;

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
  if (isPlanetOccupied(universe, planet.id, now)) {
    return { ok: false, error: "Construction blocked while planet is occupied." };
  }
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
  if (buildingId === "rigFoundry") {
    const yard = planet.buildings.shipyard ?? 0;
    if (yard < RIG_FOUNDRY_SHIPYARD_REQ) {
      return {
        ok: false,
        error: `Rig Foundry needs Shipyard level ${RIG_FOUNDRY_SHIPYARD_REQ} (you have ${yard}).`,
      };
    }
  }
  if (buildingId === "mantleLoom") {
    if (planet.kind === "moon") {
      return { ok: false, error: "Mantle Loom cannot be built on moons." };
    }
    const solar = planet.buildings.solarPlant ?? 0;
    const lab = planet.buildings.researchLab ?? 0;
    if (solar < MANTLE_LOOM_SOLAR_REQ) {
      return {
        ok: false,
        error: `Mantle Loom needs Solar Array level ${MANTLE_LOOM_SOLAR_REQ} (you have ${solar}).`,
      };
    }
    if (lab < MANTLE_LOOM_LAB_REQ) {
      return {
        ok: false,
        error: `Mantle Loom needs Research Lab level ${MANTLE_LOOM_LAB_REQ} (you have ${lab}).`,
      };
    }
  }
  if (buildingId === "chronoLathe") {
    const yard = planet.buildings.shipyard ?? 0;
    const foundry = planet.buildings.rigFoundry ?? 0;
    if (yard < CHRONO_LATHE_SHIPYARD_REQ) {
      return {
        ok: false,
        error: `Chrono Lathe needs Shipyard level ${CHRONO_LATHE_SHIPYARD_REQ} (you have ${yard}).`,
      };
    }
    if (foundry < CHRONO_LATHE_RIG_FOUNDRY_REQ) {
      return {
        ok: false,
        error: `Chrono Lathe needs Rig Foundry level ${CHRONO_LATHE_RIG_FOUNDRY_REQ} (you have ${foundry}).`,
      };
    }
  }

  const cap = yardQueueCap(player, now);
  if (planet.buildQueue.length >= cap) {
    return {
      ok: false,
      error: `Building queue is full (${planet.buildQueue.length}/${cap}).`,
    };
  }

  const pendingSame = planet.buildQueue.filter(
    (q) => q.buildingId === buildingId,
  ).length;
  const current = (planet.buildings[buildingId] ?? 0) + pendingSame;
  const targetLevel = current + 1;

  if (buildingId === "lunarBase") {
    const nextCap =
      MOON_FIELDS_BASE + targetLevel * MOON_FIELDS_PER_LUNAR_BASE;
    if (nextCap < fieldsUsed(planet) + 1) {
      return { ok: false, error: "No free planet fields remaining." };
    }
  } else {
    const pendingFieldUsers = planet.buildQueue.filter(
      (q) => q.buildingId !== "lunarBase",
    ).length;
    if (fieldsRemaining(planet) < pendingFieldUsers + 1) {
      return { ok: false, error: "No free planet fields remaining." };
    }
  }

  const cost = buildingUpgradeCost(buildingId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const lb = levelBonuses(player.level ?? 1);
  const cls = classBonuses(player.playerClass?.classId);
  // Chrono Lathe does not accelerate itself (avoid recursive free builds).
  const naniteLevel =
    buildingId === "chronoLathe" ? 0 : naniteFactoryLevel(planet);
  const rigLevel =
    buildingId === "chronoLathe" || buildingId === "rigFoundry"
      ? 0
      : (planet.buildings.rigFoundry ?? 0);
  const seconds =
    (buildingUpgradeSeconds(buildingId, current, naniteLevel, rigLevel) *
      lb.buildTime *
      cls.buildingBuildTime) /
    universe.speed;

  planet.resources = spend(planet.resources, cost);
  const startNow = planet.buildQueue.length === 0;
  planet.buildQueue.push({
    id: newQueueItemId(now),
    kind: "building",
    buildingId,
    targetLevel,
    enqueuedAt: now,
    workSeconds: seconds,
    startedAt: startNow ? now : null,
    completesAt: now + seconds * 1000,
    paidCost: { ...cost },
  });
  ensureQueueFrontStarted(planet.buildQueue, now);
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
  if (isPlanetOccupied(universe, planet.id, now)) {
    return { ok: false, error: "Shipyard blocked while planet is occupied." };
  }

  const cap = yardQueueCap(player, now);
  if (planet.shipQueue.length >= cap) {
    return {
      ok: false,
      error: `Ship queue is full (${planet.shipQueue.length}/${cap}).`,
    };
  }

  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`,
    };
  }

  if (!shipClassAllowed(shipId, player.playerClass?.classId ?? null)) {
    const need = def.classExclusive;
    return {
      ok: false,
      error: need
        ? `Requires ${need} class (exclusive hull).`
        : "Class exclusive hull.",
    };
  }

  const researchOk = shipResearchReqMet(shipId, player.research);
  if (!researchOk.ok) return researchOk;

  const cost = shipCost(shipId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }

  const lb = levelBonuses(player.level ?? 1);
  const cls = classBonuses(player.playerClass?.classId);
  const naniteLevel = naniteFactoryLevel(planet);
  const rigLevel = planet.buildings.rigFoundry ?? 0;
  const unitSeconds =
    (shipUnitBuildSeconds(shipId, yard, naniteLevel, rigLevel) *
      lb.shipBuild *
      cls.shipBuildTime) /
    universe.speed;
  const seconds = unitSeconds * qty;

  planet.resources = spend(planet.resources, cost);
  const startNow = planet.shipQueue.length === 0;
  planet.shipQueue.push({
    id: newQueueItemId(now),
    kind: "ship",
    shipId,
    count: qty,
    orderedCount: qty,
    enqueuedAt: now,
    workSeconds: seconds,
    startedAt: startNow ? now : null,
    completesAt: now + seconds * 1000,
    unitSeconds,
    paidCost: { ...cost },
  });
  ensureQueueFrontStarted(planet.shipQueue, now);
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
  if (isPlanetOccupied(universe, planet.id, now)) {
    return { ok: false, error: "Defense yard blocked while planet is occupied." };
  }

  const cap = yardQueueCap(player, now);
  if (planet.defenseQueue.length >= cap) {
    return {
      ok: false,
      error: `Defense queue is full (${planet.defenseQueue.length}/${cap}).`,
    };
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

  const lb = levelBonuses(player.level ?? 1);
  const cls = classBonuses(player.playerClass?.classId);
  const naniteLevel = naniteFactoryLevel(planet);
  const rigLevel = planet.buildings.rigFoundry ?? 0;
  const unitSeconds =
    (defenseUnitBuildSeconds(defenseId, yard, naniteLevel, rigLevel) *
      lb.shipBuild *
      cls.defenseBuildTime) /
    universe.speed;
  const seconds = unitSeconds * qty;

  planet.resources = spend(planet.resources, cost);
  const startNow = planet.defenseQueue.length === 0;
  planet.defenseQueue.push({
    id: newQueueItemId(now),
    kind: "defense",
    defenseId,
    count: qty,
    orderedCount: qty,
    enqueuedAt: now,
    workSeconds: seconds,
    startedAt: startNow ? now : null,
    completesAt: now + seconds * 1000,
    unitSeconds,
    paidCost: { ...cost },
  });
  ensureQueueFrontStarted(planet.defenseQueue, now);
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}
