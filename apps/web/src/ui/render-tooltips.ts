import type { Resources } from "@starhold/game";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

/** Structured cost/requirement tooltip (CSS hover + native title fallback). */
export function costTooltip(opts: {
  action: string;
  cost: Resources;
  timeSecs?: number;
  requires?: string[];
  blocked?: string | null;
}): { title: string; html: string } {
  const lines: string[] = [opts.action, `Cost: ${fmtCost(opts.cost)}`];
  if (opts.timeSecs !== undefined) {
    lines.push(`Time: ${fmtEta(opts.timeSecs)}`);
  }
  if (opts.requires?.length) {
    lines.push(`Requires: ${opts.requires.join("; ")}`);
  }
  if (opts.blocked) {
    lines.push(opts.blocked);
  }
  const title = lines.join(" · ");

  const reqHtml = opts.requires?.length
    ? `<div class="tip-req">${opts.requires.map((r) => `<div>${escapeHtml(r)}</div>`).join("")}</div>`
    : "";
  const blockedHtml = opts.blocked
    ? `<div class="tip-blocked">${escapeHtml(opts.blocked)}</div>`
    : "";
  const timeHtml =
    opts.timeSecs !== undefined
      ? `<div class="tip-time">${escapeHtml(fmtEta(opts.timeSecs))}</div>`
      : "";

  const html = `
    <span class="has-tip" tabindex="0" data-testid="cost-tip">
      <span class="tip-trigger" aria-hidden="true">?</span>
      <span class="tip-bubble" role="tooltip">
        <strong>${escapeHtml(opts.action)}</strong>
        <div class="tip-cost">${escapeHtml(fmtCost(opts.cost))}</div>
        ${timeHtml}
        ${reqHtml}
        ${blockedHtml}
      </span>
    </span>`.replace(/\n\s*/g, "");

  return { title: escapeAttr(title), html };
}

export function storageFillTitle(
  amount: number,
  cap: number,
  perHour: number,
): string {
  const pct = cap > 0 ? Math.min(100, Math.floor((amount / cap) * 100)) : 0;
  return escapeAttr(
    `${fmt(amount)} / ${fmt(cap)} (${pct}%) · +${fmt(perHour)}/h`,
  );
}
