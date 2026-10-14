import {
  PRODUCTION_MULT,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCoords } from "./format";
import { patchFlash } from "./render-chrome-join.js";
import { escapeHtml } from "./render-escape";
import { storageFillTitle } from "./render-tooltips";

/**
 * Update top bar + resource bar in place (no remount) so 1s polls
 * do not flicker or jump layout.
 */
export function patchLiveChrome(
  root: HTMLElement,
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
): boolean {
  const shell = root.querySelector<HTMLElement>('[data-testid="game-shell"]');
  if (!shell) return false;

  const { planet, economy, universe } = view;
  const progress = view.progress ?? {
    level: view.player.level ?? 1,
    xp: view.player.xp ?? 0,
    xpToNext: 100,
    xpTotal: view.player.xpTotal ?? 0,
  };
  const xpPct = Math.min(
    100,
    Math.floor((progress.xp / Math.max(1, progress.xpToNext)) * 100),
  );

  const coords = root.querySelector<HTMLElement>('[data-testid="planet-coords"]');
  if (coords) {
    const income =
      Number(PRODUCTION_MULT) > 1
        ? ` · income ×${PRODUCTION_MULT} (test)`
        : "";
    coords.textContent = `${planet.name}${planet.kind === "moon" ? " · Moon" : ""} · ${fmtCoords(planet.coords)} · ${universe.name} @ ${universe.speed}×${income}`;
  }

  const levelLabel = root.querySelector<HTMLElement>(
    '[data-testid="player-level"] .level-label',
  );
  if (levelLabel) levelLabel.textContent = `Lv ${fmt(progress.level)}`;

  const levelWrap = root.querySelector<HTMLElement>('[data-testid="player-level"]');
  if (levelWrap) {
    levelWrap.title = `Lifetime XP ${fmt(progress.xpTotal)}`;
  }

  const xpBar = root.querySelector<HTMLElement>('[data-testid="xp-bar"]');
  if (xpBar) {
    xpBar.setAttribute("aria-valuemax", String(progress.xpToNext));
    xpBar.setAttribute("aria-valuenow", String(progress.xp));
  }
  const xpFill = root.querySelector<HTMLElement>(".xp-fill");
  if (xpFill) xpFill.style.width = `${xpPct}%`;
  const xpText = root.querySelector<HTMLElement>(".xp-text");
  if (xpText) {
    xpText.textContent = `${fmt(progress.xp)} / ${fmt(progress.xpToNext)}`;
  }

  patchRes(
    root,
    "metal",
    planet.resources.metal,
    economy.productionPerHour.metal,
    economy.storage.metal,
  );
  patchRes(
    root,
    "crystal",
    planet.resources.crystal,
    economy.productionPerHour.crystal,
    economy.storage.crystal,
  );
  patchRes(
    root,
    "deuterium",
    planet.resources.deuterium,
    economy.productionPerHour.deuterium,
    economy.storage.deuterium,
  );

  const energy = root.querySelector<HTMLElement>('[data-testid="res-energy"]');
  if (energy) {
    energy.classList.toggle("deficit", economy.energy.factor < 1);
    energy.title = `Energy factor ${(economy.energy.factor * 100).toFixed(0)}% · produced ${fmt(economy.energy.produced)} · used ${fmt(economy.energy.used)}`;
    const value = energy.querySelector(".value");
    if (value) {
      value.textContent = `${fmt(economy.energy.produced)} / ${fmt(economy.energy.used)}`;
    }
    const sub = energy.querySelector(".sub");
    if (sub) {
      sub.textContent = `Factor ${(economy.energy.factor * 100).toFixed(0)}%`;
    }
  }

  const shards = view.starshards ?? 0;
  const shardValue = root.querySelector<HTMLElement>(
    '[data-testid="starshards-balance"]',
  );
  if (shardValue) shardValue.textContent = fmt(shards);
  const claim = root.querySelector<HTMLButtonElement>('[data-testid="claim-daily"]');
  if (claim) {
    const canClaim = Boolean(view.dailyLoginAvailable) && !state.busy;
    claim.disabled = !canClaim;
    claim.textContent = view.dailyLoginAvailable
      ? "Claim daily +15"
      : "Daily claimed";
  }

  const refresh = root.querySelector<HTMLButtonElement>('[data-testid="refresh-btn"]');
  if (refresh) refresh.disabled = state.busy;

  shell.dataset.planetId = planet.id;
  shell.dataset.page = shell.dataset.page ?? "";
  shell.dataset.busy = state.busy ? "1" : "0";

  patchFlash(root, state.error, state.notice);

  // Keep empire rail labels in sync without remounting chips.
  for (const p of view.ownedPlanets) {
    const chip = root.querySelector<HTMLElement>(
      `[data-select-planet="${p.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
    );
    if (!chip) continue;
    const nameEl = chip.querySelector(".planet-chip-name");
    if (nameEl) {
      nameEl.innerHTML = `${escapeHtml(p.name)}${p.isMoon ? " · Moon" : ""}${p.isHome ? " ★" : ""}`;
    }
    chip.classList.toggle("active", p.isActive);
    chip.toggleAttribute("disabled", state.busy);
  }

  return true;
}

function patchRes(
  root: HTMLElement,
  cls: string,
  amount: number,
  perHour: number,
  cap: number,
): void {
  const el = root.querySelector<HTMLElement>(`[data-testid="res-${cls}"]`);
  if (!el) return;
  el.title = storageFillTitle(amount, cap, perHour);
  const value = el.querySelector(".value");
  if (value) value.textContent = fmt(amount);
  const sub = el.querySelector(".sub");
  if (sub) sub.textContent = `+${fmt(perHour)}/h · cap ${fmt(cap)}`;
}

/** Whether the live shell can be patched instead of fully remounted. */
export function canPatchShell(
  root: HTMLElement,
  view: PlayerView,
  activePage: string,
): boolean {
  const shell = root.querySelector<HTMLElement>('[data-testid="game-shell"]');
  if (!shell) return false;
  if (shell.dataset.page !== activePage) return false;
  if (shell.dataset.planetId !== view.planet.id) return false;
  return true;
}
