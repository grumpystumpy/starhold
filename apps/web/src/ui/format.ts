import type { Resources } from "@starhold/game";

/** Shared display formatter — universal floored compact number formatting. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.floor(Math.abs(n));
  if (abs < 1000) return `${sign}${abs}`;

  const tiers: Array<[number, string]> = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [base, suffix] of tiers) {
    if (abs >= base) {
      const tenths = Math.floor(abs / (base / 10));
      const whole = Math.floor(tenths / 10);
      const frac = tenths % 10;
      return frac === 0
        ? `${sign}${whole}${suffix}`
        : `${sign}${whole}.${frac}${suffix}`;
    }
  }
  return `${sign}${abs}`;
}

/** Compact point totals — alias to fmt. */
export function fmtCompact(n: number): string {
  return fmt(n);
}

export function fmtCost(cost: Resources): string {
  const parts: string[] = [];
  if (cost.metal) parts.push(`${fmt(cost.metal)} metal`);
  if (cost.crystal) parts.push(`${fmt(cost.crystal)} crystal`);
  if (cost.deuterium) parts.push(`${fmt(cost.deuterium)} deut`);
  return parts.join(" · ") || "free";
}

export function fmtCoords(c: { galaxy: number; system: number; slot: number }): string {
  return `${c.galaxy}:${c.system}:${c.slot}`;
}

export function fmtCoordsLink(c: {
  galaxy: number;
  system: number;
  slot: number;
}): string {
  const text = fmtCoords(c);
  return `<a href="/galaxy?galaxy=${c.galaxy}&amp;system=${c.system}" class="coord-link" data-galaxy-coords="${text}" data-testid="coord-link-${c.galaxy}-${c.system}-${c.slot}">${text}</a>`;
}

export function remainingSeconds(completesAt: number, now: number): number {
  return Math.max(0, Math.ceil((completesAt - now) / 1000));
}

export function fmtEta(seconds: number): string {
  if (seconds < 60) return `${fmt(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${fmt(m)}m ${s.toString().padStart(2, "0")}s`;
}

/** Skill / id labels: underscores → spaces for display. */
export function fmtLabel(raw: string): string {
  return raw.replace(/_/g, " ");
}
