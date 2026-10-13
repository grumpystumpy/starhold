import type { DefenseId, ShipId } from "./types.js";

/** Combat unit id that can fire or be targeted. */
export type CombatUnitId = ShipId | DefenseId;

/**
 * Invented rapid-fire multipliers: damage × N when firer focuses that target.
 * Missing entries default to 1 (no bonus).
 */
export const RAPID_FIRE: Partial<
  Record<CombatUnitId, Partial<Record<CombatUnitId, number>>>
> = {
  scout: { probe: 2, swarmDrone: 2 },
  interceptor: { probe: 5, scout: 2, swarmDrone: 5 },
  cruiser: { hauler: 3, probe: 4, swarmDrone: 8 },
  bomber: { laserBattery: 4, scout: 2, swarmDrone: 4 },
  voidforgeTitan: {
    swarmDrone: 200,
    probe: 250,
    scout: 50,
    laserBattery: 50,
  },
  worldEater: {
    laserBattery: 20,
    shieldDome: 10,
  },
  swarmDrone: { probe: 3 },
};

export function rapidFireFactor(
  firer: CombatUnitId,
  target: CombatUnitId,
): number {
  const n = RAPID_FIRE[firer]?.[target] ?? 1;
  return n >= 1 ? n : 1;
}
