import { EXPEDITION_SLOT, SHIP_ORDER } from "./catalog.js";
import { FLEET_SAVE_MIN_LEAD_MS } from "./data/tuning.js";
import {
  classBonuses,
  maxFleetSlots,
  normalizeFleetShips,
  validateSwarmCarry,
} from "./formulas.js";
import { isStationaryShip } from "./formulas-round3.js";
import { coordDistance } from "./formulas-travel.js";
import type {
  Coordinates,
  FleetMission,
  FleetShips,
  PlanetState,
  PlayerState,
  UniverseState,
} from "./types.js";
import type { FleetSaveSuggestion } from "./types-view.js";
import { playerBoosts } from "./world-boosts.js";
import { resolveLaunchTarget } from "./world-launch-target.js";
import { empireDriftBeaconCount, isMiniPlanet } from "./world-mini.js";

/**
 * Prefills for the fleet-events "Send fleet away" reminder.
 * Reads the hostile list the view already built. Does not launch a fleet.
 */
export function fleetSaveSuggestions(
  universe: UniverseState,
  playerId: string,
  hostile: readonly FleetMission[],
  now: number,
): FleetSaveSuggestion[] {
  const player = universe.players[playerId];
  if (!player) return [];
  const out: FleetSaveSuggestion[] = [];
  for (const fleet of hostile) {
    if (!isSaveableRaid(fleet, playerId, now)) continue;
    const originId = fleet.targetPlanetId;
    if (!originId) continue;
    const origin = universe.planets[originId];
    if (!origin || origin.ownerPlayerId !== playerId) continue;
    const ships = mobileShips(origin);
    if (!ships) continue;
    if (!swarmOk(player, ships)) continue;
    if (!fleetSlotFree(universe, player, now)) continue;
    const haven = nearestHaven(universe, playerId, origin);
    if (haven) {
      out.push({
        attackId: fleet.id,
        originPlanetId: origin.id,
        mission: "deploy",
        ships,
        targetPlanetId: haven.id,
        targetCoords: null,
        arrivesAt: fleet.arrivesAt,
      });
      continue;
    }
    const targetCoords = expeditionCoords(origin);
    if (!expeditionTargetOk(universe, player, origin, ships, targetCoords)) {
      continue;
    }
    out.push({
      attackId: fleet.id,
      originPlanetId: origin.id,
      mission: "expedition",
      ships,
      targetPlanetId: null,
      targetCoords,
      arrivesAt: fleet.arrivesAt,
    });
  }
  return out;
}

function expeditionCoords(origin: PlanetState): Coordinates {
  return {
    galaxy: origin.coords.galaxy,
    system: origin.coords.system,
    slot: EXPEDITION_SLOT,
  };
}

function swarmOk(player: PlayerState, ships: Partial<FleetShips>): boolean {
  return validateSwarmCarry(
    normalizeFleetShips(ships),
    player.research.swarmHold ?? 0,
  ).ok;
}

function fleetSlotFree(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): boolean {
  const boosts = playerBoosts(player, now);
  const cls = classBonuses(player.playerClass?.classId);
  const cap =
    maxFleetSlots(player.research.computerTech ?? 0) +
    boosts.fleetSlots +
    cls.fleetSlots +
    empireDriftBeaconCount(universe, player.id);
  const active = Object.values(universe.fleets).filter(
    (fleet) => fleet.ownerPlayerId === player.id,
  ).length;
  return active < cap;
}

/** Same deep-space rules as launch. A full slot (needs more Stellar Cartography) is unavailable. */
function expeditionTargetOk(
  universe: UniverseState,
  player: PlayerState,
  origin: PlanetState,
  ships: Partial<FleetShips>,
  targetCoords: Coordinates,
): boolean {
  const target = resolveLaunchTarget(
    universe,
    player,
    origin,
    "expedition",
    normalizeFleetShips(ships),
    undefined,
    targetCoords,
  );
  return target.ok;
}

function isSaveableRaid(
  fleet: FleetMission,
  playerId: string,
  now: number,
): boolean {
  if (fleet.ownerPlayerId === playerId) return false;
  if (fleet.phase !== "outbound") return false;
  if (fleet.mission !== "raid") return false;
  if (fleet.targetPlayerId !== playerId) return false;
  return fleet.arrivesAt - now > FLEET_SAVE_MIN_LEAD_MS;
}

function mobileShips(origin: PlanetState): Partial<FleetShips> | null {
  const ships: Partial<FleetShips> = {};
  let any = false;
  for (const id of SHIP_ORDER) {
    const n = Math.max(0, Math.floor(origin.ships[id] ?? 0));
    if (n < 1 || isStationaryShip(id)) continue;
    ships[id] = n;
    any = true;
  }
  return any ? ships : null;
}

function nearestHaven(
  universe: UniverseState,
  playerId: string,
  origin: PlanetState,
): PlanetState | null {
  const player = universe.players[playerId];
  if (!player) return null;
  let best: PlanetState | null = null;
  for (const id of player.planetIds ?? []) {
    const body = universe.planets[id];
    if (!body || !isHaven(body, playerId, origin.id)) continue;
    if (!best || closer(origin, body, best)) best = body;
  }
  return best;
}

function isHaven(
  body: PlanetState,
  playerId: string,
  originId: string,
): boolean {
  if (body.id === originId) return false;
  if (body.ownerPlayerId !== playerId) return false;
  if (isMiniPlanet(body)) return false;
  return havenKind(body.kind);
}

function havenKind(kind: PlanetState["kind"]): boolean {
  switch (kind) {
    case "planet":
    case "moon":
    case undefined:
      return true;
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

function closer(
  origin: PlanetState,
  candidate: PlanetState,
  best: PlanetState,
): boolean {
  const next = coordDistance(origin.coords, candidate.coords);
  const prev = coordDistance(origin.coords, best.coords);
  if (next !== prev) return next < prev;
  return candidate.id < best.id;
}
