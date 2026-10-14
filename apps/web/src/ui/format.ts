import type { Resources } from "@starhold/game";

/** Shared display formatter — always thousands separators (2,000 not 2000). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.floor(n).toLocaleString("en-US");
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
