import {
  NPC_JOB_FLEET_BUDGET,
  NPC_JOB_LEVELUP_BUDGET,
  NPC_JOB_RAID_BUDGET,
  WORKERS_TICK_DRIFT_BUDGET,
  WORKERS_TICK_FLEET_BUDGET,
  WORKERS_TICK_LEVELUP_BUDGET,
  WORKERS_TICK_RAID_BUDGET,
  WORKERS_TICK_SEED_MINIS,
  WORKERS_TICK_SEED_PIRATES,
  WORKERS_TICK_SEED_SYSTEMS,
} from "./catalog.js";
import type { UniverseState } from "./types.js";

/**
 * Per-request cap so a Workers free-plan invocation stays inside 10ms CPU.
 * Unset (the Vercel / test default) means the historical full tick.
 * Counters are decremented as work is consumed.
 */
export interface TickBudget {
  raids: number;
  levelUps: number;
  fleets: number;
  driftSteps: number;
  seedSystems: number;
  seedMinis: number;
  seedPirates: number;
  /** Skip unowned bodies. Owned planets and due queues still advance. */
  lazyPlanets: boolean;
}

type PlanetSync = (
  universe: UniverseState,
  planetId: string,
  now: number,
) => void;

let readBudget: () => TickBudget | undefined = () => undefined;
let planetSync: PlanetSync | null = null;

/** Server installs an AsyncLocalStorage reader. The game package stays free of Node APIs. */
export function bindTickBudget(reader: () => TickBudget | undefined): void {
  readBudget = reader;
}

export function tickBudget(): TickBudget | undefined {
  return readBudget();
}

export function bindPlanetSync(fn: PlanetSync): void {
  planetSync = fn;
}

/**
 * When lazy planet ticks are on, bring one planet up to `now` before combat
 * reads its resources. No-op on the full-tick path.
 */
export function syncPlanetForTick(
  universe: UniverseState,
  planetId: string,
  now: number,
): void {
  if (!readBudget()?.lazyPlanets) return;
  planetSync?.(universe, planetId, now);
}

/** `true` when the caller may do one more unit of this work. */
export function consumeTickBudget(
  kind: "raids" | "levelUps" | "fleets" | "driftSteps",
): boolean {
  const budget = readBudget();
  if (!budget) return true;
  if (budget[kind] <= 0) return false;
  budget[kind] -= 1;
  return true;
}

/** Fresh budget object for one Workers request. */
export function workersTickBudget(): TickBudget {
  return {
    raids: WORKERS_TICK_RAID_BUDGET,
    levelUps: WORKERS_TICK_LEVELUP_BUDGET,
    fleets: WORKERS_TICK_FLEET_BUDGET,
    driftSteps: WORKERS_TICK_DRIFT_BUDGET,
    seedSystems: WORKERS_TICK_SEED_SYSTEMS,
    seedMinis: WORKERS_TICK_SEED_MINIS,
    seedPirates: WORKERS_TICK_SEED_PIRATES,
    lazyPlanets: true,
  };
}

/** Budget for the 10-minute pirate and alien job. Not used on page loads. */
export function npcJobBudget(): TickBudget {
  return {
    raids: NPC_JOB_RAID_BUDGET,
    levelUps: NPC_JOB_LEVELUP_BUDGET,
    fleets: NPC_JOB_FLEET_BUDGET,
    driftSteps: 0,
    seedSystems: 0,
    seedMinis: 0,
    seedPirates: 0,
    lazyPlanets: true,
  };
}
