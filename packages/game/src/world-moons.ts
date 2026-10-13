import {
  MOON_CHANCE_CAP,
  MOON_DEBRIS_MIN,
  MOON_FIELDS_BASE,
} from "./catalog.js";
import { emptyDefenses } from "./formulas.js";
import type {
  Coordinates,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";
import { emptyBuildings, emptyShips } from "./world-bootstrap.js";

/** Deterministic 0–99 from a seed string. */
export function moonRoll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

export function moonChancePercent(debris: Resources): number {
  const total = Math.max(0, debris.metal + debris.crystal);
  if (total < MOON_DEBRIS_MIN) return 0;
  return Math.min(MOON_CHANCE_CAP, Math.floor(total / 1000));
}

/**
 * Horizon Scanner (`sensorArray`) range in systems (same galaxy).
 * Level 0 → none; level N → ±N systems inclusive of own system.
 */
export function sensorPhalanxRange(level: number): number {
  return Math.max(0, Math.floor(level));
}

/** True when target coords are inside a Horizon Scanner of the given moon. */
export function inSensorPhalanxRange(
  moonCoords: Coordinates,
  targetCoords: Coordinates,
  sensorLevel: number,
): boolean {
  const range = sensorPhalanxRange(sensorLevel);
  if (range < 1) return false;
  if (moonCoords.galaxy !== targetCoords.galaxy) return false;
  return Math.abs(moonCoords.system - targetCoords.system) <= range;
}

/** Count planets (not moons) toward Stellar Cartography colony cap. */
export function ownedPlanetCount(
  universe: UniverseState,
  playerId: string,
): number {
  const player = universe.players[playerId];
  if (!player) return 0;
  let n = 0;
  for (const id of player.planetIds ?? []) {
    const body = universe.planets[id];
    if (body && body.kind !== "moon") n++;
  }
  return n;
}

/**
 * Maybe form a moon after raid debris. Returns the new moon or null.
 * Mutates universe / parent / owner planetIds.
 */
export function tryFormMoon(
  universe: UniverseState,
  parent: PlanetState,
  debrisCreated: Resources,
  reportId: string,
  now: number,
): PlanetState | null {
  if (parent.kind === "moon") return null;
  if (parent.moonId && universe.planets[parent.moonId]) return null;
  const chance = moonChancePercent(debrisCreated);
  if (chance <= 0) return null;
  const roll = moonRoll(reportId);
  if (roll >= chance) return null;

  const owner = universe.players[parent.ownerPlayerId];
  if (!owner) return null;

  const moonId = `moon_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const moon: PlanetState = {
    id: moonId,
    ownerPlayerId: owner.id,
    name: `${parent.name} Moon`,
    coords: { ...parent.coords },
    kind: "moon",
    parentPlanetId: parent.id,
    moonId: null,
    fieldsCap: MOON_FIELDS_BASE,
    resources: { metal: 0, crystal: 0, deuterium: 0 },
    lastTickAt: now,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    defenses: emptyDefenses(),
    buildQueue: null,
    shipQueue: null,
    defenseQueue: null,
  };

  universe.planets[moonId] = moon;
  parent.moonId = moonId;
  parent.kind = parent.kind ?? "planet";
  universe.planets[parent.id] = parent;
  if (!owner.planetIds.includes(moonId)) {
    owner.planetIds.push(moonId);
  }
  universe.players[owner.id] = owner;
  return moon;
}
