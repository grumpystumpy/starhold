import {
  ALLIANCE_CREATE_MIN_POINTS,
  ALLIANCE_APPLICATION_NOTE_MAX,
  ALLIANCE_JOIN_MODE_DEFAULT,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_MAX_OFFICERS,
  ALLIANCE_NAME_MAX,
  ALLIANCE_NAME_MIN,
  ALLIANCE_PENDING_REQUEST_CAP,
  ALLIANCE_RANK_CAP,
  ALLIANCE_RECRUITMENT_BLURB_MAX,
  ALLIANCE_TAG_MAX,
  ALLIANCE_TAG_MIN,
  ALLIANCE_CLASS_ORDER,
} from "./catalog.js";
import {
  empirePoints,
  planetPoints,
  researchPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  AllianceJoinMode,
  AllianceListEntry,
  AllianceRecruitingEntry,
  AllianceMemberView,
  AllianceRankEntry,
  AllianceRecord,
  AllianceRole,
  AllianceView,
  AllianceClassId,
  PendingAllianceRequestView,
  PlayerState,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { allianceSharedView } from "./world-alliance-intel.js";
import { releasePlayerAcsFleets } from "./world-acs.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

/** Local points helper — avoid importing world-view (cycle). */
function playerPointsHint(
  universe: UniverseState,
  player: PlayerState,
): number {
  let points = researchPoints(player.research);
  for (const id of player.planetIds ?? []) {
    const planet = universe.planets[id];
    if (planet) points += planetPoints(planet);
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (fleet.ownerPlayerId === player.id) {
      points += shipStockPoints(fleet.ships);
    }
  }
  return Math.floor(points);
}

export type AllianceActionResult =
  | { ok: true; requested?: boolean }
  | { ok: false; error: string };

function alliancesMap(universe: UniverseState): Record<string, AllianceRecord> {
  if (!universe.alliances) universe.alliances = {};
  return universe.alliances;
}

export function normalizeAllianceTag(raw: string): string | null {
  const tag = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tag.length < ALLIANCE_TAG_MIN || tag.length > ALLIANCE_TAG_MAX) {
    return null;
  }
  return tag;
}

export function normalizeAllianceName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < ALLIANCE_NAME_MIN || name.length > ALLIANCE_NAME_MAX) {
    return null;
  }
  return name;
}

export function isAllianceJoinMode(value: string): value is AllianceJoinMode {
  return value === "open" || value === "invite" || value === "request";
}

export function isAllianceRole(value: string): value is AllianceRole {
  return value === "founder" || value === "officer" || value === "member";
}

export function allianceTagForPlayer(
  universe: UniverseState,
  player: PlayerState | undefined | null,
): string | null {
  if (!player?.allianceId) return null;
  const alliance = universe.alliances?.[player.allianceId];
  return alliance?.tag ?? null;
}

function findAllianceByTag(
  universe: UniverseState,
  tag: string,
): AllianceRecord | null {
  const normalized = normalizeAllianceTag(tag);
  if (!normalized) return null;
  for (const alliance of Object.values(alliancesMap(universe))) {
    if (alliance.tag === normalized) return alliance;
  }
  return null;
}

function nameTaken(universe: UniverseState, name: string, exceptId?: string): boolean {
  const key = name.toLowerCase();
  for (const alliance of Object.values(alliancesMap(universe))) {
    if (exceptId && alliance.id === exceptId) continue;
    if (alliance.name.toLowerCase() === key) return true;
  }
  return false;
}

function tagTaken(universe: UniverseState, tag: string, exceptId?: string): boolean {
  for (const alliance of Object.values(alliancesMap(universe))) {
    if (exceptId && alliance.id === exceptId) continue;
    if (alliance.tag === tag) return true;
  }
  return false;
}

function memberCount(alliance: AllianceRecord): number {
  return Object.keys(alliance.members).length;
}

function officerCount(alliance: AllianceRecord): number {
  return Object.values(alliance.members).filter((m) => m.role === "officer")
    .length;
}

function detachPlayer(universe: UniverseState, playerId: string): void {
  const player = universe.players[playerId];
  if (!player) return;
  player.allianceId = null;
  universe.players[playerId] = player;
}

function removeMember(
  universe: UniverseState,
  alliance: AllianceRecord,
  playerId: string,
  now: number,
): void {
  releasePlayerAcsFleets(universe, playerId, now);
  delete alliance.members[playerId];
  if (alliance.pendingInvites) {
    alliance.pendingInvites = alliance.pendingInvites.filter(
      (id) => id !== playerId,
    );
  }
  detachPlayer(universe, playerId);
  alliancesMap(universe)[alliance.id] = alliance;
}

