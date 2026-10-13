import type { Resources } from "@starhold/game";

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return Math.floor(n).toLocaleString();
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
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
