import { SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  canAfford,
  fleetShipCount,
  flightSecondsOneWay,
  fuelCostOneWay,
  maxFleetSlots,
  normalizeFleetShips,
  spend,
} from "./formulas.js";
import type {
  Coordinates,
  FleetMission,
  FleetShips,
  MissionType,
  Resources,
  UniverseState,
} from "./types.js";
import { fleetCargoCapacityForHarvest, advanceUniverse } from "./world-arrival.js";
import { emptyCargo, ensureUniverseShape } from "./world-bootstrap.js";
import type { FleetActionResult } from "./world-queues.js";
import { resolveActionPlanet } from "./world-queues.js";
import { resolveLaunchTarget } from "./world-launch-target.js";

const MISSIONS: MissionType[] = [
  "deploy",
  "raid",
  "transport",
  "espionage",
  "colonize",
  "harvest",
  "expedition",
];

export interface LaunchFleetOpts {
  playerId: string;
  mission: MissionType;
  ships: Partial<FleetShips>;
  /** Occupied target (raid/deploy/espionage/transport). */
  targetPlanetId?: string;
  /** Empty/debris coords (colonize/harvest) or override. */
  targetCoords?: Coordinates;
  /** Cargo to load for transport. */
  cargo?: Partial<Resources>;
  now?: number;
  originPlanetId?: string;
}

/**
 * Launch a fleet from the player's active (or specified) hangar.
 */
export function launchFleet(
  universe: UniverseState,
  playerId: string,
  targetPlanetId: string,
  mission: MissionType,
  shipsInput: Partial<FleetShips>,
  now?: number,
): FleetActionResult;
export function launchFleet(
  universe: UniverseState,
  opts: LaunchFleetOpts,
): FleetActionResult;
export function launchFleet(
  universe: UniverseState,
  playerIdOrOpts: string | LaunchFleetOpts,
  targetPlanetId?: string,
  mission?: MissionType,
  shipsInput?: Partial<FleetShips>,
  nowArg?: number,
): FleetActionResult {
  const opts: LaunchFleetOpts =
    typeof playerIdOrOpts === "string"
      ? {
          playerId: playerIdOrOpts,
          targetPlanetId,
          mission: mission!,
          ships: shipsInput ?? {},
          now: nowArg,
        }
      : playerIdOrOpts;

  ensureUniverseShape(universe);
  const now = opts.now ?? Date.now();
  const player = universe.players[opts.playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!MISSIONS.includes(opts.mission)) {
    return { ok: false, error: "Unknown mission type." };
  }

  const ships = normalizeFleetShips(opts.ships);
  if (fleetShipCount(ships) < 1) {
    return { ok: false, error: "Select at least one ship." };
  }

  advanceUniverse(universe, now);
  const origin = resolveActionPlanet(universe, player, opts.originPlanetId);
  if (!origin) return { ok: false, error: "Planet missing." };

  const activeFleets = Object.values(universe.fleets).filter(
    (f) => f.ownerPlayerId === player.id,
  ).length;
  if (activeFleets >= maxFleetSlots(player.research.computerTech)) {
    return {
      ok: false,
      error: `Fleet slot limit reached (Computer Tech → ${maxFleetSlots(player.research.computerTech)} slots).`,
    };
  }

  const target = resolveLaunchTarget(
    universe,
    player,
    origin,
    opts.mission,
    ships,
    opts.targetPlanetId,
    opts.targetCoords,
  );
  if (!target.ok) return target;
  const { targetCoords, targetPlanet, targetPlayerId } = target;

  for (const id of SHIP_ORDER) {
    const need = ships[id] ?? 0;
    const have = origin.ships[id] ?? 0;
    if (need > have) {
      return {
        ok: false,
        error: `Not enough ${SHIPS[id].name} in hangar (have ${have}, need ${need}).`,
      };
    }
  }

  let cargo = emptyCargo();
  if (opts.mission === "transport") {
    const want = {
      metal: Math.max(0, Math.floor(opts.cargo?.metal ?? 0)),
      crystal: Math.max(0, Math.floor(opts.cargo?.crystal ?? 0)),
      deuterium: Math.max(0, Math.floor(opts.cargo?.deuterium ?? 0)),
    };
    const cap = fleetCargoCapacityForHarvest(ships);
    const total = want.metal + want.crystal + want.deuterium;
    if (total < 1) {
      return { ok: false, error: "Load at least some cargo to transport." };
    }
    if (total > cap) {
      return { ok: false, error: `Cargo exceeds fleet capacity (${cap}).` };
    }
    if (!canAfford(origin.resources, want)) {
      return { ok: false, error: "Not enough resources to load." };
    }
    cargo = want;
  }

  const fuel = fuelCostOneWay(origin.coords, targetCoords, ships);
  if (Math.floor(origin.resources.deuterium) < fuel) {
    return {
      ok: false,
      error: `Not enough deuterium for fuel (need ${fuel}).`,
    };
  }

  for (const id of SHIP_ORDER) {
    origin.ships[id] = (origin.ships[id] ?? 0) - (ships[id] ?? 0);
  }
  if (opts.mission === "transport") {
    origin.resources = spend(origin.resources, cargo);
  }
  origin.resources = spend(origin.resources, {
    metal: 0,
    crystal: 0,
    deuterium: fuel,
  });

  const oneWay = flightSecondsOneWay(
    origin.coords,
    targetCoords,
    ships,
    universe.fleetSpeed,
    player.research.combustionDrive ?? 0,
  );
  const fleetId = `flt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const fleet: FleetMission = {
    id: fleetId,
    ownerPlayerId: player.id,
    originPlanetId: origin.id,
    targetPlanetId: targetPlanet?.id ?? null,
    targetPlayerId,
    targetCoords,
    mission: opts.mission,
    ships: { ...ships },
    cargo: { ...cargo },
    departedAt: now,
    arrivesAt: now + oneWay * 1000,
    phase: "outbound",
    reportId: null,
  };

  universe.fleets[fleetId] = fleet;
  universe.planets[origin.id] = origin;
  return { ok: true, fleet, planet: origin };
}
