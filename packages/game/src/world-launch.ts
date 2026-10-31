import { SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  canAfford,
  classBonuses,
  fleetShipCount,
  flightSecondsOneWay,
  fuelCostOneWay,
  isStationaryShip,
  jumpGateCooldownMs,
  levelBonuses,
  lineDrummerFleetSpeedMult,
  maxFleetSlots,
  normalizeFleetShips,
  recyclerHullScale,
  spend,
  travelBonusMult,
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
import { playerBoosts } from "./world-boosts.js";
import { emptyCargo, ensureUniverseShape } from "./world-bootstrap.js";
import type { FleetActionResult } from "./world-queues.js";
import { resolveActionPlanet } from "./world-queues.js";
import { attachFleetToAcs } from "./world-acs.js";
import { resolveLaunchTarget } from "./world-launch-target.js";
import { empireDriftBeaconCount } from "./world-mini.js";

const MISSIONS: MissionType[] = [
  "deploy",
  "raid",
  "transport",
  "espionage",
  "colonize",
  "harvest",
  "harvestAsteroid",
  "expedition",
  "pirateRaid",
  "alienRaid",
  "jump",
  "occupy",
];

export interface LaunchFleetOpts {
  playerId: string;
  mission: MissionType;
  ships: Partial<FleetShips>;
  targetPlanetId?: string;
  targetCoords?: Coordinates;
  asteroidId?: string;
  pirateBaseId?: string;
  alienBaseId?: string;
  cargo?: Partial<Resources>;
  now?: number;
  originPlanetId?: string;
  /** Open a new Joint Strike (ACS) group with this fleet as leader. */
  openAcs?: boolean;
  /** Join an existing open ACS group. */
  acsGroupId?: string;
}

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
  for (const id of SHIP_ORDER) {
    if ((ships[id] ?? 0) > 0 && isStationaryShip(id)) {
      return {
        ok: false,
        error: `${SHIPS[id].name} cannot join fleets (stationary).`,
      };
    }
  }

  advanceUniverse(universe, now);
  const origin = resolveActionPlanet(universe, player, opts.originPlanetId);
  if (!origin) return { ok: false, error: "Planet missing." };

  const boosts = playerBoosts(player, now);
  const cls = classBonuses(player.playerClass?.classId);
  const slotCap =
    maxFleetSlots(player.research.computerTech) +
    boosts.fleetSlots +
    cls.fleetSlots +
    empireDriftBeaconCount(universe, player.id);
  const activeFleets = Object.values(universe.fleets).filter(
    (f) => f.ownerPlayerId === player.id,
  ).length;
  if (activeFleets >= slotCap) {
    return {
      ok: false,
      error: `Fleet slot limit reached (Fleet OS → ${slotCap} slots).`,
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
    opts.asteroidId,
    opts.pirateBaseId,
    opts.alienBaseId,
  );
  if (!target.ok) return target;
  const {
    targetCoords,
    targetPlanet,
    targetPlayerId,
    targetAsteroidId,
    targetPirateBaseId,
    targetAlienBaseId,
  } = target;

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
    const cap = fleetCargoCapacityForHarvest(
      ships,
      player.research.cargoHoldTech ?? 0,
    );
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

  if (opts.mission === "jump") {
    if ((origin.jumpReadyAt ?? 0) > now) {
      const wait = Math.ceil(((origin.jumpReadyAt ?? 0) - now) / 1000);
      return {
        ok: false,
        error: `Fold Bridge cooling down (${wait}s remaining).`,
      };
    }
  }

  const lb = levelBonuses(player.level ?? 1);
  let fleetSpeedMult =
    Math.max(0.01, boosts.fleetSpeed) *
    cls.fleetSpeed *
    lineDrummerFleetSpeedMult(ships);
  const onlyProbes =
    (ships.probe ?? 0) > 0 &&
    !SHIP_ORDER.some((id) => id !== "probe" && (ships[id] ?? 0) > 0);
  if (onlyProbes) fleetSpeedMult *= cls.probeSpeed;
  const onlyColony =
    ((ships.colonyShip ?? 0) > 0 || (ships.foundationArk ?? 0) > 0) &&
    !SHIP_ORDER.some(
      (id) =>
        id !== "colonyShip" &&
        id !== "foundationArk" &&
        (ships[id] ?? 0) > 0,
    );
  if (onlyColony) fleetSpeedMult *= cls.colonyShipSpeed;
  const travel = travelBonusMult(
    universe,
    player.id,
    origin.id,
    targetPlanet?.id ?? null,
  );
  fleetSpeedMult *= travel.fleetSpeed;
  const hullScale = recyclerHullScale(travel.recyclerSpeed);
  const oneWay =
    opts.mission === "jump"
      ? 1
      : flightSecondsOneWay(
          origin.coords,
          targetCoords,
          ships,
          // Stack: base → combustion → level → officers/skills → class → Line Drummer
          // → alliance speed / own-world speed.
          (universe.fleetSpeed * fleetSpeedMult) /
            Math.max(0.01, lb.fleetTime),
          player.research.combustionDrive ?? 0,
          hullScale,
          player.research.fleetSpeedTech ?? 0,
        );
  const fleetId = `flt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const fleet: FleetMission = {
    id: fleetId,
    ownerPlayerId: player.id,
    originPlanetId: origin.id,
    targetPlanetId: targetPlanet?.id ?? null,
    targetPlayerId,
    targetCoords,
    targetAsteroidId,
    targetPirateBaseId,
    targetAlienBaseId,
    mission: opts.mission,
    ships: { ...ships },
    cargo: { ...cargo },
    departedAt: now,
    arrivesAt: now + oneWay * 1000,
    phase: "outbound",
    reportId: null,
  };

  if (opts.mission === "jump") {
    origin.jumpReadyAt = now + jumpGateCooldownMs(player, universe);
  }

  universe.fleets[fleetId] = fleet;
  universe.planets[origin.id] = origin;

  if (opts.openAcs || opts.acsGroupId) {
    const acs = attachFleetToAcs(
      universe,
      fleet,
      { openAcs: opts.openAcs, acsGroupId: opts.acsGroupId },
      now,
    );
    if (!acs.ok) {
      // Roll back launch so the caller can retry without ACS.
      for (const id of SHIP_ORDER) {
        origin.ships[id] = (origin.ships[id] ?? 0) + (ships[id] ?? 0);
      }
      origin.resources = {
        ...origin.resources,
        deuterium: origin.resources.deuterium + fuel,
      };
      if (opts.mission === "transport") {
        origin.resources = {
          metal: origin.resources.metal + cargo.metal,
          crystal: origin.resources.crystal + cargo.crystal,
          deuterium: origin.resources.deuterium + cargo.deuterium,
        };
      }
      delete universe.fleets[fleetId];
      universe.planets[origin.id] = origin;
      return acs;
    }
  }

  if (targetPirateBaseId || targetAlienBaseId) {
    player.attackedPiratesAt = now;
  }
  if (
    opts.mission === "raid" &&
    targetPlayerId &&
    targetPlayerId !== player.id &&
    universe.players[targetPlayerId]
  ) {
    player.newbieForfeitedAt ??= now;
  }

  return { ok: true, fleet, planet: origin };
}
