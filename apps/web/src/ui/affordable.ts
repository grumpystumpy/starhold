import type { Resources } from "@starhold/game";

export type AffordabilityResult =
  | { affordable: true }
  | {
      affordable: false;
      label: string;
      reason: string;
      secondsRemaining: number | null;
    };

/**
 * Format duration into "Xh Ym", e.g. "2h 14m", "45m", "1d 2h", "12s".
 */
export function fmtAffordableDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.ceil(totalSeconds));
  if (secs < 60) {
    return `${secs}s`;
  }
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Compute client-side affordability status and countdown for an action.
 * Slowest resource wins.
 * If cost exceeds storage, returns reason "needs more storage".
 * If required missing resource has <= 0 production rate, returns reason "no production".
 */
export function computeAffordability(
  cost: Resources,
  current: Resources,
  rates: Resources,
  storage: Resources,
): AffordabilityResult {
  const kinds: Array<keyof Resources> = ["metal", "crystal", "deuterium"];
  let maxSeconds = 0;
  let hasMissing = false;
  let exceedsStorage = false;
  let hasNoProd = false;

  for (const kind of kinds) {
    const required = cost[kind] ?? 0;
    if (required <= 0) continue;

    const have = current[kind] ?? 0;
    const cap = storage[kind] ?? Infinity;
    if (required > cap) {
      exceedsStorage = true;
    }

    const missing = required - have;
    if (missing > 0) {
      hasMissing = true;
      const rate = rates[kind] ?? 0;
      if (rate <= 0) {
        hasNoProd = true;
      } else {
        const secs = (missing / rate) * 3600;
        if (secs > maxSeconds) {
          maxSeconds = secs;
        }
      }
    }
  }

  if (!hasMissing) {
    return { affordable: true };
  }

  if (exceedsStorage) {
    return {
      affordable: false,
      label: "Can't afford",
      reason: "needs more storage",
      secondsRemaining: null,
    };
  }

  if (hasNoProd) {
    return {
      affordable: false,
      label: "Can't afford",
      reason: "no production",
      secondsRemaining: null,
    };
  }

  const durationStr = fmtAffordableDuration(maxSeconds);
  return {
    affordable: false,
    label: `Affordable in ${durationStr}`,
    reason: `Affordable in ${durationStr}`,
    secondsRemaining: Math.ceil(maxSeconds),
  };
}

/** Rates and caps from `view.economy`. `now` is the snapshot time for ship and defense rows. */
export type AffordEcon = {
  productionPerHour?: Resources;
  storage?: Resources;
  now?: number;
};

/**
 * Swap a "Can't afford" label for a countdown, or append "no production" /
 * "needs more storage". Any other label is returned unchanged.
 */
export function applyAffordLabel(opts: {
  label: string;
  reason: string | null;
  cost: Resources;
  current: Resources;
  econ?: AffordEcon | null;
  now: number;
}): { label: string; reason: string | null } {
  const rates = opts.econ?.productionPerHour;
  const storage = opts.econ?.storage;
  if (opts.label !== "Can't afford" || !opts.reason || !rates || !storage) {
    return { label: opts.label, reason: opts.reason };
  }
  const afford = computeAffordability(opts.cost, opts.current, rates, storage);
  if (afford.affordable) {
    return { label: opts.label, reason: opts.reason };
  }
  if (afford.secondsRemaining == null) {
    return { label: opts.label, reason: `${opts.reason} · ${afford.reason}` };
  }
  const until = opts.now + afford.secondsRemaining * 1000;
  return {
    label: `<span data-afford-until="${until}">${afford.label}</span>`,
    reason: opts.reason,
  };
}
