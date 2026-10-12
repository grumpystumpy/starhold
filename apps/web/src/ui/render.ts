import {
  BUILDING_ORDER,
  BUILDINGS,
  SHIP_ORDER,
  SHIPS,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  type BuildingId,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import { fmt, fmtCoords, fmtCost, fmtEta, remainingSeconds } from "./format";

export type UiHandlers = {
  onJoinDraft: (name: string) => void;
  onJoin: (name: string) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onBuildShip: (shipId: ShipId, count: number) => void;
  onRefresh: () => void;
  onDismissFlash: () => void;
};

/**
 * Render UI. Interactive actions are handled by event delegation in main.ts
 * so 1s poll re-renders do not drop click listeners mid-gesture.
 */
export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    renderJoin(root, state);
    return;
  }

  const { view } = state;
  const { planet, economy, player, universe, roster } = view;
  const now = view.now;

  root.innerHTML = `
    <header class="topbar">
      <div>
        <h1 class="brand">Starhold</h1>
        <div class="coords" data-testid="planet-coords">${escapeHtml(planet.name)} · ${fmtCoords(planet.coords)} · ${escapeHtml(universe.name)} @ ${universe.speed}×</div>
      </div>
      <div>
        <button type="button" class="ghost" id="refresh-btn" data-testid="refresh-btn" ${state.busy ? "disabled" : ""}>Refresh</button>
      </div>
    </header>
    ${flashHtml(state.error, state.notice)}
    <section class="resources" aria-label="Resources" data-testid="resources">
      ${resBlock("metal", "Metal", planet.resources.metal, economy.productionPerHour.metal, economy.storage.metal)}
      ${resBlock("crystal", "Crystal", planet.resources.crystal, economy.productionPerHour.crystal, economy.storage.crystal)}
      ${resBlock("deuterium", "Deuterium", planet.resources.deuterium, economy.productionPerHour.deuterium, economy.storage.deuterium)}
      <div class="res energy">
        <span class="label">Energy</span>
        <span class="value">${fmt(economy.energy.produced)} / ${fmt(economy.energy.used)}</span>
        <span class="sub">Factor ${(economy.energy.factor * 100).toFixed(0)}%</span>
      </div>
    </section>
    <div class="layout">
      <section class="panel">
        <h2>Buildings</h2>
        ${BUILDING_ORDER.map((id) => buildingRow(id, planet, universe.speed, now, state.busy)).join("")}
        ${
          planet.buildQueue
            ? `<div class="queue" data-testid="build-queue">Building ${escapeHtml(BUILDINGS[planet.buildQueue.buildingId].name)} → L${planet.buildQueue.targetLevel} · ${fmtEta(remainingSeconds(planet.buildQueue.completesAt, now))} left</div>`
            : `<p class="hint">One construction at a time. Upgrade the Solar Array if mines stall.</p>`
        }
      </section>
      <div>
        <section class="panel">
          <h2>Shipyard</h2>
          ${SHIP_ORDER.map((id) => shipRow(id, planet, state.busy)).join("")}
          ${
            planet.shipQueue
              ? `<div class="queue" data-testid="ship-queue">Assembling ${planet.shipQueue.count}× ${escapeHtml(SHIPS[planet.shipQueue.shipId].name)} · ${fmtEta(remainingSeconds(planet.shipQueue.completesAt, now))} left</div>`
              : `<p class="hint">Raise the Shipyard to unlock heavier hulls.</p>`
          }
        </section>
        <section class="panel">
          <h2>Hangar</h2>
          <ul class="roster" data-testid="hangar">
            ${SHIP_ORDER.map(
              (id) =>
                `<li data-testid="hangar-${id}"><span>${escapeHtml(SHIPS[id].name)}</span><span>${planet.ships[id] ?? 0}</span></li>`,
            ).join("")}
          </ul>
        </section>
        <section class="panel">
          <h2>Universe roster</h2>
          <ul class="roster" data-testid="roster">
            ${roster
              .map(
                (r) =>
                  `<li><span>${escapeHtml(r.name)}${r.id === player.id ? " (you)" : ""}</span><span>${fmtCoords(r.coords)} · ~${r.pointsHint} pts</span></li>`,
              )
              .join("")}
          </ul>
        </section>
      </div>
    </div>
  `;
}

