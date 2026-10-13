import {
  DEEP_SPACE_SLOT,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  OFFICER_ORDER,
  OFFICERS,
  SKILL_ORDER,
  SKILLS,
  STARSHARDS_HIGHSCORE_TOP3,
} from "./catalog.js";
import {
  economySnapshot,
  planetPoints,
  researchPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  GalaxySlot,
  GalaxyView,
  HighscoreEntry,
  PlayerState,
  PlayerView,
  PublicPlayer,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { asteroidsInSystem } from "./world-asteroids.js";
import {
  canClaimDailyLogin,
  grantStarshards,
  playerBoosts,
  pruneExpiredOfficers,
} from "./world-boosts.js";
import {
  activePlanet,
  ensureUniverseShape,
  moonAtCoords,
  planetAtCoords,
} from "./world-bootstrap.js";
import { ownedPlanetCount } from "./world-moons.js";
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
      planetCount: ownedPlanetCount(universe, p.id),
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
  const slots: GalaxySlot[] = [];
  for (let slot = 1; slot <= MAP_SLOTS; slot++) {
    const coords = { galaxy: g, system: s, slot };
    const planet = planetAtCoords(universe, coords);
    const moon = moonAtCoords(universe, coords);
    const debris = getDebris(universe, coords);
    const owner = planet
      ? universe.players[planet.ownerPlayerId]
      : undefined;
    slots.push({
      coords,
      planetId: planet?.id ?? null,
      playerId: owner?.id ?? null,
      playerName: owner?.name ?? null,
      allianceTag: null,
      pointsHint: planet ? Math.floor(planetPoints(planet)) : 0,
      debris: debris
        ? { metal: debris.metal, crystal: debris.crystal }
        : null,
      isOwn: owner?.id === playerId,
      hasMoon: Boolean(moon),
      moonId: moon?.id ?? null,
      activity: planet ? "planet" : "empty",
    });
  }

  const pirate = Object.values(universe.pirateBases ?? {}).find(
    (b) =>
      b.destroyedAt == null &&
      b.coords.galaxy === g &&
      b.coords.system === s,
  );
  if (pirate) {
    const slot = slots.find((row) => row.coords.slot === pirate.coords.slot);
    if (slot && slot.activity === "empty") {
      slot.activity = "pirate";
    }
  }

  return {
    galaxy: g,
    system: s,
    slots,
    deepSpace: { coords: { galaxy: g, system: s, slot: DEEP_SPACE_SLOT } },
    asteroids: asteroidsInSystem(universe, g, s),
    pirateBase: pirate
      ? {
          id: pirate.id,
          coords: pirate.coords,
          name: pirate.name,
          tier: pirate.tier,
          threatHint:
            pirate.tier >= 5 ? "high" : pirate.tier >= 2 ? "medium" : "low",
        }
      : null,
  };
}

/** Once-only +50 Starshards the first time a player reaches top 3 (needs rivals). */
function maybeGrantHighscoreStarshards(
  universe: UniverseState,
  playerId: string,
): void {
  const player = universe.players[playerId];
  if (!player || player.highscoreStarshardsClaimed) return;
  if (Object.keys(universe.players).length < 2) return;
  const board = highscoresBoard(universe);
  const row = board.find((e) => e.playerId === playerId);
  if (!row || row.rank > 3) return;
  player.highscoreStarshardsClaimed = true;
  grantStarshards(player, STARSHARDS_HIGHSCORE_TOP3);
  universe.players[player.id] = player;
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
  pruneExpiredOfficers(player, now);
  maybeGrantHighscoreStarshards(universe, playerId);
  const planet = activePlanet(universe, player);
  if (!planet) throw new Error("Planet missing.");
  const boosts = playerBoosts(player, now);

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

  const sensorContacts =
    planet.kind === "moon" && (planet.buildings.sensorArray ?? 0) >= 1
      ? Object.values(universe.fleets)
          .filter(
            (f) =>
              f.phase === "outbound" &&
              f.targetCoords.galaxy === planet.coords.galaxy &&
              f.targetCoords.system === planet.coords.system,
          )
          .sort((a, b) => a.arrivesAt - b.arrivesAt)
          .slice(0, 20)
      : [];

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
          isMoon: p.kind === "moon",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    economy: economySnapshot(
      planet,
      universe.speed,
      player.research.energyTech ?? 0,
      { mineOutput: boosts.mineOutput, energyOutput: boosts.energyOutput },
    ),
    roster: publicRoster(universe),
    highscores: highscoresBoard(universe),
    galaxy: galaxyViewFor(universe, playerId, g, s),
    fleets,
    reports,
    spyReports,
    expeditionReports,
    sensorContacts,
    starshards: player.starshards ?? 0,
    officers: player.officers ?? [],
    skillsUnlocked: player.skillsUnlocked ?? [],
    officerCatalog: OFFICER_ORDER.map((id) => OFFICERS[id]),
    skillCatalog: SKILL_ORDER.map((id) => SKILLS[id]),
    dailyLoginAvailable: canClaimDailyLogin(player, now),
  };
}
