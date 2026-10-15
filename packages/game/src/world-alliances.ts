import {
  ALLIANCE_CREATE_MIN_POINTS,
  ALLIANCE_JOIN_MODE_DEFAULT,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_MAX_OFFICERS,
  ALLIANCE_NAME_MAX,
  ALLIANCE_NAME_MIN,
  ALLIANCE_TAG_MAX,
  ALLIANCE_TAG_MIN,
} from "./catalog.js";
import {
  planetPoints,
  researchPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  AllianceJoinMode,
  AllianceListEntry,
  AllianceMemberView,
  AllianceRecord,
  AllianceRole,
  AllianceView,
  PlayerState,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { allianceSharedView } from "./world-alliance-intel.js";
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
  | { ok: true }
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
  return value === "open" || value === "invite";
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
): void {
  delete alliance.members[playerId];
  if (alliance.pendingInvites) {
    alliance.pendingInvites = alliance.pendingInvites.filter(
      (id) => id !== playerId,
    );
  }
  detachPlayer(universe, playerId);
  alliancesMap(universe)[alliance.id] = alliance;
}

export function allianceDirectory(
  universe: UniverseState,
): AllianceListEntry[] {
  ensureUniverseShape(universe);
  return Object.values(alliancesMap(universe))
    .map((a) => ({
      id: a.id,
      name: a.name,
      tag: a.tag,
      joinMode: a.joinMode,
      memberCount: memberCount(a),
      maxMembers: ALLIANCE_MAX_MEMBERS,
    }))
    .sort(
      (a, b) =>
        b.memberCount - a.memberCount ||
        a.tag.localeCompare(b.tag) ||
        a.id.localeCompare(b.id),
    );
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
  const shared = allianceSharedView(universe, alliance, now);
  return {
    id: alliance.id,
    name: alliance.name,
    tag: alliance.tag,
    joinMode: alliance.joinMode,
    createdAt: alliance.createdAt,
    founderPlayerId: alliance.founderPlayerId,
    myRole: alliance.members[playerId].role,
    members,
    pendingInvites,
    memberCount: members.length,
    maxMembers: ALLIANCE_MAX_MEMBERS,
    chat: shared.chat,
    intel: shared.intel,
    markers: shared.markers,
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
    return { ok: false, error: "Join mode must be open or invite." };
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
    const others = Object.keys(alliance.members).filter((id) => id !== playerId);
    if (others.length > 0) {
      return {
        ok: false,
        error: "Transfer Founder or disband before leaving.",
      };
    }
    delete alliancesMap(universe)[alliance.id];
    detachPlayer(universe, playerId);
    return { ok: true };
  }
  removeMember(universe, alliance, playerId);
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
  removeMember(universe, alliance, targetPlayerId);
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

export function setAllianceJoinMode(
  universe: UniverseState,
  playerId: string,
  joinMode: AllianceJoinMode,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  if (!isAllianceJoinMode(joinMode)) {
    return { ok: false, error: "Join mode must be open or invite." };
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
  delete alliancesMap(universe)[alliance.id];
  for (const id of memberIds) {
    detachPlayer(universe, id);
  }
  return { ok: true };
}