/** Keep the commander input mounted so automation / IME is not wiped by re-paints. */
function renderJoin(
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
    // Only push draft into the field when it is not focused (URL / helper join).
    if (
      document.activeElement !== existingInput &&
      state.joinDraft !== existingInput.value
    ) {
      existingInput.value = state.joinDraft;
    }
    return;
  }

  root.innerHTML = `
    <header>
      <h1 class="brand">Starhold</h1>
      <p class="tagline">Mine the crust, raise the yard, launch hulls. One shared universe — open another tab to meet a rival commander.</p>
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
  // Focus once on first mount only — not on every paint (fights automation).
  input?.focus();
  if (input && state.joinDraft) {
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function patchFlash(
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

function flashHtml(error: string | null, notice: string | null): string {
  if (error) {
    return `<p class="flash flash-error" role="alert" aria-live="assertive" data-testid="flash-error">${escapeHtml(error)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  if (notice) {
    return `<p class="flash flash-ok" role="status" aria-live="polite" data-testid="flash-ok">${escapeHtml(notice)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  return "";
}

function resBlock(
  cls: string,
  label: string,
  amount: number,
  perHour: number,
  cap: number,
): string {
  return `
    <div class="res ${cls}" data-testid="res-${cls}">
      <span class="label">${label}</span>
      <span class="value">${fmt(amount)}</span>
      <span class="sub">+${fmt(perHour)}/h · cap ${fmt(cap)}</span>
    </div>
  `;
}

function buildingRow(
  id: BuildingId,
  planet: PlayerView["planet"],
  speed: number,
  _now: number,
  busy: boolean,
): string {
  const def = BUILDINGS[id];
  const level = planet.buildings[id] ?? 0;
  const cost = buildingUpgradeCost(id, level);
  const secs = Math.ceil(buildingUpgradeSeconds(id, level) / speed);
  const queueBusy = Boolean(planet.buildQueue);
  const affordable = canAfford(planet.resources, cost);
  // Only block the in-flight request — queue/afford rejects stay clickable so
  // the API error string appears in the persistent flash banner.
  const blocked = busy;
  let label = "Upgrade";
  if (queueBusy) label = "Queue busy";
  else if (!affordable) label = "Can't afford";
  const title = queueBusy
    ? "A building is already under construction."
    : !affordable
      ? "Not enough resources."
      : `Upgrade to L${level + 1}`;
  return `
    <article class="item" data-testid="building-${id}">
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">L${level}</span></h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-upgrade="${id}" data-testid="upgrade-${id}" ${blocked ? "disabled" : ""} title="${escapeAttr(title)}">${label}</button>
      </div>
    </article>
  `;
}

function shipRow(
  id: ShipId,
  planet: PlayerView["planet"],
  busy: boolean,
): string {
  const def = SHIPS[id];
  const yard = planet.buildings.shipyard ?? 0;
  const locked = yard < def.shipyardLevel;
  const affordable = canAfford(planet.resources, def.cost);
  const queueBusy = Boolean(planet.shipQueue);
  const blocked = busy;
  let label = "Build";
  if (locked) label = "Locked";
  else if (queueBusy) label = "Yard busy";
  else if (!affordable) label = "Can't afford";
  const lockMsg = `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`;
  const title = locked
    ? lockMsg
    : queueBusy
      ? "Shipyard is already busy."
      : !affordable
        ? "Not enough resources."
        : `Build ${def.name}`;
  return `
    <article class="item" data-testid="ship-${id}">
      <div>
        <h3>${escapeHtml(def.name)}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(def.cost)} each · yard L${def.shipyardLevel}+ · cargo ${def.cargo}${
          locked ? ` · ${escapeHtml(lockMsg)}` : ""
        }</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="50" value="1" data-ship-count="${id}" data-testid="ship-count-${id}" ${busy ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-ship="${id}" data-locked="${locked ? "1" : "0"}" data-testid="build-${id}" ${blocked ? "disabled" : ""} title="${escapeAttr(title)}">${label}</button>
      </div>
    </article>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
