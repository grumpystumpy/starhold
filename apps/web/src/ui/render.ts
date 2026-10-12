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

export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
  },
  handlers: UiHandlers,
): void {
  if (!state.view) {
    root.innerHTML = `
      <header>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Mine the crust, raise the yard, launch hulls. One shared universe — open another tab to meet a rival commander.</p>
      </header>
      ${flashHtml(state.error, state.notice)}
      <section class="join-panel">
        <form id="join-form">
          <label for="commander">Commander name</label>
          <div class="join-row" style="margin-top:0.5rem">
            <input id="commander" name="commander" type="text" maxlength="24" placeholder="e.g. Mira Vale" autocomplete="nickname" value="${escapeAttr(state.joinDraft)}" />
            <button type="submit" id="join-btn" ${state.busy ? "disabled" : ""}>Enter universe</button>
          </div>
        </form>
        <p class="hint">Prototype economy runs faster than realtime so a short session can reach the shipyard. Rejoin with the same name to resume.</p>
      </section>
    `;
    const form = root.querySelector<HTMLFormElement>("#join-form");
    const input = root.querySelector<HTMLInputElement>("#commander");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input?.value ?? state.joinDraft;
      handlers.onJoinDraft(value);
      handlers.onJoin(value);
    });
    input?.addEventListener("input", () => {
      handlers.onJoinDraft(input.value);
    });
    // Keep draft if a re-render wiped mid-IME / automation setAttribute paths.
    if (input && state.joinDraft && input.value !== state.joinDraft) {
      input.value = state.joinDraft;
    }
    bindFlashDismiss(root, handlers);
    input?.focus();
    if (input && state.joinDraft) {
      input.selectionStart = input.selectionEnd = input.value.length;
    }
    return;
  }

  const { view } = state;
  const { planet, economy, player, universe, roster } = view;
  const now = view.now;

  root.innerHTML = `
    <header class="topbar">
      <div>
        <h1 class="brand">Starhold</h1>
        <div class="coords">${escapeHtml(planet.name)} · ${fmtCoords(planet.coords)} · ${escapeHtml(universe.name)} @ ${universe.speed}×</div>
      </div>
      <div>
        <button type="button" class="ghost" id="refresh-btn" ${state.busy ? "disabled" : ""}>Refresh</button>
      </div>
    </header>
    ${flashHtml(state.error, state.notice)}
    <section class="resources" aria-label="Resources">
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
            ? `<div class="queue">Building ${escapeHtml(BUILDINGS[planet.buildQueue.buildingId].name)} → L${planet.buildQueue.targetLevel} · ${fmtEta(remainingSeconds(planet.buildQueue.completesAt, now))} left</div>`
            : `<p class="hint">One construction at a time. Upgrade the Solar Array if mines stall.</p>`
        }
      </section>
      <div>
        <section class="panel">
          <h2>Shipyard</h2>
          ${SHIP_ORDER.map((id) => shipRow(id, planet, state.busy)).join("")}
          ${
            planet.shipQueue
              ? `<div class="queue">Assembling ${planet.shipQueue.count}× ${escapeHtml(SHIPS[planet.shipQueue.shipId].name)} · ${fmtEta(remainingSeconds(planet.shipQueue.completesAt, now))} left</div>`
              : `<p class="hint">Raise the Shipyard to unlock heavier hulls.</p>`
          }
        </section>
        <section class="panel">
          <h2>Hangar</h2>
          <ul class="roster">
            ${SHIP_ORDER.map(
              (id) =>
                `<li><span>${escapeHtml(SHIPS[id].name)}</span><span>${planet.ships[id] ?? 0}</span></li>`,
            ).join("")}
          </ul>
        </section>
        <section class="panel">
          <h2>Universe roster</h2>
          <ul class="roster">
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

  root.querySelector("#refresh-btn")?.addEventListener("click", () => handlers.onRefresh());
  bindFlashDismiss(root, handlers);

  root.querySelectorAll<HTMLButtonElement>("[data-upgrade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onUpgrade(btn.dataset.upgrade as BuildingId);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-ship]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shipId = btn.dataset.ship as ShipId;
      if (btn.dataset.locked === "1") {
        handlers.onBuildShip(shipId, 1);
        return;
      }
      const input = root.querySelector<HTMLInputElement>(`[data-ship-count="${shipId}"]`);
      const count = Number(input?.value ?? 1);
      handlers.onBuildShip(shipId, count);
    });
  });
}

function flashHtml(error: string | null, notice: string | null): string {
  if (error) {
    return `<p class="flash flash-error" role="alert">${escapeHtml(error)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  if (notice) {
    return `<p class="flash flash-ok" role="status">${escapeHtml(notice)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  return "";
}

function bindFlashDismiss(root: HTMLElement, handlers: UiHandlers): void {
  root.querySelector("[data-dismiss-flash]")?.addEventListener("click", () => {
    handlers.onDismissFlash();
  });
}

function resBlock(
  cls: string,
  label: string,
  amount: number,
  perHour: number,
  cap: number,
): string {
  return `
    <div class="res ${cls}">
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
  const blocked = queueBusy || busy;
  let label = "Upgrade";
  if (queueBusy) label = "Queue busy";
  else if (!affordable) label = "Can't afford";
  return `
    <article class="item">
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">L${level}</span></h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-upgrade="${id}" ${blocked ? "disabled" : ""} title="${escapeAttr(
          queueBusy
            ? "A building is already under construction."
            : !affordable
              ? "Not enough resources."
              : `Upgrade to L${level + 1}`,
        )}">${label}</button>
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
  const blocked = (!locked && (queueBusy || busy));
  let label = "Build";
  if (locked) label = "Locked";
  else if (queueBusy) label = "Yard busy";
  else if (!affordable) label = "Can't afford";
  const lockMsg = `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`;
  return `
    <article class="item">
      <div>
        <h3>${escapeHtml(def.name)}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(def.cost)} each · yard L${def.shipyardLevel}+ · cargo ${def.cargo}${
          locked ? ` · ${escapeHtml(lockMsg)}` : ""
        }</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="50" value="1" data-ship-count="${id}" ${locked || queueBusy || busy ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-ship="${id}" data-locked="${locked ? "1" : "0"}" ${blocked ? "disabled" : ""} title="${escapeAttr(
          locked
            ? lockMsg
            : queueBusy
              ? "Shipyard is already busy."
              : !affordable
                ? "Not enough resources."
                : `Build ${def.name}`,
        )}">${label}</button>
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
