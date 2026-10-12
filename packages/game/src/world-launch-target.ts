import {
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
} from "./catalog.js";
import { maxColonies } from "./formulas.js";
import type {
  Coordinates,
  FleetShips,
  MissionType,
  PlanetState,
  PlayerState,
  UniverseState,
} from "./types.js";
import { planetAtCoords } from "./world-bootstrap.js";
import { getDebris } from "./world-tick.js";

export type LaunchTargetResult =
  | {
      ok: true;
      targetCoords: Coordinates;
      targetPlanet: PlanetState | null;
      targetPlayerId: string | null;
    }
  | { ok: false; error: string };

export function resolveLaunchTarget(
  universe: UniverseState,
  player: PlayerState,
  origin: PlanetState,
  mission: MissionType,
  ships: FleetShips,
  targetPlanetId: string | undefined,
  targetCoordsOpt: Coordinates | undefined,
): LaunchTargetResult {
  let targetCoords: Coordinates;
  let targetPlanet: PlanetState | null = null;
  let targetPlayerId: string | null = null;

  if (mission === "colonize" || mission === "harvest") {
    if (!targetCoordsOpt) {
      return {
        ok: false,
        error: "targetCoords required for colonize/harvest.",
      };
    }
    targetCoords = { ...targetCoordsOpt };
    if (
      targetCoords.galaxy < 1 ||
      targetCoords.galaxy > MAP_GALAXIES ||
      targetCoords.system < 1 ||
      targetCoords.system > MAP_SYSTEMS ||
      targetCoords.slot < 1 ||
      targetCoords.slot > MAP_SLOTS
    ) {
      return { ok: false, error: "Coordinates out of map bounds." };
    }
    targetPlanet = planetAtCoords(universe, targetCoords);
    if (mission === "colonize") {
      if (targetPlanet) {
        return { ok: false, error: "Slot is already occupied." };
      }
      if ((ships.colonyShip ?? 0) < 1) {
        return { ok: false, error: "Colonize requires a Colony Ship." };
      }
      if (player.planetIds.length >= maxColonies(player.research.astrophysics)) {
        return {
          ok: false,
          error: `Colony limit reached (Astrophysics → ${maxColonies(player.research.astrophysics)} worlds).`,
        };
      }
    } else {
      const field = getDebris(universe, targetCoords);
      if (!field || (field.metal <= 0 && field.crystal <= 0)) {
        return { ok: false, error: "No debris at those coordinates." };
      }
      if ((ships.recycler ?? 0) < 1) {
        return { ok: false, error: "Harvest requires a Recycler." };
      }
    }
  } else {
    if (!targetPlanetId) {
      return { ok: false, error: "targetPlanetId required." };
    }
    targetPlanet = universe.planets[targetPlanetId] ?? null;
    if (!targetPlanet) return { ok: false, error: "Target planet not found." };
    targetCoords = { ...targetPlanet.coords };
    targetPlayerId = targetPlanet.ownerPlayerId;

    if (mission === "transport") {
      if (targetPlanet.ownerPlayerId !== player.id) {
        return { ok: false, error: "Transport only between your planets." };
      }
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot transport to the same planet." };
      }
    } else if (mission === "deploy" || mission === "raid") {
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot send a fleet to your own planet." };
      }
      if (targetPlanet.ownerPlayerId === player.id) {
        return {
          ok: false,
          error: "Use transport to move between your own planets.",
        };
      }
    } else if (mission === "espionage") {
      if (targetPlanet.ownerPlayerId === player.id) {
        return { ok: false, error: "Cannot spy on yourself." };
      }
      if ((ships.probe ?? 0) < 1) {
        return { ok: false, error: "Espionage requires a Spy Probe." };
      }
    }
  }

  return { ok: true, targetCoords, targetPlanet, targetPlayerId };
}
