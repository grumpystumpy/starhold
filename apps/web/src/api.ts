import type {
  BuildingId,
  FleetShips,
  MissionType,
  PlayerView,
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

export async function fetchState(playerId: string): Promise<PlayerView> {
  const res = await fetch(`/api/state/${encodeURIComponent(playerId)}`);
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

export async function launchFleetMission(
  playerId: string,
  targetPlanetId: string,
  mission: MissionType,
  ships: Partial<FleetShips>,
): Promise<PlayerView> {
  const res = await fetch("/api/launch-fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, targetPlanetId, mission, ships }),
  });
  return parse<PlayerView>(res);
}
