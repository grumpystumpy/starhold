import type { Resources } from "@starhold/game";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

export type InfoTooltipOpts = {
  title: string;
  /** Function / detail lines shown under the title. */
  lines?: string[];
  requires?: string[];
  blocked?: string | null;
  testId?: string;
};

/** General hover/tap tooltip bubble (CSS hover + focus-within + aria-expanded). */
export function infoTooltip(opts: InfoTooltipOpts): {
  title: string;
  html: string;
} {
  const lines: string[] = [opts.title, ...(opts.lines ?? [])];
  if (opts.requires?.length) {
    lines.push(`Requires: ${opts.requires.join("; ")}`);
  }
  if (opts.blocked) {
    lines.push(opts.blocked);
  }
  const title = lines.join(" · ");

  const bodyHtml = (opts.lines ?? [])
    .map((line) => `<div class="tip-line">${escapeHtml(line)}</div>`)
    .join("");
  const reqHtml = opts.requires?.length
    ? `<div class="tip-req">${opts.requires.map((r) => `<div>${escapeHtml(r)}</div>`).join("")}</div>`
    : "";
  const blockedHtml = opts.blocked
    ? `<div class="tip-blocked">${escapeHtml(opts.blocked)}</div>`
    : "";
  const testId = opts.testId ?? "info-tip";

  const html = `
    <span class="has-tip" tabindex="0" role="button" aria-expanded="false" aria-label="More info: ${escapeAttr(opts.title)}" data-tip data-testid="${escapeAttr(testId)}">
      <span class="tip-trigger" aria-hidden="true">?</span>
      <span class="tip-bubble" role="tooltip">
        <strong>${escapeHtml(opts.title)}</strong>
        ${bodyHtml}
        ${reqHtml}
        ${blockedHtml}
      </span>
    </span>`.replace(/\n\s*/g, "");

  return { title: escapeAttr(title), html };
}

/** Structured cost/requirement tooltip (CSS hover + native title fallback). */
export function costTooltip(opts: {
  action: string;
  cost: Resources;
  timeSecs?: number;
  requires?: string[];
  blocked?: string | null;
  /** Function / what this unlocks or does. */
  detail?: string;
}): { title: string; html: string } {
  const lines: string[] = [];
  if (opts.detail) lines.push(opts.detail);
  lines.push(`Cost: ${fmtCost(opts.cost)}`);
  if (opts.timeSecs !== undefined) {
    lines.push(`Time: ${fmtEta(opts.timeSecs)}`);
  }
  return infoTooltip({
    title: opts.action,
    lines,
    requires: opts.requires,
    blocked: opts.blocked,
    testId: "cost-tip",
  });
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

/** Clear end-align so the next open/hover remeasures. */
function clearTipAlign(tipEl: Element): void {
  tipEl.classList.remove("tip-align-end");
}

/**
 * Keep `.tip-bubble` inside the viewport: if left-anchored width would
 * spill past the right edge, flip to `tip-align-end` (right: 0).
 * Safe for hover and tap; uses estimated width when bubble is display:none.
 */
export function positionTip(tipEl: Element): void {
  if (!(tipEl instanceof HTMLElement)) return;
  clearTipAlign(tipEl);
  const bubble = tipEl.querySelector(".tip-bubble");
  const triggerRect = tipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const margin = 8;
  let bubbleWidth = 0;
  if (bubble instanceof HTMLElement) {
    bubbleWidth = bubble.offsetWidth;
  }
  if (bubbleWidth < 8) {
    // Hidden bubbles report 0 — match CSS min-width (desktop 15rem / phone 16.5rem).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const phone = vw <= 640;
    bubbleWidth = Math.min(
      (phone ? 16.5 : 15) * rem,
      vw - 1.25 * rem,
    );
  }
  if (triggerRect.left + bubbleWidth > vw - margin) {
    tipEl.classList.add("tip-align-end");
  }
}

/** Close every open tip, or leave `except` open. */
export function collapseTips(root: ParentNode, except?: Element | null): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-tip][aria-expanded="true"]',
  )) {
    if (except && el === except) continue;
    el.setAttribute("aria-expanded", "false");
    clearTipAlign(el);
  }
}

/** Toggle one tip open/closed; closes siblings. Returns true if handled. */
export function toggleTip(root: ParentNode, tipEl: Element): boolean {
  const open = tipEl.getAttribute("aria-expanded") === "true";
  collapseTips(root, open ? null : tipEl);
  tipEl.setAttribute("aria-expanded", open ? "false" : "true");
  if (!open) {
    // Measure after expanded so layout can use real bubble width when visible.
    requestAnimationFrame(() => positionTip(tipEl));
  } else {
    clearTipAlign(tipEl);
  }
  return true;
}
