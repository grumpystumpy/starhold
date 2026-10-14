import {
  MINI_WORLD_EATER_MIN,
  SHIPS,
  SWARM_CAPACITY_BASE,
  SWARM_CAPACITY_HARD_CAP,
  SWARM_HOLD_BONUS_PER_LEVEL,
  SWARM_NUMBERS_BONUS_CAP_COUNT,
  SWARM_NUMBERS_BONUS_PER,
  SWARM_NUMBERS_THRESHOLD,
} from "./catalog.js";
import type { FleetShips, ShipId } from "./types.js";

/**
 * Moon destruction chance percent (Voidforge Titan).
 * chancePct = min(100, floor( (100 - sqrt(moonDiameterProxy)) * sqrt(titans) ))
 * moonDiameterProxy v1 = max(1, fieldsCap)
 */
export function voidforgeMoonKillChancePct(
  titans: number,
  fieldsCap: number,
): number {
  const n = Math.max(0, Math.floor(titans));
  if (n <= 0) return 0;
  const diameter = Math.max(1, fieldsCap);
  return Math.min(
    100,
    Math.floor((100 - Math.sqrt(diameter)) * Math.sqrt(n)),
  );
}

/** Mothership carry capacity for one mothership at a Swarm Hold level. */
export function swarmCapacityForLevel(swarmHoldLevel: number): number {
  const level = Math.max(0, Math.floor(swarmHoldLevel));
  const raw = Math.floor(
    SWARM_CAPACITY_BASE * (1 + SWARM_HOLD_BONUS_PER_LEVEL * level),
  );
  return Math.min(SWARM_CAPACITY_HARD_CAP, Math.max(SWARM_CAPACITY_BASE, raw));
}

/** Total swarm capacity for a fleet (per mothership × count). */
export function swarmFleetCapacity(
  ships: FleetShips,
  swarmHoldLevel: number,
): number {
  const motherships = ships.swarmMothership ?? 0;
  if (motherships <= 0) return 0;
  return motherships * swarmCapacityForLevel(swarmHoldLevel);
}

export function swarmCarriedCount(ships: FleetShips): number {
  return (ships.swarmDrone ?? 0) + (ships.swarmHarvester ?? 0);
}

/** Attack multiplier for swarm drones when count ≥ threshold. */
export function swarmDroneAttackMult(droneCount: number): number {
  const n = Math.max(0, Math.floor(droneCount));
  if (n < SWARM_NUMBERS_THRESHOLD) return 1;
  const bonus =
    SWARM_NUMBERS_BONUS_PER * Math.min(n, SWARM_NUMBERS_BONUS_CAP_COUNT);
  return 1 + bonus;
}

/**
 * True when fleet can scoop debris fields.
 * Salvage Trawler or Mothership (World Eater cargo is always 0).
 */
export function canCollectDebris(ships: FleetShips): boolean {
  return (ships.recycler ?? 0) >= 1 || (ships.swarmMothership ?? 0) >= 1;
}

/** Mini-planet capture/destroy gate (≥5 World Eaters). */
export function canResolveMiniPlanet(ships: FleetShips): boolean {
  return (ships.worldEater ?? 0) >= MINI_WORLD_EATER_MIN;
}

/** Validate carried swarm vs mothership capacity; free-flying swarm alone is illegal. */
export function validateSwarmCarry(
  ships: FleetShips,
  swarmHoldLevel: number,
): { ok: true } | { ok: false; error: string } {
  const drones = ships.swarmDrone ?? 0;
  const harvesters = ships.swarmHarvester ?? 0;
  const carried = drones + harvesters;
  const motherships = ships.swarmMothership ?? 0;
  if (carried <= 0) return { ok: true };
  if (motherships <= 0) {
    return {
      ok: false,
      error: "Swarm drones/harvesters must ride a Mothership.",
    };
  }
  const cap = swarmFleetCapacity(ships, swarmHoldLevel);
  if (carried > cap) {
    return {
      ok: false,
      error: `Swarm carry exceeds capacity (${carried}/${cap}). Research Swarm Hold or add motherships.`,
    };
  }
  return { ok: true };
}

export function shipResearchReqMet(
  shipId: ShipId,
  research: Partial<Record<string, number>>,
): { ok: true } | { ok: false; error: string } {
  const req = SHIPS[shipId].researchReq;
  if (!req) return { ok: true };
  for (const [id, need] of Object.entries(req)) {
    const have = research[id] ?? 0;
    if (have < (need ?? 0)) {
      return {
        ok: false,
        error: `Needs research ${id} level ${need} (you have ${have}).`,
      };
    }
  }
  return { ok: true };
}
