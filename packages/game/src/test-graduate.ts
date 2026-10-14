import type { PlayerState, UniverseState } from "./types.js";
import { graduateNewbieProtection as graduate } from "./world-protection.js";

/** @deprecated Prefer graduateNewbieProtection from world-protection / world. */
export function graduateNewbieProtection(
  universe: UniverseState,
  player: PlayerState,
): void {
  graduate(universe, player);
}