function clearPendingRequest(universe: UniverseState, playerId: string): void {
  const player = universe.players[playerId];
  if (!player?.pendingAllianceId) return;
  const alliance = alliancesMap(universe)[player.pendingAllianceId];
  if (alliance?.pendingRequests) {
    alliance.pendingRequests = alliance.pendingRequests.filter(
      (request) => request.playerId !== playerId,
    );
    alliancesMap(universe)[alliance.id] = alliance;
  }
  player.pendingAllianceId = null;
  universe.players[playerId] = player;
}

function clearAllianceRequesters(
  universe: UniverseState,
  alliance: AllianceRecord,
): void {
  for (const request of (alliance.pendingRequests ?? []).slice(
    0,
    ALLIANCE_PENDING_REQUEST_CAP,
  )) {
    const player = universe.players[request.playerId];
    if (player?.pendingAllianceId === alliance.id) {
      player.pendingAllianceId = null;
      universe.players[request.playerId] = player;
    }
  }
}

/** Oldest officer, else oldest member. joinedAt ascending, playerId tie-break. */
function successorMemberId(
  alliance: AllianceRecord,
  leavingId: string,
): string | null {
  const others = Object.values(alliance.members).filter(
    (member) => member.playerId !== leavingId,
  );
  if (others.length === 0) return null;
  const officers = others.filter((member) => member.role === "officer");
  const pool = (officers.length > 0 ? officers : others).slice(
    0,
    ALLIANCE_MAX_MEMBERS,
  );
  pool.sort(
    (a, b) =>
      a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId),
  );
  return pool[0]?.playerId ?? null;
}

function storeJoinRequest(
  universe: UniverseState,
  player: PlayerState,
  alliance: AllianceRecord,
  now: number,
): AllianceActionResult {
  if (player.pendingAllianceId && player.pendingAllianceId !== alliance.id) {
    return { ok: false, error: "Cancel your other join request first." };
  }
  const list = alliance.pendingRequests ?? [];
  if (list.some((request) => request.playerId === player.id)) {
    player.pendingAllianceId = alliance.id;
    universe.players[player.id] = player;
    return { ok: true, requested: true };
  }
  if (list.length >= ALLIANCE_PENDING_REQUEST_CAP) {
    return { ok: false, error: "This alliance has too many pending requests." };
  }
  alliance.pendingRequests = [
    ...list,
    { playerId: player.id, requestedAt: now },
  ];
  alliancesMap(universe)[alliance.id] = alliance;
  player.pendingAllianceId = alliance.id;
  universe.players[player.id] = player;
  return { ok: true, requested: true };
}

function listEntry(alliance: AllianceRecord): AllianceListEntry {
  return {
    id: alliance.id,
    name: alliance.name,
    tag: alliance.tag,
    joinMode: alliance.joinMode,
    memberCount: memberCount(alliance),
    maxMembers: ALLIANCE_MAX_MEMBERS,
  };
}

function sortDirectory<T extends AllianceListEntry>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      b.memberCount - a.memberCount ||
      a.tag.localeCompare(b.tag) ||
      a.id.localeCompare(b.id),
  );
}

/** State-poll directory. Recruiting text is intentionally omitted. */
export function allianceDirectory(
  universe: UniverseState,
): AllianceListEntry[] {
  ensureUniverseShape(universe);
  return sortDirectory(Object.values(alliancesMap(universe)).map(listEntry));
}

/**
 * Alliances page directory. Includes the public blurb, Recruiting flag,
 * and application note. Do not attach this to `playerView`.
 */
export function allianceRecruitingDirectory(
  universe: UniverseState,
): AllianceRecruitingEntry[] {
  const alliances = universe.alliances ?? {};
  return sortDirectory(
    Object.values(alliances).map((alliance) => ({
      ...listEntry(alliance),
      recruitmentBlurb: alliance.recruitmentBlurb ?? "",
      recruiting: alliance.recruiting === true,
      applicationNote: alliance.applicationNote ?? "",
    })),
  );
}

function normalizeRecruitingText(raw: string, singleLine: boolean): string {
  let value = raw.replace(/\r\n/g, "\n").trim();
  if (singleLine) {
    value = value.replace(/[\t\n\r]+/g, " ").replace(/ {2,}/g, " ").trim();
  }
  return value;
}

