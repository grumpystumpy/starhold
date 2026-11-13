import type { PlayerView } from "@starhold/game";

/** Device-local last visit. One key per commander, same storage style as the install note. */
export const LAST_VISIT_PREFIX = "starhold-last-visit:";

export interface VisitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AwayRecapCounts {
  fleetReturns: number;
  raids: number;
  minis: number;
  unreadReports: number;
}

export function lastVisitKey(playerId: string): string {
  return `${LAST_VISIT_PREFIX}${playerId}`;
}

/** Missing or unreadable stamps count as no prior visit. */
export function readLastVisit(
  storage: VisitStorage | null | undefined,
  playerId: string,
): number {
  if (!storage || !playerId) return 0;
  let raw: string | null = null;
  try {
    raw = storage.getItem(lastVisitKey(playerId));
  } catch {
    return 0;
  }
  if (raw == null || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function writeLastVisit(
  storage: VisitStorage | null | undefined,
  playerId: string,
  now: number,
): void {
  if (!storage || !playerId) return;
  if (!Number.isFinite(now) || now < 0) return;
  try {
    storage.setItem(lastVisitKey(playerId), String(Math.floor(now)));
  } catch {
    /* Private mode can reject localStorage. The recap stays until a later write. */
  }
}

export function browserVisitStorage(): VisitStorage | null {
  try {
    const storage = (globalThis as { localStorage?: VisitStorage }).localStorage;
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function"
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

export function readBrowserLastVisit(playerId: string): number {
  return readLastVisit(browserVisitStorage(), playerId);
}

/** Client clock and the last server `now`, so a dismiss covers rows already on screen. */
export function visitStamp(clientNow: number, serverNow?: number | null): number {
  const client = Number.isFinite(clientNow) && clientNow > 0 ? clientNow : 0;
  const server =
    typeof serverNow === "number" && Number.isFinite(serverNow) && serverNow > 0
      ? serverNow
      : 0;
  return Math.max(client, server);
}

function countNewer(
  reports: Array<{ at?: number }> | undefined,
  lastVisit: number,
): number {
  if (!reports) return 0;
  let n = 0;
  for (const report of reports) {
    if (report && typeof report.at === "number" && report.at > lastVisit) n += 1;
  }
  return n;
}

/**
 * Events and reports strictly newer than the last visit.
 * `buildComplete` is not part of this recap.
 * Unread reports are combat, spy, and expedition rows the player has not
 * been present for (those rows have no read flag).
 */
export function awayRecapCounts(
  view: PlayerView,
  lastVisit: number,
): AwayRecapCounts {
  const log = view.player.eventLog ?? [];
  let fleetReturns = 0;
  let raids = 0;
  let minis = 0;
  for (const entry of log) {
    if (!entry || !(entry.createdAt > lastVisit)) continue;
    switch (entry.kind) {
      case "fleetReturn":
        fleetReturns += 1;
        break;
      case "raidAlert":
        raids += 1;
        break;
      case "miniNearby":
        minis += 1;
        break;
      case "buildComplete":
        break;
      default: {
        const _exhaustive: never = entry.kind;
        void _exhaustive;
        break;
      }
    }
  }
  const unreadReports =
    countNewer(view.reports, lastVisit) +
    countNewer(view.spyReports, lastVisit) +
    countNewer(view.expeditionReports, lastVisit);
  return { fleetReturns, raids, minis, unreadReports };
}

export function awayRecapIsEmpty(counts: AwayRecapCounts): boolean {
  return (
    counts.fleetReturns === 0 &&
    counts.raids === 0 &&
    counts.minis === 0 &&
    counts.unreadReports === 0
  );
}

const boundDocs = new WeakSet<object>();

/** Stamp the visit when the page is hidden. A visible page does not move the stamp. */
export function bindAwayRecapHide(
  doc: Document,
  storage: VisitStorage,
  playerId: () => string | null,
  now: () => number = Date.now,
): void {
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState !== "hidden") return;
    const id = playerId();
    if (!id) return;
    writeLastVisit(storage, id, now());
  });
}
