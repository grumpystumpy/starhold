import type {
  BuildingId,
  Coordinates,
  DefenseId,
  FleetShips,
  MissionType,
  PlayerView,
  ResearchId,
  Resources,
  ShipId,
} from "@starhold/game";

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

export async function joinGame(name: string): Promise<PlayerView> {
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parse<PlayerView>(res);
}

export async function fetchState(
  playerId: string,
  galaxy?: number,
  system?: number,
): Promise<PlayerView> {
  const params = new URLSearchParams();
  params.set("playerId", playerId);
  if (galaxy) params.set("galaxy", String(galaxy));
  if (system) params.set("system", String(system));
  const res = await fetch(`/api/state?${params.toString()}`);
  return parse<PlayerView>(res);
}

export async function upgradeBuilding(
  playerId: string,
  buildingId: BuildingId,
): Promise<PlayerView> {
  const res = await fetch("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, buildingId }),
  });
  return parse<PlayerView>(res);
}

export async function buildShip(
  playerId: string,
  shipId: ShipId,
  count: number,
): Promise<PlayerView> {
  const res = await fetch("/api/build-ship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, shipId, count }),
  });
  return parse<PlayerView>(res);
}

export async function buildDefense(
  playerId: string,
  defenseId: DefenseId,
  count: number,
): Promise<PlayerView> {
  const res = await fetch("/api/build-defense", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, defenseId, count }),
  });
  return parse<PlayerView>(res);
}

export async function researchTech(
  playerId: string,
  researchId: ResearchId,
): Promise<PlayerView> {
  const res = await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, researchId }),
  });
  return parse<PlayerView>(res);
}

export async function selectPlanet(
  playerId: string,
  planetId: string,
): Promise<PlayerView> {
  const res = await fetch("/api/select-planet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, planetId }),
  });
  return parse<PlayerView>(res);
}

export async function launchFleetMission(
  playerId: string,
  opts: {
    mission: MissionType;
    ships: Partial<FleetShips>;
    targetPlanetId?: string;
    targetCoords?: Coordinates;
    asteroidId?: string;
    pirateBaseId?: string;
    cargo?: Partial<Resources>;
  },
): Promise<PlayerView> {
  const res = await fetch("/api/launch-fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}
