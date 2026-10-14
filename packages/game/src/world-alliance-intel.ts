import {
  ALLIANCE_CHAT_MAX_CHARS,
  ALLIANCE_CHAT_MAX_MESSAGES,
  ALLIANCE_CHAT_RATE_PER_MIN,
  ALLIANCE_INTEL_MAX_REPORTS,
  ALLIANCE_MARKER_NOTE_MAX,
  ALLIANCE_MARKER_TTL_MS,
  ALLIANCE_MARKERS_MAX,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
} from "./catalog.js";
import type {
  AcsPrefill,
  AllianceChatMessage,
  AllianceGalaxyMarker,
  AllianceIntelSnapshot,
  AllianceIntelStamp,
  AllianceRecord,
  AllianceRole,
  Coordinates,
  EspionageReport,
  PlayerState,
  UniverseState,
} from "./types.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

export type AllianceIntelResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const chatWriteTimes = new Map<string, number[]>();

/** Test hook — chat rate limit is in-process, not stored on the universe. */
export function resetAllianceChatRateLimit(): void {
  chatWriteTimes.clear();
}

/**
 * Joint Strike engine (`world-acs`) is optional.
 * This build has no ACS helpers, so plan-strike omits `acsPrefill`
 * and the client shows the coming-with-Joint-Strike path.
 */
export function jointStrikeHelpersAvailable(): boolean {
  return false;
}

