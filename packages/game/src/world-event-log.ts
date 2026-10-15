import {
  EVENT_LOG_MAX,
  EVENT_LOG_MINI_NEARBY_SYSTEM_RADIUS,
  EVENT_LOG_UNREAD_BADGE,
} from "./catalog.js";
import type {
  Coordinates,
  EventLogEntry,
  EventLogKind,
  PlayerState,
  UniverseState,
} from "./types.js";

export interface NewEventLogEntry {
  kind: EventLogKind;
  title: string;
  body: string;
  createdAt?: number;
  href?: string;
  meta?: EventLogEntry["meta"];
}

export function formatEventCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.floor(n).toLocaleString("en-US");
}

/** Backfill missing logs and keep the ring buffer capped. */
export function ensureEventLog(player: PlayerState): EventLogEntry[] {
  if (!Array.isArray(player.eventLog)) player.eventLog = [];
  if (player.eventLog.length > EVENT_LOG_MAX) {
    player.eventLog.splice(0, player.eventLog.length - EVENT_LOG_MAX);
  }
  return player.eventLog;
}

function nextEventId(now: number): string {
  return `evt_${Math.floor(now).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Append one alert and drop the oldest rows past EVENT_LOG_MAX. */
export function pushEventLog(
  player: PlayerState,
  draft: NewEventLogEntry,
): EventLogEntry {
  const log = ensureEventLog(player);
  const createdAt = draft.createdAt ?? Date.now();
  const entry: EventLogEntry = {
    id: nextEventId(createdAt),
    kind: draft.kind,
    createdAt,
    readAt: null,
    title: draft.title,
    body: draft.body,
  };
  if (draft.href) entry.href = draft.href;
  if (draft.meta) entry.meta = draft.meta;
  log.push(entry);
  if (log.length > EVENT_LOG_MAX) {
    log.splice(0, log.length - EVENT_LOG_MAX);
  }
  return entry;
}

export function unreadEventCount(player: PlayerState): number {
  if (!EVENT_LOG_UNREAD_BADGE) return 0;
  const log = player.eventLog;
  if (!Array.isArray(log)) return 0;
  let n = 0;
  for (const entry of log) {
    if (entry && entry.readAt == null) n += 1;
  }
  return n;
}

/**
 * Mark alerts read. Omit `ids` to mark every unread row.
 * An empty id list marks nothing.
 */
export function markEventsRead(
  universe: UniverseState,
  playerId: string,
  ids: string[] | undefined,
  now = Date.now(),
): { ok: true; marked: number } | { ok: false; error: string } {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const log = ensureEventLog(player);
  const pick = ids == null ? null : new Set(ids);
  let marked = 0;
  for (const entry of log) {
    if (entry.readAt != null) continue;
    if (pick && !pick.has(entry.id)) continue;
    entry.readAt = now;
    marked += 1;
  }
  universe.players[playerId] = player;
  return { ok: true, marked };
}

function ownsPlanetInRadius(
  universe: UniverseState,
  player: PlayerState,
  coords: Coordinates,
): boolean {
  for (const id of player.planetIds) {
    const planet = universe.planets[id];
    if (!planet) continue;
    if (planet.coords.galaxy !== coords.galaxy) continue;
    const delta = Math.abs(planet.coords.system - coords.system);
    if (delta <= EVENT_LOG_MINI_NEARBY_SYSTEM_RADIUS) return true;
  }
  return false;
}

/**
 * Alert every empire that owns a planet within the nearby-system radius.
 * The discoverer is skipped — “while away” means someone else found it.
 * Optional planetId flags that body as a mini and records it on the universe.
 */
export function recordMiniPlanetSighting(
  universe: UniverseState,
  coords: Coordinates,
  discovererPlayerId: string,
  now = Date.now(),
  planetId?: string | null,
): EventLogEntry[] {
  if (planetId && universe.planets[planetId]) {
    const planet = universe.planets[planetId];
    planet.flags = { ...(planet.flags ?? {}), mini: true };
    if (!universe.miniPlanetIds) universe.miniPlanetIds = [];
    if (!universe.miniPlanetIds.includes(planetId)) {
      universe.miniPlanetIds.push(planetId);
    }
  }

  const created: EventLogEntry[] = [];
  const where = `${coords.galaxy}:${coords.system}`;
  for (const player of Object.values(universe.players)) {
    if (player.id === discovererPlayerId) continue;
    if (!ownsPlanetInRadius(universe, player, coords)) continue;
    created.push(
      pushEventLog(player, {
        kind: "miniNearby",
        createdAt: now,
        title: `Mini planet sighted near ${where} (while away)`,
        body: `A mini planet was found at ${where}:${coords.slot} while you were away.`,
        href: "#messages",
        meta: {
          galaxy: coords.galaxy,
          system: coords.system,
          slot: coords.slot,
          discovererPlayerId,
          planetId: planetId ?? null,
        },
      }),
    );
  }
  return created;
}
