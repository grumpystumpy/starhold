import {
  canAfford,
  debrisFromDestroyed,
  destroyedShipResources,
  fieldsCap,
  shipCost,
  shipUnitBuildSeconds,
  spend,
  swarmCarriedCount,
  swarmFleetCapacity,
  voidforgeMoonKillChancePct,
} from "./formulas.js";
import type {
  FleetShips,
  MiniPlanetResolveChoice,
  PlanetState,
  UniverseState,
} from "./types.js";
import { emptyShips } from "./world-bootstrap.js";
import { moonRoll } from "./world-moons.js";
import { applyMiniPlanetResolve } from "./world-mini.js";
import { addDebris } from "./world-tick.js";

type ActionResult =
  | { ok: true; planet: PlanetState }
  | { ok: false; error: string };

/**
 * Produce Swarm Drones aboard a mothership fleet.
 * Costs paid from fleet cargo; builds into carried swarm.
 * Caller should `advanceUniverse` first.
 */
export function swarmProduce(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  count: number,
  now = Date.now(),
): ActionResult {
  const qty = Math.floor(count);
  if (qty < 1 || qty > 200) {
    return { ok: false, error: "Produce between 1 and 200 drones." };
  }
  const fleet = universe.fleets[fleetId];
  if (!fleet || fleet.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  const motherships = fleet.ships.swarmMothership ?? 0;
  if (motherships < 1) {
    return { ok: false, error: "Swarm produce requires a Mothership." };
  }
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const hold = player.research.swarmHold ?? 0;
  const cap = swarmFleetCapacity(fleet.ships, hold);
  const used = swarmCarriedCount(fleet.ships);
  if (used + qty > cap) {
    return {
      ok: false,
      error: `Not enough swarm capacity (${used + qty}/${cap}).`,
    };
  }
  if (fleet.swarmProduce && fleet.swarmProduce.remaining > 0) {
    return { ok: false, error: "Mothership is already producing drones." };
  }
  const cost = shipCost("swarmDrone", qty);
  if (!canAfford(fleet.cargo, cost)) {
    return { ok: false, error: "Not enough cargo resources on the mothership." };
  }
  const origin = universe.planets[fleet.originPlanetId];
  if (!origin) return { ok: false, error: "Origin planet missing." };
  const chrono = origin.buildings.chronoLathe ?? 0;
  const yard = Math.max(origin.buildings.shipyard ?? 0, 4);
  const unitSeconds = shipUnitBuildSeconds("swarmDrone", yard, chrono);
  fleet.cargo = spend(fleet.cargo, cost);
  fleet.swarmProduce = {
    remaining: qty,
    unitSeconds,
    progressAt: now,
  };
  universe.fleets[fleet.id] = fleet;
  return { ok: true, planet: origin };
}

/**
 * Post-battle mini capture/destroy. Default choice is capture when omitted by API.
 * Caller should `advanceUniverse` first.
 */
export function resolveMiniPlanetChoice(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  choice: MiniPlanetResolveChoice = "capture",
): ActionResult {
  const result = applyMiniPlanetResolve(universe, playerId, fleetId, choice);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.planet) return { ok: true, planet: result.planet };
  // Destroy removes the planet — return attacker's origin as view anchor.
  const fleet = universe.fleets[fleetId];
  const origin = fleet
    ? universe.planets[fleet.originPlanetId]
    : universe.planets[universe.players[playerId]?.activePlanetId ?? ""];
  if (!origin) return { ok: false, error: "Planet missing after destroy." };
  return { ok: true, planet: origin };
}

/**
 * Apply moon-kill after an attacker win on a moon.
 * Only surviving Void Titans count toward destruction chance.
 */
export function maybeDestroyMoonWithTitans(
  universe: UniverseState,
  moon: PlanetState,
  survivingAttacker: FleetShips,
  reportId: string,
): { destroyed: boolean; chancePct: number } {
  const killers = survivingAttacker.voidforgeTitan ?? 0;
  const chancePct = voidforgeMoonKillChancePct(killers, fieldsCap(moon));
  if (chancePct <= 0) return { destroyed: false, chancePct: 0 };
  const roll = moonRoll(`${reportId}:moonkill`);
  if (roll >= chancePct) return { destroyed: false, chancePct };

  const debrisShips = destroyedShipResources(moon.ships, emptyShips());
  const halfDebris = debrisFromDestroyed({
    metal: debrisShips.metal,
    crystal: debrisShips.crystal,
    deuterium: 0,
  });
  addDebris(universe, moon.coords, {
    metal: Math.floor(halfDebris.metal),
    crystal: Math.floor(halfDebris.crystal),
    deuterium: 0,
  });

  const owner = universe.players[moon.ownerPlayerId];
  if (owner) {
    owner.planetIds = owner.planetIds.filter((id) => id !== moon.id);
    if (owner.activePlanetId === moon.id) {
      owner.activePlanetId = owner.homePlanetId;
    }
    universe.players[owner.id] = owner;
  }
  const parentId = moon.parentPlanetId;
  if (parentId && universe.planets[parentId]) {
    universe.planets[parentId].moonId = null;
  }
  for (const [fid, fleet] of Object.entries(universe.fleets)) {
    if (fleet.originPlanetId === moon.id || fleet.targetPlanetId === moon.id) {
      delete universe.fleets[fid];
    }
  }
  if (universe.occupations?.[moon.id]) {
    delete universe.occupations[moon.id];
  }
  delete universe.planets[moon.id];
  return { destroyed: true, chancePct };
}
