import type { PlayerState, UniverseState } from "./types.js";

/**
 * Give a test player enough empire points to exit newbie protection
 * (≥ 2,500) without adding combat ships that skew raid outcomes.
 * Uses storage buildings (no combat).
 */
export function graduateNewbieProtection(
  universe: UniverseState,
  player: PlayerState,
): void {
  const planet = universe.planets[player.homePlanetId];
  if (!planet) return;
  planet.buildings.metalStorage = Math.max(
    planet.buildings.metalStorage ?? 0,
    20,
  );
  planet.buildings.crystalStorage = Math.max(
    planet.buildings.crystalStorage ?? 0,
    20,
  );
  planet.buildings.deutTank = Math.max(planet.buildings.deutTank ?? 0, 20);
}
