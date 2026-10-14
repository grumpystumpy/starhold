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
    emailDraft?: string;
    accountEmail?: string | null;
    claimablePlayerId?: string | null;
    devMagicUrl?: string | null;
  },
): void {
  const existingForm = root.querySelector<HTMLFormElement>("#join-form");
  const existingInput = root.querySelector<HTMLInputElement>("#commander");
  const emailInput = root.querySelector<HTMLInputElement>("#auth-email");
  const hasMagicForm = Boolean(root.querySelector("#magic-form"));
  const hasAccountLine = Boolean(
    root.querySelector("[data-testid='account-email']"),
  );
  const hasClaimBtn = Boolean(root.querySelector("#claim-btn"));
  const wantClaim = Boolean(state.accountEmail && state.claimablePlayerId);
  const structureOk =
    existingForm &&
    existingInput &&
    hasMagicForm &&
    Boolean(state.accountEmail) === hasAccountLine &&
    wantClaim === hasClaimBtn;

  if (structureOk) {
    patchFlash(root, state.error, state.notice);
    const btn = root.querySelector<HTMLButtonElement>("#join-btn");
    if (btn) btn.disabled = state.busy;
    const magicBtn = root.querySelector<HTMLButtonElement>("#magic-btn");
    if (magicBtn) magicBtn.disabled = state.busy;
    const claimBtn = root.querySelector<HTMLButtonElement>("#claim-btn");
    if (claimBtn) claimBtn.disabled = state.busy;
    if (
      document.activeElement !== existingInput &&
      state.joinDraft !== existingInput.value
    ) {
      existingInput.value = state.joinDraft;
    }
    if (
      emailInput &&
      document.activeElement !== emailInput &&
      (state.emailDraft ?? "") !== emailInput.value
    ) {
      emailInput.value = state.emailDraft ?? "";
    }
    const devSlot = root.querySelector<HTMLElement>("[data-dev-magic]");
    if (devSlot) {
      devSlot.innerHTML = state.devMagicUrl
        ? `<p class="hint" data-testid="dev-magic-url">Dev magic link: <a href="${escapeAttr(state.devMagicUrl)}">${escapeHtml(state.devMagicUrl)}</a></p>`
        : "";
    }
    return;
  }

  const accountLine = state.accountEmail
    ? `<p class="hint" data-testid="account-email">Signed in as <strong>${escapeHtml(state.accountEmail)}</strong> — pick a commander name to enter, or claim a guest save below.</p>`
    : "";
  const claimBlock =
    state.accountEmail && state.claimablePlayerId
      ? `<div class="join-row" style="margin-top:0.75rem">
          <button type="button" id="claim-btn" data-testid="claim-btn" data-claim-anonymous ${state.busy ? "disabled" : ""}>Claim guest save</button>
        </div>
        <p class="hint">Links local guest <code>${escapeHtml(state.claimablePlayerId)}</code> to this email. Closing the tab will keep progress via your sign-in cookie.</p>`
      : "";
  const joinLabel = state.accountEmail
    ? "Commander name (linked to your email)"
    : "Commander name (guest)";
  const joinBtn = state.accountEmail ? "Enter as signed-in" : "Enter universe";

  root.innerHTML = `
    <header class="join-hero">
      <img class="thumb thumb-hero" src="${PLANET_ART.rocky}" alt="" width="72" height="72" />
      <div>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Mine the crust, raise the yard, launch hulls — and raid rival colonies. One shared universe — open another tab for attacking another rival.</p>
      </div>
    </header>
    <div data-flash-slot>${flashHtml(state.error, state.notice)}</div>
    <section class="join-panel">
      ${accountLine}
      <form id="join-form" data-testid="join-form">
        <label for="commander">${joinLabel}</label>
        <div class="join-row" style="margin-top:0.5rem">
          <input id="commander" name="commander" type="text" maxlength="24" placeholder="e.g. Mira Vale" autocomplete="nickname" data-testid="commander-input" value="${escapeAttr(state.joinDraft)}" />
          <button type="submit" id="join-btn" data-testid="join-btn" ${state.busy ? "disabled" : ""}>${joinBtn}</button>
        </div>
      </form>
      ${claimBlock}
      <hr style="margin:1.25rem 0;border:none;border-top:1px solid rgba(255,255,255,0.12)" />
      <form id="magic-form" data-testid="magic-form">
        <label for="auth-email">Email magic link</label>
        <div class="join-row" style="margin-top:0.5rem">
          <input id="auth-email" name="email" type="email" maxlength="254" placeholder="you@example.com" autocomplete="email" data-testid="auth-email" value="${escapeAttr(state.emailDraft ?? "")}" />
          <button type="submit" id="magic-btn" data-testid="magic-btn" ${state.busy ? "disabled" : ""}>Email link</button>
        </div>
      </form>
      <div data-dev-magic>${
        state.devMagicUrl
          ? `<p class="hint" data-testid="dev-magic-url">Dev magic link: <a href="${escapeAttr(state.devMagicUrl)}">${escapeHtml(state.devMagicUrl)}</a></p>`
          : ""
      }</div>
      <p class="hint">Guest play still works for quick tests. Sign in with email to keep progress after closing the tab (secure cookie). Automation: <code>/?commander=Name</code> or <code>window.starhold.join("Name")</code>.</p>
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