function makeId(prefix: string, now: number): string {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sameCoords(a: Coordinates, b: Coordinates): boolean {
  return a.galaxy === b.galaxy && a.system === b.system && a.slot === b.slot;
}

export function parseAllianceCoords(raw: {
  galaxy?: number;
  system?: number;
  slot?: number;
}): Coordinates | null {
  const galaxy = Number(raw.galaxy);
  const system = Number(raw.system);
  const slot = Number(raw.slot);
  if (!Number.isInteger(galaxy) || galaxy < 1 || galaxy > MAP_GALAXIES) {
    return null;
  }
  if (!Number.isInteger(system) || system < 1 || system > MAP_SYSTEMS) {
    return null;
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > MAP_SLOTS) {
    return null;
  }
  return { galaxy, system, slot };
}

function stripControls(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function ensureBoard(alliance: AllianceRecord): void {
  if (!Array.isArray(alliance.chat)) alliance.chat = [];
  if (!Array.isArray(alliance.intel)) alliance.intel = [];
  if (!Array.isArray(alliance.markers)) alliance.markers = [];
}

function membership(
  universe: UniverseState,
  playerId: string,
):
  | { ok: true; player: PlayerState; alliance: AllianceRecord; role: AllianceRole }
  | { ok: false; error: string } {
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!player.allianceId) return { ok: false, error: "Not in an alliance." };
  const alliance = universe.alliances?.[player.allianceId];
  const member = alliance?.members[playerId];
  if (!alliance || !member) {
    player.allianceId = null;
    universe.players[playerId] = player;
    return { ok: false, error: "Not in an alliance." };
  }
  ensureBoard(alliance);
  return { ok: true, player, alliance, role: member.role };
}

function canModerate(role: AllianceRole): boolean {
  return role === "founder" || role === "officer";
}

function allowChatWrite(playerId: string, now: number): boolean {
  const windowStart = now - 60_000;
  const recent = (chatWriteTimes.get(playerId) ?? []).filter(
    (t) => t > windowStart,
  );
  if (recent.length >= ALLIANCE_CHAT_RATE_PER_MIN) {
    chatWriteTimes.set(playerId, recent);
    return false;
  }
  recent.push(now);
  chatWriteTimes.set(playerId, recent);
  return true;
}

function purgeMarkers(alliance: AllianceRecord, now: number): void {
  ensureBoard(alliance);
  alliance.markers = alliance.markers!.filter((m) => m.expiresAt > now);
}

function snapshotOf(report: EspionageReport): AllianceIntelSnapshot {
  return {
    detail: report.detail,
    summary: report.summary,
    resources: report.resources
      ? {
          metal: report.resources.metal,
          crystal: report.resources.crystal,
          deuterium: report.resources.deuterium,
        }
      : null,
    ships: report.ships ? { ...report.ships } : null,
    defenses: report.defenses ? { ...report.defenses } : null,
  };
}

function playerName(
  universe: UniverseState,
  playerId: string,
  fallback: string,
): string {
  return universe.players[playerId]?.name ?? fallback;
}

export function allianceSharedView(
  universe: UniverseState,
  alliance: AllianceRecord,
  now = Date.now(),
): {
  chat: AllianceChatMessage[];
  intel: AllianceIntelStamp[];
  markers: AllianceGalaxyMarker[];
} {
  ensureBoard(alliance);
  purgeMarkers(alliance, now);
  const chat = [...alliance.chat!].sort((a, b) => a.createdAt - b.createdAt);
  const intel = [...alliance.intel!].sort((a, b) => b.createdAt - a.createdAt);
  const markers = [...alliance.markers!].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  return { chat, intel, markers };
}

export function listAllianceChat(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceIntelResult<{ messages: AllianceChatMessage[] }> {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const board = allianceSharedView(universe, member.alliance, now);
  return { ok: true, messages: board.chat };
}

export function postAllianceChat(
  universe: UniverseState,
  playerId: string,
  rawBody: string,
  now = Date.now(),
): AllianceIntelResult<{ message: AllianceChatMessage }> {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const body = stripControls(rawBody);
  if (!body) return { ok: false, error: "Message is empty." };
  if (body.length > ALLIANCE_CHAT_MAX_CHARS) {
    return {
      ok: false,
      error: `Message must be ${ALLIANCE_CHAT_MAX_CHARS} characters or fewer.`,
    };
  }
  if (!allowChatWrite(playerId, now)) {
    return {
      ok: false,
      error: `Chat limit is ${ALLIANCE_CHAT_RATE_PER_MIN} messages per minute.`,
    };
  }
  const message: AllianceChatMessage = {
    id: makeId("chat", now),
    playerId,
    displayName: member.player.name,
    body,
    createdAt: now,
  };
  const chat = member.alliance.chat!;
  chat.push(message);
  while (chat.length > ALLIANCE_CHAT_MAX_MESSAGES) chat.shift();
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true, message };
}

export function listAllianceIntel(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceIntelResult<{ intel: AllianceIntelStamp[] }> {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const board = allianceSharedView(universe, member.alliance, now);
  return { ok: true, intel: board.intel };
}

export function shareAllianceIntel(
  universe: UniverseState,
  playerId: string,
  spyReportId: string,
  now = Date.now(),
): AllianceIntelResult<{ stamp: AllianceIntelStamp }> {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const id = spyReportId.trim();
  if (!id) return { ok: false, error: "spyReportId required." };
  const report = universe.spyReports?.[id];
  if (!report || report.spyPlayerId !== playerId) {
    return { ok: false, error: "Spy report not found." };
  }
  const intel = member.alliance.intel!;
  if (intel.some((stamp) => stamp.spyReportId === report.id)) {
    return { ok: false, error: "That spy report is already shared." };
  }
  const stamp: AllianceIntelStamp = {
    id: makeId("intel", now),
    sharedByPlayerId: playerId,
    sharedByName: member.player.name,
    spyReportId: report.id,
    targetCoords: { ...report.targetCoords },
    targetLabel: report.targetName,
    createdAt: now,
    expiresAt: null,
    snapshot: snapshotOf(report),
  };
  intel.push(stamp);
  while (intel.length > ALLIANCE_INTEL_MAX_REPORTS) intel.shift();
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true, stamp };
}

export function deleteAllianceIntel(
  universe: UniverseState,
  playerId: string,
  intelId: string,
  _now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const intel = member.alliance.intel!;
  const stamp = intel.find((row) => row.id === intelId);
  if (!stamp) return { ok: false, error: "Intel not found." };
  if (stamp.sharedByPlayerId !== playerId && !canModerate(member.role)) {
    return {
      ok: false,
      error: "Only the sharer, Founder, or Officer can remove intel.",
    };
  }
  member.alliance.intel = intel.filter((row) => row.id !== intelId);
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true };
}

export function listAllianceMarkers(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceIntelResult<{ markers: AllianceGalaxyMarker[] }> {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const board = allianceSharedView(universe, member.alliance, now);
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true, markers: board.markers };
}

