import { session } from "../session";
import { fmtAffordableDuration } from "./affordable";
import { fmt, fmtEta, remainingSeconds } from "./format";

let timer: number | undefined;

function paintLocalResources(now: number): void {
  const view = session.view;
  if (!view) return;
  const hours = Math.max(0, now - view.now) / 3_600_000;
  const rates = view.economy.productionPerHour;
  const caps = view.economy.storage;
  const base = view.planet.resources;
  const shown = {
    metal: Math.min(caps.metal, base.metal + rates.metal * hours),
    crystal: Math.min(caps.crystal, base.crystal + rates.crystal * hours),
    deuterium: Math.min(
      caps.deuterium,
      base.deuterium + rates.deuterium * hours,
    ),
  };
  for (const cls of ["metal", "crystal", "deuterium"] as const) {
    const value = document.querySelector(
      `[data-testid="res-${cls}"] .value`,
    );
    if (value) value.textContent = fmt(shown[cls]);
  }
}

/**
 * ETAs and resource stocks advance from the last server snapshot.
 * This timer never calls the network.
 */
export function startCountdownTick(): void {
  if (timer !== undefined) return;
  timer = window.setInterval(() => {
    const now = Date.now();
    document.querySelectorAll<HTMLElement>("[data-eta-until]").forEach((el) => {
      const until = Number(el.dataset.etaUntil);
      if (!Number.isFinite(until)) return;
      el.textContent = fmtEta(remainingSeconds(until, now));
    });
    document.querySelectorAll<HTMLElement>("[data-afford-until]").forEach((el) => {
      const until = Number(el.dataset.affordUntil);
      if (!Number.isFinite(until)) return;
      const remainingMs = until - now;
      el.textContent =
        remainingMs > 0
          ? `Affordable in ${fmtAffordableDuration(remainingMs / 1000)}`
          : "Affordable soon";
    });
    paintLocalResources(now);
  }, 250);
}
