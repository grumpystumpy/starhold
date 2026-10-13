import { fmtEta, remainingSeconds } from "./format";

let timer: number | undefined;

/** Tick live ETA labels without a full re-render. */
export function startCountdownTick(): void {
  if (timer !== undefined) return;
  timer = window.setInterval(() => {
    const now = Date.now();
    document.querySelectorAll<HTMLElement>("[data-eta-until]").forEach((el) => {
      const until = Number(el.dataset.etaUntil);
      if (!Number.isFinite(until)) return;
      el.textContent = fmtEta(remainingSeconds(until, now));
    });
  }, 250);
}
