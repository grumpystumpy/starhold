import { BUILDINGS, DEFENSES, SHIPS } from "./catalog.js";
import {
  buildingUpgradeSeconds,
  canAfford,
  classBonuses,
  allianceBonusesForPlayer,
  defenseCost,
  defenseUnitBuildSeconds,
  levelBonuses,
  scaleResourceCost,
  shipClassAllowed,
  shipCost,
  shipResearchReqMet,
  shipUnitBuildSeconds,
  spend,
} from "./formulas.js";
import { previewBuildingUpgrade } from "./queue-block.js";
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

  const lb = levelBonuses(player.level ?? 1);
  const cls = classBonuses(player.playerClass?.classId);
  const ally = allianceBonusesForPlayer(universe, player.id);
  const preview = previewBuildingUpgrade(planet, player, buildingId, now, {
    costMult: ally.buildingCost,
    fieldMods: {
      homePlanetId: player.homePlanetId,
      colonyFields: cls.colonyFields,
      colonyFieldMult: ally.colonyFieldMult,
    },
  });
  if (!preview.ok) return { ok: false, error: preview.error };
  const { current, targetLevel, cost } = preview;
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
      cls.buildingBuildTime *
      ally.buildingTime) /
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
  const qty = count;
  if (!Number.isInteger(qty) || qty < 1 || qty > 999_999) {
    return { ok: false, error: "Build between 1 and 999,999 ships at a time." };
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

  const lb = levelBonuses(player.level ?? 1);
  const cls = classBonuses(player.playerClass?.classId);
  const ally = allianceBonusesForPlayer(universe, player.id);
  const naniteLevel = naniteFactoryLevel(planet);
  const rigLevel = planet.buildings.rigFoundry ?? 0;
  const anomalyLevel = planet.buildings.anomalyForge ?? 0;
  const cost = scaleResourceCost(shipCost(shipId, qty), ally.shipCost);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }
  const unitSeconds =
    (shipUnitBuildSeconds(shipId, yard, naniteLevel, rigLevel, anomalyLevel) *
      lb.shipBuild *
      cls.shipBuildTime *
      ally.shipTime) /
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
  const qty = count;
  if (!Number.isInteger(qty) || qty < 1 || qty > 999_999) {
    return { ok: false, error: "Build between 1 and 999,999 defenses at a time." };
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
