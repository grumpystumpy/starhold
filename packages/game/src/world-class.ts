import {
  CLASS_CHANGE_BASE_COST,
  CLASS_CHANGE_COOLDOWN_MS,
  CLASS_CHANGE_COST_PER_PRIOR,
  PLAYER_CLASS_BONUSES,
  PLAYER_CLASS_ORDER,
  SHIPS,
  SHIP_ORDER,
} from "./catalog.js";
import {
  classBonuses,
  emptyPlayerClass,
  ensurePlayerClass,
} from "./formulas-round3.js";
import type {
  PlayerClassId,
  ShipId,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";

export type ClassActionResult =
  | { ok: true }
  | { ok: false; error: string };

export function isPlayerClassId(id: string): id is PlayerClassId {
  return (PLAYER_CLASS_ORDER as readonly string[]).includes(id);
}

export function classChangeCost(priorChangeCount: number): number {
  return (
    CLASS_CHANGE_BASE_COST +
    CLASS_CHANGE_COST_PER_PRIOR * Math.max(0, Math.floor(priorChangeCount))
  );
}

/** First free class pick. */
export function choosePlayerClass(
  universe: UniverseState,
  playerId: string,
  classId: PlayerClassId,
  now = Date.now(),
): ClassActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!isPlayerClassId(classId)) {
    return { ok: false, error: "Unknown class." };
  }
  advanceUniverse(universe, now);
  const state = ensurePlayerClass(player);
  if (state.classId != null) {
    return {
      ok: false,
      error: "Class already chosen — use change (Starshards).",
    };
  }
  state.classId = classId;
  state.chosenAt = now;
  universe.players[playerId] = player;
  return { ok: true };
}

/** Paid class change with Starshards + cooldown. */
export function changePlayerClass(
  universe: UniverseState,
  playerId: string,
  classId: PlayerClassId,
  now = Date.now(),
): ClassActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!isPlayerClassId(classId)) {
    return { ok: false, error: "Unknown class." };
  }
  advanceUniverse(universe, now);
  const state = ensurePlayerClass(player);
  if (state.classId == null) {
    return { ok: false, error: "Choose a class first (free)." };
  }
  if (state.classId === classId) {
    return { ok: false, error: "Already that class." };
  }
  if (
    state.lastChangeAt != null &&
    now - state.lastChangeAt < CLASS_CHANGE_COOLDOWN_MS
  ) {
    const left = CLASS_CHANGE_COOLDOWN_MS - (now - state.lastChangeAt);
    const days = Math.ceil(left / (24 * 60 * 60 * 1000));
    return {
      ok: false,
      error: `Class change on cooldown (${days}d remaining).`,
    };
  }
  const cost = classChangeCost(state.changeCount);
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < cost) {
    return {
      ok: false,
      error: `Need ${cost} Starshards (have ${balance}).`,
    };
  }
  player.starshards = balance - cost;
  state.classId = classId;
  state.changeCount += 1;
  state.lastChangeAt = now;
  universe.players[playerId] = player;
  return { ok: true };
}

export function classCatalog() {
  return PLAYER_CLASS_ORDER.map((id) => {
    const bonuses = classBonuses(id);
    const exclusiveShips = SHIP_ORDER.filter(
      (sid) => SHIPS[sid].classExclusive === id,
    ) as ShipId[];
    return {
      id,
      name: PLAYER_CLASS_BONUSES[id].name,
      bonuses,
      exclusiveShipIds: exclusiveShips,
      changeCostBase: CLASS_CHANGE_BASE_COST,
      changeCostPerPrior: CLASS_CHANGE_COST_PER_PRIOR,
      changeCooldownMs: CLASS_CHANGE_COOLDOWN_MS,
    };
  });
}

export { emptyPlayerClass, ensurePlayerClass };
