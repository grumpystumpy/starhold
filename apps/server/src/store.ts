import { createUniverse, type UniverseState } from "@starhold/game";

/**
 * Single in-memory universe — swap for SQLite/Postgres later without changing the client contract.
 * Economy speed 8× shortens build/ship/fleet timers. Resource income is additionally scaled by
 * PRODUCTION_MULT in @starhold/game (temporary test tuning — currently 4 = +300% vs tip 95b98bc9).
 */
export const universe: UniverseState = createUniverse("Alpha Drift", 8);
