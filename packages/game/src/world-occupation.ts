import {
  OCCUPATION_DURATION_MS,
  OCCUPATION_OCCUPIER_SHARE,
  OCCUPATION_OWNER_SHARE,
} from "./catalog.js";
import { emptyDefenses } from "./formulas.js";
import type {
  FleetMission,
  OccupationState,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";

export { OCCUPATION_OCCUPIER_SHARE, OCCUPATION_OWNER_SHARE };

type ActionResult =
  | { ok: true; planet: PlanetState }
  | { ok: false; error: string };

function defensesCleared(planet: PlanetState): boolean {
  const d = planet.defenses ?? emptyDefenses();
  return (d.laserBattery ?? 0) + (d.shieldDome ?? 0) <= 0;
}

export function pruneExpiredOccupations(
  universe: UniverseState,
  now: number,
): void {
  if (!universe.occupations) {
    universe.occupations = {};
    return;
  }
  for (const [planetId, occ] of Object.entries(universe.occupations)) {
    if (occ.endsAt <= now) {
      delete universe.occupations[planetId];
    }
  }
}

export function occupationForPlanet(
  universe: UniverseState,
  planetId: string,
  now = Date.now(),
): OccupationState | null {
  pruneExpiredOccupations(universe, now);
  return universe.occupations?.[planetId] ?? null;
}

export function isPlanetOccupied(
  universe: UniverseState,
  planetId: string,
  now = Date.now(),
): boolean {
  return occupationForPlanet(universe, planetId, now) !== null;
}

/** Split mine tick rates while occupied: occupier 30% / owner 70%. */
export function occupationMineShares(
  rates: Resources,
): { owner: Resources; occupier: Resources } {
  return {
    owner: {
      metal: rates.metal * OCCUPATION_OWNER_SHARE,
      crystal: rates.crystal * OCCUPATION_OWNER_SHARE,
      deuterium: rates.deuterium * OCCUPATION_OWNER_SHARE,
    },
    occupier: {
      metal: rates.metal * OCCUPATION_OCCUPIER_SHARE,
      crystal: rates.crystal * OCCUPATION_OCCUPIER_SHARE,
      deuterium: rates.deuterium * OCCUPATION_OCCUPIER_SHARE,
    },
  };
}

/**
 * Start occupation after an eligible battle: defenses wiped, ≥1 mothership
 * remains on the attacking fleet still at the target.
 * Caller should `advanceUniverse` first.
 */
export function startOccupation(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  now = Date.now(),
): ActionResult {
  pruneExpiredOccupations(universe, now);
  const fleet = universe.fleets[fleetId];
  if (!fleet || fleet.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  if ((fleet.ships.swarmMothership ?? 0) < 1) {
    return { ok: false, error: "Occupation requires a Swarm Mothership." };
  }
  const planetId = fleet.targetPlanetId;
  if (!planetId) {
    return { ok: false, error: "Fleet has no target planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.ownerPlayerId === playerId) {
    return { ok: false, error: "Cannot occupy your own body." };
  }
  if (!defensesCleared(planet)) {
    return { ok: false, error: "All defenses must be destroyed first." };
  }
  if (universe.occupations?.[planetId]) {
    return { ok: false, error: "Planet is already occupied." };
  }

  const occ: OccupationState = {
    planetId,
    occupierPlayerId: playerId,
    mothershipFleetId: fleetId,
    startedAt: now,
    endsAt: now + OCCUPATION_DURATION_MS,
  };
  if (!universe.occupations) universe.occupations = {};
  universe.occupations[planetId] = occ;
  return { ok: true, planet };
}

/** Caller should `advanceUniverse` first. */
export function abandonOccupation(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  now = Date.now(),
): ActionResult {
  pruneExpiredOccupations(universe, now);
  const occ = universe.occupations?.[planetId];
  if (!occ) return { ok: false, error: "No occupation on that planet." };
  if (occ.occupierPlayerId !== playerId) {
    return { ok: false, error: "Only the occupier can abandon." };
  }
  if (universe.occupations) delete universe.occupations[planetId];
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  return { ok: true, planet };
}

/** Clear occupation when planet owner wins combat / recaptures. */
export function clearOccupationIfRecaptured(
  universe: UniverseState,
  planetId: string,
  winnerPlayerId: string,
): void {
  const occ = universe.occupations?.[planetId];
  if (!occ) return;
  const planet = universe.planets[planetId];
  if (!planet) return;
  if (winnerPlayerId === planet.ownerPlayerId && universe.occupations) {
    delete universe.occupations[planetId];
  }
}

/** Clear occupation when the occupying mothership fleet is gone. */
export function clearOccupationIfFleetGone(
  universe: UniverseState,
  fleet: FleetMission,
): void {
  if (!universe.occupations) return;
  for (const [planetId, occ] of Object.entries(universe.occupations)) {
    if (occ.mothershipFleetId === fleet.id) {
      delete universe.occupations[planetId];
    }
  }
}
