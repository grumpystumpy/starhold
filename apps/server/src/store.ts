import { createUniverse, type UniverseState } from "@starhold/game";

/** Single in-memory universe — swap for SQLite/Postgres later without changing the client contract.
 * 8× keeps a 15–20 min playtest on the yard→scout path without making starter piles an instant win.
 */
export const universe: UniverseState = createUniverse("Alpha Drift", 8);