/** Leader-only. Empty text clears the optional field. */
export function setAllianceRecruiting(
  universe: UniverseState,
  playerId: string,
  input: {
    recruitmentBlurb: string;
    recruiting: boolean;
    applicationNote: string;
  },
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  if (
    typeof input.recruitmentBlurb !== "string" ||
    typeof input.applicationNote !== "string"
  ) {
    return { ok: false, error: "Recruitment text must be a string." };
  }
  if (typeof input.recruiting !== "boolean") {
    return { ok: false, error: "Recruiting must be true or false." };
  }
  const blurb = normalizeRecruitingText(input.recruitmentBlurb, true);
  const note = normalizeRecruitingText(input.applicationNote, false);
  if (blurb.length > ALLIANCE_RECRUITMENT_BLURB_MAX) {
    return {
      ok: false,
      error: `Recruitment blurb must be ${ALLIANCE_RECRUITMENT_BLURB_MAX} characters or fewer.`,
    };
  }
  if (note.length > ALLIANCE_APPLICATION_NOTE_MAX) {
    return {
      ok: false,
      error: `Application note must be ${ALLIANCE_APPLICATION_NOTE_MAX} characters or fewer.`,
    };
  }
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder") {
    return { ok: false, error: "Only the Leader can change recruiting." };
  }
  if (blurb) alliance.recruitmentBlurb = blurb;
  else delete alliance.recruitmentBlurb;
  if (input.recruiting) alliance.recruiting = true;
  else delete alliance.recruiting;
  if (note) alliance.applicationNote = note;
  else delete alliance.applicationNote;
  alliancesMap(universe)[alliance.id] = alliance;
  return { ok: true };
}

export function allianceViewFor(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceView | null {
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player?.allianceId) return null;
  const alliance = alliancesMap(universe)[player.allianceId];
  if (!alliance || !alliance.members[playerId]) {
    player.allianceId = null;
    universe.players[playerId] = player;
    return null;
  }
  const members: AllianceMemberView[] = Object.values(alliance.members)
    .map((m) => {
      const p = universe.players[m.playerId];
      return {
        playerId: m.playerId,
        name: p?.name ?? m.playerId,
        role: m.role,
        joinedAt: m.joinedAt,
        pointsHint: p ? playerPointsHint(universe, p) : 0,
      };
    })
    .sort((a, b) => {
      const rank = (r: AllianceRole) =>
        r === "founder" ? 0 : r === "officer" ? 1 : 2;
      return (
        rank(a.role) - rank(b.role) ||
        b.pointsHint - a.pointsHint ||
        a.name.localeCompare(b.name)
      );
    });
  const pendingInvites = (alliance.pendingInvites ?? [])
    .map((id) => {
      const p = universe.players[id];
      return p ? { playerId: id, name: p.name } : null;
    })
    .filter((x): x is { playerId: string; name: string } => x !== null);
  const myRole = alliance.members[playerId].role;
  const pendingRequests =
    myRole === "founder" || myRole === "officer"
      ? (alliance.pendingRequests ?? [])
          .slice(0, ALLIANCE_PENDING_REQUEST_CAP)
          .map((request) => {
            const p = universe.players[request.playerId];
            return {
              playerId: request.playerId,
              name: p?.name ?? request.playerId,
              requestedAt: request.requestedAt,
            };
          })
      : [];
  const shared = allianceSharedView(universe, alliance, now);
  return {
    id: alliance.id,
    name: alliance.name,
    tag: alliance.tag,
    joinMode: alliance.joinMode,
    createdAt: alliance.createdAt,
    founderPlayerId: alliance.founderPlayerId,
    myRole,
    members,
    pendingInvites,
    pendingRequests,
    memberCount: members.length,
    maxMembers: ALLIANCE_MAX_MEMBERS,
    chat: shared.chat,
    intel: shared.intel,
    markers: shared.markers,
    allianceClass: alliance.allianceClass ?? null,
  };
}

