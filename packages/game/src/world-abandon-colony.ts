import type { PlanetState, UniverseState } from "./types.js";

export type AbandonColonyResult =
  | { ok: true }
  | { ok: false; error: string };

const FLEET_BLOCK =
  "Wait for your fleet to return before abandoning this colony.";

function moonIdFor(universe: UniverseState, planet: PlanetState): string | null {
  const moonId = planet.moonId;
  if (!moonId) return null;
  const moon = universe.planets[moonId];
  if (!moon || moon.kind !== "moon") return null;
  return moonId;
}

function ownFleetInFlight(
  universe: UniverseState,
  playerId: string,
  bodyIds: ReadonlySet<string>,
): boolean {
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (fleet.ownerPlayerId !== playerId) continue;
    if (bodyIds.has(fleet.originPlanetId)) return true;
    if (fleet.targetPlanetId && bodyIds.has(fleet.targetPlanetId)) return true;
  }
  return false;
}

function dropBody(universe: UniverseState, id: string, fallbackOwnerId: string): void {
  const body = universe.planets[id];
  const owner =
    (body && universe.players[body.ownerPlayerId]) ||
    universe.players[fallbackOwnerId];
  if (owner) {
    owner.planetIds = (owner.planetIds ?? []).filter((planetId) => planetId !== id);
    if (owner.activePlanetId === id) {
      owner.activePlanetId = owner.homePlanetId;
    }
    if (owner.discoveredMiniIds?.includes(id)) {
      owner.discoveredMiniIds = owner.discoveredMiniIds.filter(
        (planetId) => planetId !== id,
      );
    }
    universe.players[owner.id] = owner;
  }
  if (universe.occupations?.[id]) delete universe.occupations[id];
  if (universe.miniPlanetIds?.includes(id)) {
    universe.miniPlanetIds = universe.miniPlanetIds.filter(
      (planetId) => planetId !== id,
    );
  }
  delete universe.planets[id];
}

/** Abandon an owned colony and delete that planet and its moon. */
export function abandonColony(
  universe: UniverseState,
  playerId: string,
  planetId: string,
): AbandonColonyResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  const owned =
    planet.ownerPlayerId === playerId &&
    (player.planetIds ?? []).includes(planetId);
  if (!owned) return { ok: false, error: "You do not own that colony." };
  if (planet.kind === "moon") {
    return { ok: false, error: "Cannot abandon a moon by itself." };
  }
  if (planetId === player.homePlanetId) {
    return { ok: false, error: "Cannot abandon your homeworld." };
  }

  const moonId = moonIdFor(universe, planet);
  const bodyIds = new Set<string>([planet.id]);
  if (moonId) bodyIds.add(moonId);
  if (ownFleetInFlight(universe, playerId, bodyIds)) {
    return { ok: false, error: FLEET_BLOCK };
  }

  if (moonId) dropBody(universe, moonId, playerId);
  dropBody(universe, planet.id, playerId);
  return { ok: true };
}
