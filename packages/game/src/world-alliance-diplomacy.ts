import { ALLIANCE_RELATION_CAP } from "./catalog.js";
import type {
  AllianceDiplomacyKind,
  AllianceRecord,
  AllianceRelation,
  AllianceRelationStatus,
  AllianceRelationView,
  AllianceRole,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

type AllianceActionResult =
  | { ok: true }
  | { ok: false; error: string };

const LEADER_ERROR = "Only the alliance leader can change diplomacy.";

function alliances(universe: UniverseState): Record<string, AllianceRecord> {
  if (!universe.alliances) universe.alliances = {};
  return universe.alliances;
}

function isKind(value: unknown): value is AllianceDiplomacyKind {
  return value === "nap" || value === "war";
}

function isStatus(value: unknown): value is AllianceRelationStatus {
  return value === "pending" || value === "active";
}

/** Stored rows the game will show. Malformed rows stay on the record until cancel. */
export function readableRelations(alliance: AllianceRecord): AllianceRelation[] {
  const rows = alliance.relations ?? [];
  const out: AllianceRelation[] = [];
  for (const row of rows) {
    if (out.length >= ALLIANCE_RELATION_CAP) break;
    if (!row || typeof row.allianceId !== "string" || row.allianceId.length === 0) {
      continue;
    }
    if (!isKind(row.kind) || !isStatus(row.status)) continue;
    if (row.kind === "war" && row.status !== "active") continue;
    if (typeof row.initiatedBy !== "string" || typeof row.since !== "number") continue;
    out.push(row);
  }
  return out;
}

/** Active NAP or war, keyed by the other alliance id. Pending pacts are omitted. */
export function activeDiplomacyFor(
  universe: UniverseState,
  viewerId: string,
): Map<string, AllianceDiplomacyKind> {
  const out = new Map<string, AllianceDiplomacyKind>();
  const allianceId = universe.players[viewerId]?.allianceId;
  if (!allianceId) return out;
  const alliance = universe.alliances?.[allianceId];
  if (!alliance) return out;
  for (const row of readableRelations(alliance)) {
    if (row.status !== "active" || row.allianceId === allianceId) continue;
    out.set(row.allianceId, row.kind);
  }
  return out;
}

export function allianceRelationViews(
  universe: UniverseState,
  alliance: AllianceRecord,
  myRole: AllianceRole,
): AllianceRelationView[] {
  const founder = myRole === "founder";
  const views = readableRelations(alliance).map((row) => {
    const other = universe.alliances?.[row.allianceId];
    const canAccept =
      founder &&
      row.kind === "nap" &&
      row.status === "pending" &&
      row.initiatedBy !== alliance.id;
    const canCancel =
      founder &&
      (other == null || row.kind === "nap" || row.initiatedBy === alliance.id);
    return {
      allianceId: row.allianceId,
      name: other?.name ?? "Unknown",
      tag: other?.tag ?? "?",
      kind: row.kind,
      status: row.status,
      initiatedBy: row.initiatedBy,
      since: row.since,
      canAccept,
      canCancel,
    };
  });
  views.sort(
    (a, b) => a.tag.localeCompare(b.tag) || a.allianceId.localeCompare(b.allianceId),
  );
  return views;
}

function linked(alliance: AllianceRecord, otherId: string): boolean {
  return (alliance.relations ?? []).some((row) => row?.allianceId === otherId);
}

function atCap(alliance: AllianceRecord): boolean {
  return (alliance.relations?.length ?? 0) >= ALLIANCE_RELATION_CAP;
}

function upsert(list: AllianceRelation[] | undefined, row: AllianceRelation): AllianceRelation[] {
  const next = (list ?? []).filter((item) => item?.allianceId !== row.allianceId);
  next.push(row);
  next.sort((a, b) => a.allianceId.localeCompare(b.allianceId));
  return next;
}

function writePair(
  universe: UniverseState,
  left: AllianceRecord,
  right: AllianceRecord,
  kind: AllianceDiplomacyKind,
  status: AllianceRelationStatus,
  initiatedBy: string,
  since: number,
): void {
  const map = alliances(universe);
  left.relations = upsert(left.relations, {
    allianceId: right.id,
    kind,
    status,
    initiatedBy,
    since,
  });
  right.relations = upsert(right.relations, {
    allianceId: left.id,
    kind,
    status,
    initiatedBy,
    since,
  });
  map[left.id] = left;
  map[right.id] = right;
}

function dropPair(
  universe: UniverseState,
  alliance: AllianceRecord,
  otherId: string,
): void {
  const map = alliances(universe);
  const trim = (record: AllianceRecord | undefined, id: string) => {
    if (!record?.relations) return;
    const next = record.relations.filter((row) => row?.allianceId !== id);
    if (next.length === 0) delete record.relations;
    else record.relations = next;
  };
  trim(alliance, otherId);
  trim(map[otherId], alliance.id);
  map[alliance.id] = alliance;
}

/** Drop this alliance from every partner, then drop its own list. */
export function clearAllianceDiplomacy(
  universe: UniverseState,
  allianceId: string,
): void {
  const map = universe.alliances;
  if (!map) return;
  const alliance = map[allianceId];
  for (const row of alliance?.relations ?? []) {
    if (!row || typeof row.allianceId !== "string") continue;
    const other = map[row.allianceId];
    if (!other?.relations) continue;
    const next = other.relations.filter((item) => item?.allianceId !== allianceId);
    if (next.length === 0) delete other.relations;
    else other.relations = next;
  }
  if (alliance?.relations) delete alliance.relations;
}

function leaderAlliance(
  universe: UniverseState,
  playerId: string,
): { ok: true; alliance: AllianceRecord } | { ok: false; error: string } {
  const player = universe.players[playerId];
  if (!player?.allianceId) return { ok: false, error: "Not in an alliance." };
  const alliance = alliances(universe)[player.allianceId];
  const me = alliance?.members[playerId];
  if (!alliance || !me) return { ok: false, error: "Not in an alliance." };
  if (me.role !== "founder") return { ok: false, error: LEADER_ERROR };
  return { ok: true, alliance };
}

function targetAlliance(
  universe: UniverseState,
  alliance: AllianceRecord,
  rawId: string,
): { ok: true; other: AllianceRecord } | { ok: false; error: string } {
  const allianceId = rawId.trim();
  if (!allianceId || allianceId === alliance.id) {
    return { ok: false, error: "Cannot set diplomacy with your own alliance." };
  }
  const other = alliances(universe)[allianceId];
  if (!other) return { ok: false, error: "Alliance not found." };
  return { ok: true, other };
}

function rejectIfLinked(
  alliance: AllianceRecord,
  other: AllianceRecord,
): AllianceActionResult | null {
  if (linked(alliance, other.id) || linked(other, alliance.id)) {
    return {
      ok: false,
      error: "Cancel the current relation with that alliance first.",
    };
  }
  if (atCap(alliance) || atCap(other)) {
    return { ok: false, error: `Too many relations (${ALLIANCE_RELATION_CAP}).` };
  }
  return null;
}

export function offerAllianceNap(
  universe: UniverseState,
  playerId: string,
  targetAllianceId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = leaderAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const target = targetAlliance(universe, gate.alliance, targetAllianceId);
  if (!target.ok) return target;
  const blocked = rejectIfLinked(gate.alliance, target.other);
  if (blocked) return blocked;
  writePair(universe, gate.alliance, target.other, "nap", "pending", gate.alliance.id, now);
  return { ok: true };
}

export function acceptAllianceNap(
  universe: UniverseState,
  playerId: string,
  targetAllianceId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = leaderAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const target = targetAlliance(universe, gate.alliance, targetAllianceId);
  if (!target.ok) return target;
  const row = readableRelations(gate.alliance).find(
    (item) => item.allianceId === target.other.id,
  );
  if (!row || row.kind !== "nap" || row.status !== "pending") {
    return { ok: false, error: "No pact is waiting for you." };
  }
  if (row.initiatedBy === gate.alliance.id) {
    return { ok: false, error: "The other alliance leader accepts this pact." };
  }
  writePair(
    universe,
    gate.alliance,
    target.other,
    "nap",
    "active",
    row.initiatedBy,
    row.since,
  );
  return { ok: true };
}

export function declareAllianceWar(
  universe: UniverseState,
  playerId: string,
  targetAllianceId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = leaderAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const target = targetAlliance(universe, gate.alliance, targetAllianceId);
  if (!target.ok) return target;
  const blocked = rejectIfLinked(gate.alliance, target.other);
  if (blocked) return blocked;
  writePair(universe, gate.alliance, target.other, "war", "active", gate.alliance.id, now);
  return { ok: true };
}

export function cancelAllianceRelation(
  universe: UniverseState,
  playerId: string,
  targetAllianceId: string,
  now = Date.now(),
): AllianceActionResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const gate = leaderAlliance(universe, playerId);
  if (!gate.ok) return gate;
  const allianceId = targetAllianceId.trim();
  if (!allianceId || allianceId === gate.alliance.id) {
    return { ok: false, error: "Cannot set diplomacy with your own alliance." };
  }
  const row = (gate.alliance.relations ?? []).find((item) => item?.allianceId === allianceId);
  if (!row) return { ok: false, error: "No relation with that alliance." };
  const other = alliances(universe)[allianceId];
  const war =
    row.kind === "war" ||
    readableRelations(gate.alliance).some(
      (item) => item.allianceId === allianceId && item.kind === "war",
    );
  if (war && other && row.initiatedBy !== gate.alliance.id) {
    return { ok: false, error: "Only the alliance that declared the war can end it." };
  }
  dropPair(universe, gate.alliance, allianceId);
  return { ok: true };
}