export function createAlliance(
  universe: UniverseState,
  playerId: string,
  rawName: string,
  rawTag: string,
  joinMode: AllianceJoinMode = ALLIANCE_JOIN_MODE_DEFAULT,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (player.allianceId) {
    return { ok: false, error: "Already in an alliance — leave first." };
  }
  const name = normalizeAllianceName(rawName);
  if (!name) {
    return {
      ok: false,
      error: `Name must be ${ALLIANCE_NAME_MIN}–${ALLIANCE_NAME_MAX} characters.`,
    };
  }
  const tag = normalizeAllianceTag(rawTag);
  if (!tag) {
    return {
      ok: false,
      error: `Tag must be ${ALLIANCE_TAG_MIN}–${ALLIANCE_TAG_MAX} letters/digits.`,
    };
  }
  if (!isAllianceJoinMode(joinMode)) {
    return { ok: false, error: "Join mode must be open, invite, or request." };
  }
  if (nameTaken(universe, name)) {
    return { ok: false, error: "Alliance name already taken." };
  }
  if (tagTaken(universe, tag)) {
    return { ok: false, error: "Alliance tag already taken." };
  }
  const points = playerPointsHint(universe, player);
  if (points < ALLIANCE_CREATE_MIN_POINTS) {
    return {
      ok: false,
      error: `Need ${ALLIANCE_CREATE_MIN_POINTS} points to create an alliance.`,
    };
  }
  const id = `ally_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const record: AllianceRecord = {
    id,
    name,
    tag,
    joinMode,
    createdAt: now,
    founderPlayerId: playerId,
    members: {
      [playerId]: { playerId, role: "founder", joinedAt: now },
    },
    pendingInvites: [],
  };
  alliancesMap(universe)[id] = record;
  clearPendingRequest(universe, playerId);
  player.allianceId = id;
  universe.players[playerId] = player;
  return { ok: true };
}

export function joinAlliance(
  universe: UniverseState,
  playerId: string,
  opts: { allianceId?: string; tag?: string },
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (player.allianceId) {
    return { ok: false, error: "Already in an alliance — leave first." };
  }
  let alliance: AllianceRecord | null = null;
  if (opts.allianceId) {
    alliance = alliancesMap(universe)[opts.allianceId] ?? null;
  } else if (opts.tag) {
    alliance = findAllianceByTag(universe, opts.tag);
  }
  if (!alliance) return { ok: false, error: "Alliance not found." };
  if (memberCount(alliance) >= ALLIANCE_MAX_MEMBERS) {
    return { ok: false, error: "Alliance is full." };
  }
  if (alliance.joinMode === "request") {
    return storeJoinRequest(universe, player, alliance, now);
  }
  const invited = (alliance.pendingInvites ?? []).includes(playerId);
  if (alliance.joinMode === "invite" && !invited) {
    return { ok: false, error: "Alliance requires an invite." };
  }
  alliance.members[playerId] = {
    playerId,
    role: "member",
    joinedAt: now,
  };
  if (alliance.pendingInvites) {
    alliance.pendingInvites = alliance.pendingInvites.filter(
      (id) => id !== playerId,
    );
  }
  clearPendingRequest(universe, playerId);
  alliancesMap(universe)[alliance.id] = alliance;
  player.allianceId = alliance.id;
  universe.players[playerId] = player;
  return { ok: true };
}

export function leaveAlliance(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!player.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  if (!alliance || !alliance.members[playerId]) {
    player.allianceId = null;
    universe.players[playerId] = player;
    return { ok: true };
  }
  const role = alliance.members[playerId].role;
  if (role === "founder") {
    const nextId = successorMemberId(alliance, playerId);
    if (!nextId) {
      releasePlayerAcsFleets(universe, playerId, now);
      clearAllianceRequesters(universe, alliance);
      delete alliancesMap(universe)[alliance.id];
      detachPlayer(universe, playerId);
      return { ok: true };
    }
    removeMember(universe, alliance, playerId, now);
    const next = alliance.members[nextId];
    if (next) {
      next.role = "founder";
      alliance.founderPlayerId = nextId;
    }
    alliancesMap(universe)[alliance.id] = alliance;
    return { ok: true };
  }
  removeMember(universe, alliance, playerId, now);
  return { ok: true };
}

export function inviteToAlliance(
  universe: UniverseState,
  playerId: string,
  targetPlayerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder" && me.role !== "officer") {
    return { ok: false, error: "Only Founder or Officer can invite." };
  }
  if (alliance.joinMode !== "invite") {
    return { ok: false, error: "Switch to invite mode to send invites." };
  }
  const target = universe.players[targetPlayerId];
  if (!target) return { ok: false, error: "Unknown player." };
  if (target.allianceId) {
    return { ok: false, error: "Player is already in an alliance." };
  }
  if (alliance.members[targetPlayerId]) {
    return { ok: false, error: "Player is already a member." };
  }
  if (memberCount(alliance) >= ALLIANCE_MAX_MEMBERS) {
    return { ok: false, error: "Alliance is full." };
  }
  const invites = alliance.pendingInvites ?? [];
  if (!invites.includes(targetPlayerId)) {
    invites.push(targetPlayerId);
    alliance.pendingInvites = invites;
    alliancesMap(universe)[alliance.id] = alliance;
  }
  return { ok: true };
}

export function kickFromAlliance(
  universe: UniverseState,
  playerId: string,
  targetPlayerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  if (playerId === targetPlayerId) {
    return { ok: false, error: "Use leave to leave the alliance." };
  }
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  const target = alliance?.members[targetPlayerId];
  if (!alliance || !me || !target) {
    return { ok: false, error: "Member not found." };
  }
  if (me.role === "member") {
    return { ok: false, error: "Only Founder or Officer can kick." };
  }
  if (target.role === "founder") {
    return { ok: false, error: "Cannot kick the Founder." };
  }
  if (me.role === "officer" && target.role !== "member") {
    return { ok: false, error: "Officers may only kick Members." };
  }
  removeMember(universe, alliance, targetPlayerId, now);
  return { ok: true };
}

export function setAllianceRole(
  universe: UniverseState,
  playerId: string,
  targetPlayerId: string,
  role: AllianceRole,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  if (!isAllianceRole(role)) {
    return { ok: false, error: "Unknown role." };
  }
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  const target = alliance?.members[targetPlayerId];
  if (!alliance || !me || !target) {
    return { ok: false, error: "Member not found." };
  }
  if (me.role !== "founder") {
    return { ok: false, error: "Only the Founder can change roles." };
  }
  if (role === "founder") {
    if (targetPlayerId === playerId) {
      return { ok: false, error: "Already Founder." };
    }
    target.role = "founder";
    me.role = "officer";
    alliance.founderPlayerId = targetPlayerId;
    if (officerCount(alliance) > ALLIANCE_MAX_OFFICERS) {
      me.role = "member";
    }
    alliancesMap(universe)[alliance.id] = alliance;
    return { ok: true };
  }
  if (targetPlayerId === playerId) {
    return { ok: false, error: "Transfer Founder before changing your role." };
  }
  if (role === "officer") {
    const others =
      officerCount(alliance) - (target.role === "officer" ? 1 : 0);
    if (others >= ALLIANCE_MAX_OFFICERS) {
      return {
        ok: false,
        error: `At most ${ALLIANCE_MAX_OFFICERS} Officers.`,
      };
    }
  }
  target.role = role;
  alliancesMap(universe)[alliance.id] = alliance;
  return { ok: true };
}

export function isAllianceClassId(id: string): id is AllianceClassId {
  return (ALLIANCE_CLASS_ORDER as readonly string[]).includes(id);
}

/** Leader-only. No cost and no cooldown (open question). */
export function setAllianceClass(
  universe: UniverseState,
  playerId: string,
  classId: AllianceClassId | null,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder") {
    return { ok: false, error: "Only the alliance leader can set the class." };
  }
  if (classId != null && !isAllianceClassId(classId)) {
    return { ok: false, error: "Unknown alliance class." };
  }
  if (classId == null) delete alliance.allianceClass;
  else alliance.allianceClass = classId;
  alliancesMap(universe)[alliance.id] = alliance;
  return { ok: true };
}

export function setAllianceJoinMode(
  universe: UniverseState,
  playerId: string,
  joinMode: AllianceJoinMode,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  if (!isAllianceJoinMode(joinMode)) {
    return { ok: false, error: "Join mode must be open, invite, or request." };
  }
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder") {
    return { ok: false, error: "Only the Founder can change join mode." };
  }
  alliance.joinMode = joinMode;
  if (joinMode === "open") {
    alliance.pendingInvites = [];
  }
  alliancesMap(universe)[alliance.id] = alliance;
  return { ok: true };
}

export function disbandAlliance(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Not in an alliance." };
  }
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder") {
    return { ok: false, error: "Only the Founder can disband." };
  }
  const memberIds = Object.keys(alliance.members);
  clearAllianceRequesters(universe, alliance);
  delete alliancesMap(universe)[alliance.id];
  for (const id of memberIds) {
    releasePlayerAcsFleets(universe, id, now);
    detachPlayer(universe, id);
  }
  return { ok: true };
}

function moderatedAlliance(
  universe: UniverseState,
  playerId: string,
):
  | { ok: true; alliance: AllianceRecord }
  | { ok: false; error: string } {
  const player = universe.players[playerId];
  if (!player?.allianceId) return { ok: false, error: "Not in an alliance." };
  const alliance = alliancesMap(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder" && me.role !== "officer") {
    return { ok: false, error: "Only Founder or Officer can review requests." };
  }
  return { ok: true, alliance };
}

export function approveJoinRequest(
  universe: UniverseState,
  playerId: string,
  targetPlayerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = moderatedAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const alliance = gate.alliance;
  const pending = (alliance.pendingRequests ?? []).some(
    (request) => request.playerId === targetPlayerId,
  );
  if (!pending) return { ok: false, error: "No pending request." };
  const target = universe.players[targetPlayerId];
  if (!target) return { ok: false, error: "Unknown player." };
  if (target.allianceId) {
    alliance.pendingRequests = (alliance.pendingRequests ?? []).filter(
      (request) => request.playerId !== targetPlayerId,
    );
    if (target.pendingAllianceId === alliance.id) target.pendingAllianceId = null;
    alliancesMap(universe)[alliance.id] = alliance;
    universe.players[targetPlayerId] = target;
    return { ok: false, error: "Player is already in an alliance." };
  }
  if (memberCount(alliance) >= ALLIANCE_MAX_MEMBERS) {
    return { ok: false, error: "Alliance is full." };
  }
  clearPendingRequest(universe, targetPlayerId);
  alliance.pendingRequests = (alliance.pendingRequests ?? []).filter(
    (request) => request.playerId !== targetPlayerId,
  );
  alliance.members[targetPlayerId] = {
    playerId: targetPlayerId,
    role: "member",
    joinedAt: now,
  };
  alliancesMap(universe)[alliance.id] = alliance;
  target.allianceId = alliance.id;
  target.pendingAllianceId = null;
  universe.players[targetPlayerId] = target;
  return { ok: true };
}

export function rejectJoinRequest(
  universe: UniverseState,
  playerId: string,
  targetPlayerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = moderatedAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const alliance = gate.alliance;
  const pending = (alliance.pendingRequests ?? []).some(
    (request) => request.playerId === targetPlayerId,
  );
  if (!pending) return { ok: false, error: "No pending request." };
  alliance.pendingRequests = (alliance.pendingRequests ?? []).filter(
    (request) => request.playerId !== targetPlayerId,
  );
  alliancesMap(universe)[alliance.id] = alliance;
  const target = universe.players[targetPlayerId];
  if (target?.pendingAllianceId === alliance.id) {
    target.pendingAllianceId = null;
    universe.players[targetPlayerId] = target;
  }
  return { ok: true };
}

export function cancelJoinRequest(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!player.pendingAllianceId) {
    return { ok: false, error: "No pending request." };
  }
  clearPendingRequest(universe, playerId);
  return { ok: true };
}

export function pendingAllianceRequestFor(
  universe: UniverseState,
  player: PlayerState | undefined | null,
): PendingAllianceRequestView | null {
  if (!player?.pendingAllianceId) return null;
  const alliance = universe.alliances?.[player.pendingAllianceId];
  if (!alliance) return null;
  const request = (alliance.pendingRequests ?? []).find(
    (row) => row.playerId === player.id,
  );
  if (!request) return null;
  return {
    allianceId: alliance.id,
    name: alliance.name,
    tag: alliance.tag,
    requestedAt: request.requestedAt,
  };
}

/** Total member points, capped at ALLIANCE_MAX_MEMBERS per alliance. Top 100. */
export function allianceRankBoard(universe: UniverseState): AllianceRankEntry[] {
  ensureUniverseShape(universe);
  const rows = Object.values(alliancesMap(universe)).map((alliance) => {
    const members = Object.values(alliance.members).slice(0, ALLIANCE_MAX_MEMBERS);
    let points = 0;
    for (const member of members) {
      const player = universe.players[member.playerId];
      if (player) points += empirePoints(universe, player);
    }
    points = Math.floor(points);
    const memberCount = members.length;
    return {
      allianceId: alliance.id,
      name: alliance.name,
      tag: alliance.tag,
      memberCount,
      points,
      averagePoints: memberCount > 0 ? Math.floor(points / memberCount) : 0,
    };
  });
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      a.tag.localeCompare(b.tag) ||
      a.allianceId.localeCompare(b.allianceId),
  );
  return rows.slice(0, ALLIANCE_RANK_CAP).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}
