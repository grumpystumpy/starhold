import {
  BUILDINGS,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  type BuildingId,
  type PlayerView,
} from "@starhold/game";
import { BUILDING_ART, PLANET_ART } from "./assets";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { costTooltip } from "./render-tooltips";

/** Keep the commander input mounted so automation / IME is not wiped by re-paints. */
export function renderJoin(
  root: HTMLElement,
  state: {
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
  },
): void {
  const existingForm = root.querySelector<HTMLFormElement>("#join-form");
  const existingInput = root.querySelector<HTMLInputElement>("#commander");

  if (existingForm && existingInput) {
    patchFlash(root, state.error, state.notice);
    const btn = root.querySelector<HTMLButtonElement>("#join-btn");
    if (btn) btn.disabled = state.busy;
    if (
      document.activeElement !== existingInput &&
      state.joinDraft !== existingInput.value
    ) {
      existingInput.value = state.joinDraft;
    }
    return;
  }

  root.innerHTML = `
    <header class="join-hero">
      <img class="thumb thumb-hero" src="${PLANET_ART.rocky}" alt="" width="72" height="72" />
      <div>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Mine the crust, raise the yard, launch hulls — and raid rival outposts. One shared universe — open another tab to meet a rival commander.</p>
      </div>
    </header>
    <div data-flash-slot>${flashHtml(state.error, state.notice)}</div>
    <section class="join-panel">
      <form id="join-form" data-testid="join-form">
        <label for="commander">Commander name</label>
        <div class="join-row" style="margin-top:0.5rem">
          <input id="commander" name="commander" type="text" maxlength="24" placeholder="e.g. Mira Vale" autocomplete="nickname" data-testid="commander-input" value="${escapeAttr(state.joinDraft)}" />
          <button type="submit" id="join-btn" data-testid="join-btn" ${state.busy ? "disabled" : ""}>Enter universe</button>
        </div>
      </form>
      <p class="hint">Prototype economy runs faster than realtime so a short session can reach the shipyard. Rejoin with the same name to resume. Automation: <code>/?commander=Name</code> or <code>window.starhold.join("Name")</code>.</p>
    </section>
  `;

  const input = root.querySelector<HTMLInputElement>("#commander");
  input?.focus();
  if (input && state.joinDraft) {
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

export function patchFlash(
  root: HTMLElement,
  error: string | null,
  notice: string | null,
): void {
  let slot = root.querySelector<HTMLElement>("[data-flash-slot]");
  if (!slot) {
    slot = document.createElement("div");
    slot.dataset.flashSlot = "";
    const panel = root.querySelector(".join-panel, .topbar");
    if (panel?.parentElement) {
      panel.parentElement.insertBefore(slot, panel);
    } else {
      root.prepend(slot);
    }
  }
  slot.innerHTML = flashHtml(error, notice);
}

export function flashHtml(error: string | null, notice: string | null): string {
  if (error) {
    return `<p class="flash flash-error" role="alert" aria-live="assertive" data-testid="flash-error">${escapeHtml(error)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  if (notice) {
    return `<p class="flash flash-ok" role="status" aria-live="polite" data-testid="flash-ok">${escapeHtml(notice)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  return "";
}

export function resBlock(
  cls: string,
  label: string,
  amount: number,
  perHour: number,
  cap: number,
  icon: string,
): string {
  return `
    <div class="res ${cls}" data-testid="res-${cls}">
      <span class="res-head"><img class="icon" src="${icon}" alt="" width="28" height="28" /><span class="label">${label}</span></span>
      <span class="value">${fmt(amount)}</span>
      <span class="sub">+${fmt(perHour)}/h · cap ${fmt(cap)}</span>
    </div>
  `;
}

export function buildingRow(
  id: BuildingId,
  planet: PlayerView["planet"],
  speed: number,
  _now: number,
  _busy: boolean,
): string {
  const def = BUILDINGS[id];
  const level = planet.buildings[id] ?? 0;
  const cost = buildingUpgradeCost(id, level);
  const secs = Math.ceil(buildingUpgradeSeconds(id, level) / speed);
  const queueFull = (planet.buildQueue?.length ?? 0) >= 8;
  const affordable = canAfford(planet.resources, cost);
  // Never disable Upgrade for client busy — disabled buttons swallow clicks
  // (silent no-op). doUpgrade surfaces "Still applying…" instead.
  let label = "Upgrade";
  if (queueFull) label = "Queue full";
  else if (!affordable) label = "Can't afford";
  const blocked = queueFull
    ? "Building queue is full."
    : !affordable
      ? "Not enough resources."
      : null;
  const tip = costTooltip({
    action: `Upgrade ${def.name} → L${level + 1}`,
    cost,
    timeSecs: secs,
    requires: def.energyUsePerLevel
      ? [`Energy use +${def.energyUsePerLevel}/level`]
      : undefined,
    blocked,
  });
  return `
    <article class="item item-thumb" data-building-id="${id}" data-testid="building-${id}">
      <img class="thumb" src="${BUILDING_ART[id]}" alt="" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta" data-testid="building-level-${id}">L${level}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-upgrade="${id}" data-building-id="${id}" data-testid="upgrade-${id}" title="${tip.title}">${label}</button>
      </div>
    </article>
  `;
}
