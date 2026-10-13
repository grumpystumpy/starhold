import { SPY_REPORT_TTL_MS } from "./catalog.js";
import type { UniverseState } from "./types.js";

/** Drop espionage reports older than TTL (wall clock). */
export function pruneSpyReports(
  universe: UniverseState,
  now = Date.now(),
  ttlMs = SPY_REPORT_TTL_MS,
): number {
  let removed = 0;
  for (const [id, report] of Object.entries(universe.spyReports ?? {})) {
    if (now - report.at > ttlMs) {
      delete universe.spyReports[id];
      removed += 1;
    }
  }
  return removed;
}
