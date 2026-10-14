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

/** Clear placement classes + inline coords so the next open/hover remeasures. */
function clearTipAlign(tipEl: Element): void {
  tipEl.classList.remove("tip-align-end", "tip-fixed");
  const bubble = tipEl.querySelector(".tip-bubble");
  if (bubble instanceof HTMLElement) {
    bubble.style.left = "";
    bubble.style.right = "";
    bubble.style.top = "";
    bubble.style.maxWidth = "";
    bubble.style.position = "";
  }
}

function estimatedBubbleWidth(vw: number): number {
  const rem =
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const phone = vw <= 640;
  return Math.min((phone ? 16.5 : 15) * rem, vw - 1.25 * rem);
}

/**
 * Keep `.tip-bubble` fully inside the viewport.
 * Prefers left-align to the trigger; if that overflows right, right-align;
 * then clamps with `position: fixed` so neither edge spills.
 */
export function positionTip(tipEl: Element): void {
  if (!(tipEl instanceof HTMLElement)) return;
  clearTipAlign(tipEl);
  const bubble = tipEl.querySelector(".tip-bubble");
  if (!(bubble instanceof HTMLElement)) return;

  const place = (): void => {
    const triggerRect = tipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const margin = 8;
    let bubbleWidth = bubble.offsetWidth;
    if (bubbleWidth < 8) bubbleWidth = estimatedBubbleWidth(vw);
    bubbleWidth = Math.min(bubbleWidth, vw - margin * 2);

    let left = triggerRect.left;
    if (left + bubbleWidth > vw - margin) {
      left = triggerRect.right - bubbleWidth;
      tipEl.classList.add("tip-align-end");
    }
    if (left < margin) left = margin;
    if (left + bubbleWidth > vw - margin) {
      left = Math.max(margin, vw - margin - bubbleWidth);
    }

    tipEl.classList.add("tip-fixed");
    bubble.style.position = "fixed";
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.right = "auto";
    bubble.style.top = `${Math.round(triggerRect.bottom + 6)}px`;
    bubble.style.maxWidth = `${Math.round(vw - margin * 2)}px`;
  };

  // Two frames: first may be display:none until :hover / aria-expanded paints.
  requestAnimationFrame(() => {
    place();
    requestAnimationFrame(place);
  });
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
  // Also clear align on non-expanded tips that were hover-positioned.
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-tip].tip-fixed, [data-tip].tip-align-end",
  )) {
    if (except && el === except) continue;
    if (el.getAttribute("aria-expanded") === "true") continue;
    clearTipAlign(el);
  }
}

/** Toggle one tip open/closed; closes siblings. Returns true if handled. */
export function toggleTip(root: ParentNode, tipEl: Element): boolean {
  const open = tipEl.getAttribute("aria-expanded") === "true";
  collapseTips(root, open ? null : tipEl);
  tipEl.setAttribute("aria-expanded", open ? "false" : "true");
  if (!open) {
    positionTip(tipEl);
  } else {
    clearTipAlign(tipEl);
  }
  return true;
}
