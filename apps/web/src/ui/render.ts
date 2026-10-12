import {
  BUILDING_ORDER,
  BUILDINGS,
  SHIP_ORDER,
  SHIPS,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  type BuildingId,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import { fmt, fmtCoords, fmtCost, fmtEta, remainingSeconds } from "./format";

export type UiHandlers = {
  onJoin: (name: string) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onBuildShip: (shipId: ShipId, count: number) => void;
  onRefresh: () => void;
};

export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    busy: boolean;
  },
  handlers: UiHandlers,
): void {
  if (!state.view) {
    root.innerHTML = `
      <header>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Mine the crust, raise the yard, launch hulls. One shared universe — open another tab to meet a rival commander.</p>
      </header>
      ${state.error ? `<p class="flash" role="alert">${escapeHtml(state.error)}</p>` : ""}
      <section class="join-panel">
        <label for="commander">Commander name</label>
        <div class="join-row" style="margin-top:0.5rem">
          <input id="commander" type="text" maxlength="24" placeholder="e.g. Mira Vale" autocomplete="nickname" />
          <button type="button" id="join-btn" ${state.busy ? "disabled" : ""}>Enter universe</button>
        </div>
        <p class="hint">Prototype economy runs at 2× speed. Rejoin with the same name to resume.</p>
      </section>
    `;
    const input = root.querySelector<HTMLInputElement>("#commander");
    const btn = root.querySelector<HTMLButtonElement>("#join-btn");
    const submit = () => {
      if (!input) return;
      handlers.onJoin(input.value);
    };
    btn?.addEventListener("click", submit);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    input?.focus();
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
    ${state.error ? `<p class="flash" role="alert">${escapeHtml(state.error)}</p>` : ""}
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

  root.querySelectorAll<HTMLButtonElement>("[data-upgrade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onUpgrade(btn.dataset.upgrade as BuildingId);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-ship]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shipId = btn.dataset.ship as ShipId;
      const input = root.querySelector<HTMLInputElement>(`[data-ship-count="${shipId}"]`);
      const count = Number(input?.value ?? 1);
      handlers.onBuildShip(shipId, count);
    });
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
  const blocked = Boolean(planet.buildQueue) || busy;
  return `
    <article class="item">
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">L${level}</span></h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-upgrade="${id}" ${blocked ? "disabled" : ""}>Upgrade</button>
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
  const blocked = locked || Boolean(planet.shipQueue) || busy;
  return `
    <article class="item">
      <div>
        <h3>${escapeHtml(def.name)}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(def.cost)} each · yard L${def.shipyardLevel}+ · cargo ${def.cargo}</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="50" value="1" data-ship-count="${id}" ${blocked ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-ship="${id}" ${blocked ? "disabled" : ""}>${locked ? "Locked" : "Build"}</button>
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