export function upsertAllianceMarker(
  universe: UniverseState,
  playerId: string,
  coords: Coordinates,
  rawNote: string,
  now = Date.now(),
): AllianceIntelResult<{ marker: AllianceGalaxyMarker }> {
  const parsed = parseAllianceCoords(coords);
  if (!parsed) return { ok: false, error: "Coordinates are out of range." };
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const note = stripControls(rawNote);
  if (note.length > ALLIANCE_MARKER_NOTE_MAX) {
    return {
      ok: false,
      error: `Marker note must be ${ALLIANCE_MARKER_NOTE_MAX} characters or fewer.`,
    };
  }
  purgeMarkers(member.alliance, now);
  const markers = member.alliance.markers!;
  const existing = markers.find((m) => sameCoords(m.coords, parsed));
  if (existing) {
    existing.note = note;
    existing.createdByPlayerId = playerId;
    existing.createdByName = member.player.name;
    existing.createdAt = now;
    existing.expiresAt = now + ALLIANCE_MARKER_TTL_MS;
    universe.alliances![member.alliance.id] = member.alliance;
    return { ok: true, marker: existing };
  }
  if (markers.length >= ALLIANCE_MARKERS_MAX) {
    markers.sort((a, b) => a.createdAt - b.createdAt);
    markers.shift();
  }
  const marker: AllianceGalaxyMarker = {
    id: makeId("mark", now),
    coords: parsed,
    note,
    createdByPlayerId: playerId,
    createdByName: member.player.name,
    createdAt: now,
    expiresAt: now + ALLIANCE_MARKER_TTL_MS,
  };
  markers.push(marker);
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true, marker };
}

export function deleteAllianceMarker(
  universe: UniverseState,
  playerId: string,
  markerId: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  purgeMarkers(member.alliance, now);
  const markers = member.alliance.markers!;
  const marker = markers.find((row) => row.id === markerId);
  if (!marker) return { ok: false, error: "Marker not found." };
  if (marker.createdByPlayerId !== playerId && !canModerate(member.role)) {
    return {
      ok: false,
      error: "Only the creator, Founder, or Officer can remove a marker.",
    };
  }
  member.alliance.markers = markers.filter((row) => row.id !== markerId);
  universe.alliances![member.alliance.id] = member.alliance;
  return { ok: true };
}

export type StrikeMission = "raid" | "pirateRaid";

export function isStrikeMission(value: string): value is StrikeMission {
  return value === "raid" || value === "pirateRaid";
}

function acsPrefillFor(
  coords: Coordinates,
  mission: StrikeMission,
  note: string,
): AcsPrefill | null {
  if (!jointStrikeHelpersAvailable()) return null;
  return { coords, mission, note, openAcs: true };
}

export function proposeAllianceStrike(
  universe: UniverseState,
  playerId: string,
  coords: Coordinates,
  rawNote: string | undefined,
  mission: StrikeMission,
  now = Date.now(),
): AllianceIntelResult<{ planId: string; acsPrefill: AcsPrefill | null }> {
  const parsed = parseAllianceCoords(coords);
  if (!parsed) return { ok: false, error: "Coordinates are out of range." };
  const note = rawNote ? stripControls(rawNote) : "";
  if (note.length > ALLIANCE_MARKER_NOTE_MAX) {
    return {
      ok: false,
      error: `Note must be ${ALLIANCE_MARKER_NOTE_MAX} characters or fewer.`,
    };
  }
  const member = membership(universe, playerId);
  if (!member.ok) return member;
  const label = `${parsed.galaxy}:${parsed.system}:${parsed.slot}`;
  let body = `${member.player.name} proposed Joint Strike on ${label}`;
  if (note) {
    const extra = ` — ${note}`;
    if (body.length + extra.length <= ALLIANCE_CHAT_MAX_CHARS) {
      body += extra;
    }
  }
  const posted = postAllianceChat(universe, playerId, body, now);
  if (!posted.ok) return posted;
  return {
    ok: true,
    planId: posted.message.id,
    acsPrefill: acsPrefillFor(parsed, mission, note),
  };
}

export function galaxyMarkerOverlay(
  universe: UniverseState,
  playerId: string,
  galaxy: number,
  system: number,
  now = Date.now(),
): Map<number, { id: string; note: string; markedBy: string }> {
  const member = membership(universe, playerId);
  const out = new Map<number, { id: string; note: string; markedBy: string }>();
  if (!member.ok) return out;
  purgeMarkers(member.alliance, now);
  for (const marker of member.alliance.markers ?? []) {
    if (marker.coords.galaxy !== galaxy || marker.coords.system !== system) {
      continue;
    }
    out.set(marker.coords.slot, {
      id: marker.id,
      note: marker.note,
      markedBy: playerName(universe, marker.createdByPlayerId, marker.createdByName),
    });
  }
  universe.alliances![member.alliance.id] = member.alliance;
  return out;
}
