import type {
  BuildingId,
  Coordinates,
  DefenseId,
  FleetShips,
  MissionType,
  OfficerId,
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

const credFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { credentials: "include", ...init });

export interface AuthAccount {
  id: string;
  email: string;
  playerId: string | null;
}

export interface AuthMeResponse {
  account: AuthAccount | null;
  view: PlayerView | null;
  auth?: { sessionSecretConfigured?: boolean; passwordAuth?: boolean };
  error?: string;
}

export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const res = await credFetch("/api/auth/me");
  return parse<AuthMeResponse>(res);
}

export async function signupAccount(
  email: string,
  password: string,
  claimPlayerId?: string | null,
): Promise<{
  ok: boolean;
  account: AuthAccount;
  error?: string;
}> {
  const res = await credFetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      claimPlayerId: claimPlayerId || undefined,
    }),
  });
  return parse(res);
}

export async function loginAccount(
  email: string,
  password: string,
): Promise<{
  ok: boolean;
  account: AuthAccount;
  view: PlayerView | null;
  error?: string;
}> {
  const res = await credFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parse(res);
}

export async function claimAnonymousPlayer(
  playerId: string,
): Promise<{ ok: boolean; view: PlayerView; account: AuthAccount }> {
  const res = await credFetch("/api/auth/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parse(res);
}

export async function authJoin(name: string): Promise<PlayerView> {
  const res = await credFetch("/api/auth/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parse<PlayerView>(res);
}

export async function logoutAccount(): Promise<void> {
  await credFetch("/api/auth/logout", { method: "POST" });
}

export async function joinGame(name: string): Promise<PlayerView> {
  const res = await credFetch("/api/join", {
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
  const res = await credFetch(`/api/state?${params.toString()}`);
  return parse<PlayerView>(res);
}

export async function upgradeBuilding(
  playerId: string,
  buildingId: BuildingId,
): Promise<PlayerView> {
  const res = await credFetch("/api/upgrade", {
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
  const res = await credFetch("/api/build-ship", {
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
  const res = await credFetch("/api/build-defense", {
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
  const res = await credFetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, researchId }),
  });
  return parse<PlayerView>(res);
}

export async function cancelQueueItem(
  playerId: string,
  kind: "building" | "ship" | "defense" | "research",
  itemId: string,
  planetId?: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/queue/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, kind, itemId, planetId }),
  });
  return parse<PlayerView>(res);
}

export async function reorderQueueItems(
  playerId: string,
  kind: "building" | "ship" | "defense" | "research",
  orderedIds: string[],
  planetId?: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/queue/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, kind, orderedIds, planetId }),
  });
  return parse<PlayerView>(res);
}

export async function selectPlanet(
  playerId: string,
  planetId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/select-planet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, planetId }),
  });
  return parse<PlayerView>(res);
}

export async function renamePlanet(
  playerId: string,
  planetId: string,
  name: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/rename-planet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, planetId, name }),
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
  const res = await credFetch("/api/launch-fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function saveFleetPresetRequest(
  playerId: string,
  opts: { id?: string; name: string; ships: Partial<FleetShips> },
): Promise<PlayerView> {
  const res = await credFetch("/api/fleet-preset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function deleteFleetPresetRequest(
  playerId: string,
  id: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/fleet-preset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, id, delete: true }),
  });
  return parse<PlayerView>(res);
}

export async function launchMaxExpeditionsRequest(
  playerId: string,
  opts: { galaxy?: number; system?: number; originPlanetId?: string },
): Promise<PlayerView> {
  const res = await credFetch("/api/launch-max-expeditions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function scanSystemRequest(
  playerId: string,
  opts: { galaxy: number; system: number; originPlanetId?: string },
): Promise<PlayerView> {
  const res = await credFetch("/api/scan-system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function claimDaily(playerId: string): Promise<PlayerView> {
  const res = await credFetch("/api/claim-daily", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parse<PlayerView>(res);
}

export async function activateOfficerHire(
  playerId: string,
  officerId: OfficerId,
): Promise<PlayerView> {
  const res = await credFetch("/api/activate-officer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, officerId }),
  });
  return parse<PlayerView>(res);
}

export async function unlockSkillNode(
  playerId: string,
  skillId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/unlock-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, skillId }),
  });
  return parse<PlayerView>(res);
}

export async function createAllianceRequest(
  playerId: string,
  opts: { name: string; tag: string; joinMode?: "open" | "invite" },
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function joinAllianceRequest(
  playerId: string,
  opts: { allianceId?: string; tag?: string },
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, ...opts }),
  });
  return parse<PlayerView>(res);
}

export async function leaveAllianceRequest(
  playerId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parse<PlayerView>(res);
}

export async function inviteAllianceRequest(
  playerId: string,
  targetPlayerId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, targetPlayerId }),
  });
  return parse<PlayerView>(res);
}

export async function kickAllianceRequest(
  playerId: string,
  targetPlayerId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/kick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, targetPlayerId }),
  });
  return parse<PlayerView>(res);
}

export async function setAllianceRoleRequest(
  playerId: string,
  targetPlayerId: string,
  role: "founder" | "officer" | "member",
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/set-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, targetPlayerId, role }),
  });
  return parse<PlayerView>(res);
}

export async function setAllianceJoinModeRequest(
  playerId: string,
  joinMode: "open" | "invite",
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/set-join-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, joinMode }),
  });
  return parse<PlayerView>(res);
}

export async function disbandAllianceRequest(
  playerId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/disband", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  return parse<PlayerView>(res);
}
