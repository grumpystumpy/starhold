import { MAP_GALAXIES, MAP_SLOTS, MAP_SYSTEMS } from "./catalog.js";
import {
  economySnapshot,
  planetPoints,
  researchPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  GalaxyView,
  HighscoreEntry,
  PlayerState,
  PlayerView,
  PublicPlayer,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import {
  activePlanet,
  ensureUniverseShape,
  planetAtCoords,
} from "./world-bootstrap.js";
import { getDebris } from "./world-tick.js";

/** Empire total: all planets + in-flight ships + research once. */
export function empirePoints(
  universe: UniverseState,
  player: PlayerState,
): number {
  let points = researchPoints(player.research);
  for (const id of player.planetIds ?? []) {
    const planet = universe.planets[id];
    if (planet) points += planetPoints(planet);
  }
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.ownerPlayerId === player.id) {
      points += shipStockPoints(fleet.ships);
    }
  }
  return Math.floor(points);
}

export function highscoresBoard(universe: UniverseState): HighscoreEntry[] {
  const rows = Object.values(universe.players).map((p) => {
    const home = universe.planets[p.homePlanetId];
    return {
      playerId: p.id,
      name: p.name,
      points: empirePoints(universe, p),
      coords: home?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      planetCount: p.planetIds?.length ?? 0,
    };
  });
  rows.sort(
    (a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId),
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function publicRoster(universe: UniverseState): PublicPlayer[] {
  return Object.values(universe.players).map((p) => {
    const planet = universe.planets[p.homePlanetId];
    return {
      id: p.id,
      name: p.name,
      coords: planet?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      pointsHint: empirePoints(universe, p),
      planetId: p.homePlanetId,
    };
  });
}

export function galaxyViewFor(
  universe: UniverseState,
  playerId: string,
  galaxy: number,
  system: number,
): GalaxyView {
  ensureUniverseShape(universe);
  const g = Math.min(MAP_GALAXIES, Math.max(1, Math.floor(galaxy)));
  const s = Math.min(MAP_SYSTEMS, Math.max(1, Math.floor(system)));
  const slots = [];
  for (let slot = 1; slot <= MAP_SLOTS; slot++) {
    const coords = { galaxy: g, system: s, slot };
    const planet = planetAtCoords(universe, coords);
    const debris = getDebris(universe, coords);
    const owner = planet
      ? universe.players[planet.ownerPlayerId]
      : undefined;
    slots.push({
      coords,
      planetId: planet?.id ?? null,
      playerId: owner?.id ?? null,
      playerName: owner?.name ?? null,
      pointsHint: planet ? Math.floor(planetPoints(planet)) : 0,
      debris: debris
        ? { metal: debris.metal, crystal: debris.crystal }
        : null,
      isOwn: owner?.id === playerId,
    });
  }
  return { galaxy: g, system: s, slots };
}

export function playerView(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
  galaxy?: number,
  system?: number,
): PlayerView {
  advanceUniverse(universe, now);
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) throw new Error("Unknown player.");
  const planet = activePlanet(universe, player);
  if (!planet) throw new Error("Planet missing.");

  const fleets = Object.values(universe.fleets)
    .filter((f) => f.ownerPlayerId === playerId)
    .sort((a, b) => a.arrivesAt - b.arrivesAt);

  const reports = Object.values(universe.reports)
    .filter(
      (r) =>
        r.attackerPlayerId === playerId || r.defenderPlayerId === playerId,
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const spyReports = Object.values(universe.spyReports)
    .filter((r) => r.spyPlayerId === playerId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const expeditionReports = Object.values(universe.expeditionReports ?? {})
    .filter((r) => r.playerId === playerId)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  const g = galaxy ?? planet.coords.galaxy;
  const s = system ?? planet.coords.system;

  return {
    now,
    universe: {
      id: universe.id,
      name: universe.name,
      speed: universe.speed,
      fleetSpeed: universe.fleetSpeed,
    },
    player,
    planet,
    ownedPlanets: player.planetIds
      .map((id) => {
        const p = universe.planets[id];
        if (!p) return null;
        return {
          id: p.id,
          name: p.name,
          coords: p.coords,
          isHome: p.id === player.homePlanetId,
          isActive: p.id === player.activePlanetId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    economy: economySnapshot(
      planet,
      universe.speed,
      player.research.energyTech ?? 0,
    ),
    roster: publicRoster(universe),
    highscores: highscoresBoard(universe),
    galaxy: galaxyViewFor(universe, playerId, g, s),
    fleets,
    reports,
    spyReports,
    expeditionReports,
  };
}
