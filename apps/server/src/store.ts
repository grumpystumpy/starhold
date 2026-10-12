import { createUniverse, type UniverseState } from "@starhold/game";

/** Single in-memory universe — swap for SQLite/Postgres later without changing the client contract. */
export const universe: UniverseState = createUniverse("Alpha Drift", 2);
