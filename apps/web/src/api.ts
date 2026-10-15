import type {
  AcsPrefill,
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

/** Player mutations already return a fresh view. Reset the background poll. */
let afterPlayerMutation: (() => void) | null = null;

interface StateCacheEntry {
  etag: string | null;
  view: PlayerView;
}

const stateCache = new Map<string, StateCacheEntry>();

/**
 * A successful mutation changed the empire. Drop ETags so the next poll
 * cannot treat a pre-mutation fingerprint as current.
 */
export function invalidateCachedState(): void {
  for (const entry of stateCache.values()) entry.etag = null;
}

function stateCacheKey(
  playerId: string,
  galaxy?: number,
  system?: number,
): string {
  return `${playerId}:${galaxy ?? ""}:${system ?? ""}`;
}

interface UnchangedStateBody {
  unchanged: true;
  now: number;
  resources: Resources;
}

function isUnchangedState(
  data: PlayerView | UnchangedStateBody | CatalogOmittedBody,
): data is UnchangedStateBody {
  return "unchanged" in data && data.unchanged === true;
}

interface CatalogOmittedBody extends PlayerView {
  catalogsOmitted: true;
}

export function setAfterPlayerMutation(fn: () => void): void {
  afterPlayerMutation = fn;
}

const credFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const res = await fetch(input, { credentials: "include", ...init });
  if (method !== "GET" && method !== "HEAD" && res.ok) {
    afterPlayerMutation?.();
  }
  return res;
};

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
  view?: PlayerView | null;
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
  let attemptId: string | undefined;
  for (let step = 0; step < 40; step++) {
    const res = await credFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, attemptId }),
    });
    if (res.status === 202) {
      const body = (await res.json()) as { attemptId?: string };
      if (!body.attemptId) {
        throw new Error("Login did not finish.");
      }
      attemptId = body.attemptId;
      continue;
    }
    return parse(res);
  }
  throw new Error("Login did not finish.");
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
  const key = stateCacheKey(playerId, galaxy, system);
  const cached = stateCache.get(key);
  const headers: Record<string, string> = {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if ((cached?.view.officerCatalog?.length ?? 0) > 0) {
    headers["X-Starhold-Have-Catalogs"] = "1";
  }
  const res = await credFetch(`/api/state?${params.toString()}`, { headers });
  const etag = res.headers.get("ETag");
  const data = await parse<
    PlayerView | UnchangedStateBody | CatalogOmittedBody
  >(res);
  if (isUnchangedState(data)) {
    if (!cached) throw new Error("State unchanged without a cached view.");
    const view: PlayerView = {
      ...cached.view,
      now: data.now,
      planet: {
        ...cached.view.planet,
        resources: data.resources,
        lastTickAt: data.now,
      },
    };
    stateCache.set(key, { etag: etag ?? cached.etag, view });
    return view;
  }
  let view: PlayerView = data;
  if ("catalogsOmitted" in data && data.catalogsOmitted) {
    if (!cached?.view.officerCatalog || !cached.view.skillCatalog) {
      throw new Error("Catalogs omitted without a cached catalog.");
    }
    const { catalogsOmitted: _omitted, ...rest } = data;
    view = {
      ...rest,
      officerCatalog: cached.view.officerCatalog,
      skillCatalog: cached.view.skillCatalog,
    };
  }
  stateCache.set(key, { etag, view });
  return view;
}

export async function markEventsRead(
  playerId: string,
  ids?: string[],
): Promise<PlayerView> {
  const body: { playerId: string; ids?: string[] } = { playerId };
  if (ids) body.ids = ids;
  const res = await credFetch("/api/events/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  alienBaseId?: string;
    cargo?: Partial<Resources>;
    openAcs?: boolean;
    acsGroupId?: string;
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

export async function claimGoalReward(
  playerId: string,
  goalId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/claim-goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, goalId }),
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

export async function claimSeasonReward(
  playerId: string,
  board: string,
  seasonId?: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/season/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, board, seasonId }),
  });
  return parse<PlayerView>(res);
}

export async function setCosmeticTitle(
  playerId: string,
  title: string | null,
): Promise<PlayerView> {
  const res = await credFetch("/api/cosmetics/title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, title }),
  });
  return parse<PlayerView>(res);
}

export async function setCosmeticSkin(
  playerId: string,
  skinId: string | null,
): Promise<PlayerView> {
  const res = await credFetch("/api/cosmetics/planet-skin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, skinId }),
  });
  return parse<PlayerView>(res);
}

export async function raiseOfficerLevel(
  playerId: string,
  officerId: OfficerId,
): Promise<PlayerView> {
  const res = await credFetch("/api/raise-officer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, officerId }),
  });
  return parse<PlayerView>(res);
}

export async function deleteMessages(
  playerId: string,
  category: "all" | "combat" | "spy" | "alerts",
): Promise<PlayerView> {
  const res = await credFetch("/api/delete-messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, category }),
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

export async function chooseClass(
  playerId: string,
  classId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/class/choose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, classId }),
  });
  return parse<PlayerView>(res);
}

export async function changeClass(
  playerId: string,
  classId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/class/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, classId }),
  });
  return parse<PlayerView>(res);
}

export async function relocateMiniFortress(
  playerId: string,
  planetId: string,
  galaxy: number,
  system: number,
): Promise<PlayerView> {
  const res = await credFetch("/api/mini-relocate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, planetId, galaxy, system }),
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

export async function postAllianceChatRequest(body: string): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return parse<PlayerView>(res);
}

export async function shareAllianceIntelRequest(
  spyReportId: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/intel/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spyReportId }),
  });
  return parse<PlayerView>(res);
}

export async function deleteAllianceIntelRequest(
  intelId: string,
): Promise<PlayerView> {
  const res = await credFetch(
    `/api/alliance/intel/${encodeURIComponent(intelId)}`,
    { method: "DELETE" },
  );
  return parse<PlayerView>(res);
}

export async function upsertAllianceMarkerRequest(
  coords: Coordinates,
  note: string,
): Promise<PlayerView> {
  const res = await credFetch("/api/alliance/markers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coords, note }),
  });
  return parse<PlayerView>(res);
}

export async function deleteAllianceMarkerRequest(
  markerId: string,
): Promise<PlayerView> {
  const res = await credFetch(
    `/api/alliance/markers/${encodeURIComponent(markerId)}`,
    { method: "DELETE" },
  );
  return parse<PlayerView>(res);
}

export async function proposeAllianceStrikeRequest(opts: {
  coords: Coordinates;
  note?: string;
  mission?: "raid" | "pirateRaid";
}): Promise<{ planId: string; acsPrefill: AcsPrefill | null; view: PlayerView }> {
  const res = await credFetch("/api/alliance/plan-strike", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return parse(res);
}
