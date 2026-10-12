import {
  BUILDING_ORDER,
  BUILDINGS,
  SHIP_ORDER,
  SHIPS,
  buildingUpgradeCost,
  buildingUpgradeSeconds,
  canAfford,
  fuelCostOneWay,
  flightSecondsOneWay,
  type BuildingId,
  type FleetShips,
  type MissionType,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import {
  BUILDING_ART,
  DEFENSE_ART,
  PLANET_ART,
  RESOURCE_ART,
  SHIP_ART,
  UI_ART,
} from "./assets";
import { fmt, fmtCoords, fmtCost, fmtEta, remainingSeconds } from "./format";

export type UiHandlers = {
  onJoinDraft: (name: string) => void;
  onJoin: (name: string) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onBuildShip: (shipId: ShipId, count: number) => void;
  onLaunchFleet: (
    targetPlanetId: string,
    mission: MissionType,
    ships: Partial<FleetShips>,
  ) => void;
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
  const fleets = view.fleets ?? [];
  const reports = view.reports ?? [];
  const now = view.now;
  const hangarEmpty = SHIP_ORDER.every((id) => (planet.ships[id] ?? 0) <= 0);
  const fleetDraft = salvageFleetForm(root);

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-brand">
        <img class="thumb thumb-lg" src="${PLANET_ART.outpost}" alt="" width="56" height="56" />
        <div>
          <h1 class="brand">Starhold</h1>
          <div class="coords" data-testid="planet-coords">${escapeHtml(planet.name)} · ${fmtCoords(planet.coords)} · ${escapeHtml(universe.name)} @ ${universe.speed}×</div>
        </div>
      </div>
      <div>
        <button type="button" class="ghost" id="refresh-btn" data-testid="refresh-btn" ${state.busy ? "disabled" : ""}>Refresh</button>
      </div>
    </header>
    ${flashHtml(state.error, state.notice)}
    <section class="resources" aria-label="Resources" data-testid="resources">
      ${resBlock("metal", "Metal", planet.resources.metal, economy.productionPerHour.metal, economy.storage.metal, RESOURCE_ART.metal)}
      ${resBlock("crystal", "Crystal", planet.resources.crystal, economy.productionPerHour.crystal, economy.storage.crystal, RESOURCE_ART.crystal)}
      ${resBlock("deuterium", "Deuterium", planet.resources.deuterium, economy.productionPerHour.deuterium, economy.storage.deuterium, RESOURCE_ART.deuterium)}
      <div class="res energy">
        <span class="res-head"><img class="icon" src="${RESOURCE_ART.energy}" alt="" width="28" height="28" /><span class="label">Energy</span></span>
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
        <section class="panel" data-testid="hangar-panel">
          <h2>Hangar</h2>
          ${
            hangarEmpty
              ? `<div class="empty-hangar" data-testid="hangar-empty"><img src="${UI_ART.emptyHangar}" alt="Empty hangar" width="128" height="96" /><p class="hint">No hulls docked — build at the Shipyard.</p></div>`
              : `<ul class="roster" data-testid="hangar">
            ${SHIP_ORDER.map(
              (id) =>
                `<li data-testid="hangar-${id}"><span class="row-with-thumb"><img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />${escapeHtml(SHIPS[id].name)}</span><span>${planet.ships[id] ?? 0}</span></li>`,
            ).join("")}
          </ul>`
          }
        </section>
        <section class="panel" data-testid="fleets-panel">
          <h2>Fleets &amp; raids</h2>
          ${fleetComposer(view, state.busy, fleetDraft)}
          ${fleetsInFlight(fleets, roster, now)}
          ${reportsHtml(reports, player.id)}
        </section>
        <section class="panel">
          <h2>Defenses <span class="meta">(preview art)</span></h2>
          <div class="defense-row">
            <article class="item item-thumb">
              <img class="thumb" src="${DEFENSE_ART.laser}" alt="" width="48" height="48" />
              <div>
                <h3>Laser Battery</h3>
                <p>Static guns — buildable defenses land in a later slice.</p>
              </div>
            </article>
            <article class="item item-thumb">
              <img class="thumb" src="${DEFENSE_ART.shield}" alt="" width="48" height="48" />
              <div>
                <h3>Shield Dome</h3>
                <p>Planetary shield concept art for the combat path ahead.</p>
              </div>
            </article>
          </div>
        </section>
        <section class="panel">
          <h2>Universe roster</h2>
          <ul class="roster" data-testid="roster">
            ${roster
              .map(
                (r) =>
                  `<li><span class="row-with-thumb"><img class="thumb" src="${PLANET_ART.rocky}" alt="" width="32" height="32" />${escapeHtml(r.name)}${r.id === player.id ? " (you)" : ""}</span><span>${fmtCoords(r.coords)} · ~${r.pointsHint} pts</span></li>`,
              )
              .join("")}
          </ul>
        </section>
      </div>
    </div>
  `;
}

type FleetDraft = {
  targetPlanetId: string | null;
  mission: MissionType;
  counts: Partial<FleetShips>;
};

function salvageFleetForm(root: HTMLElement): FleetDraft | null {
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const missionEl = form.querySelector<HTMLInputElement>(
    'input[name="fleet-mission"]:checked',
  );
  const counts: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    counts[id] = Math.max(0, Math.floor(Number(input?.value) || 0));
  }
  const mission = (missionEl?.value === "raid" ? "raid" : "deploy") as MissionType;
  return {
    targetPlanetId: target?.value ?? null,
    mission,
    counts,
  };
}

function fleetComposer(
  view: PlayerView,
  busy: boolean,
  draft: FleetDraft | null,
): string {
  const others = view.roster.filter((r) => r.id !== view.player.id);
  if (others.length === 0) {
    return `<p class="hint" data-testid="fleet-need-rival">Join a second commander (another tab) to unlock deploy / raid targets.</p>`;
  }
  const selectedTarget =
    draft?.targetPlanetId &&
    others.some((r) => r.planetId === draft.targetPlanetId)
      ? draft.targetPlanetId
      : others[0].planetId;
  const mission = draft?.mission === "raid" ? "raid" : "deploy";
  const targetOptions = others
    .map(
      (r) =>
        `<option value="${escapeAttr(r.planetId)}" ${r.planetId === selectedTarget ? "selected" : ""}>${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
    )
    .join("");

  const shipInputs = SHIP_ORDER.map((id) => {
    const have = view.planet.ships[id] ?? 0;
    const raw = draft?.counts[id] ?? 0;
    const value = Math.min(have, Math.max(0, raw));
    return `
      <label class="fleet-ship">
        <img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />
        <span>${escapeHtml(SHIPS[id].name)} <span class="meta">(have ${have})</span></span>
        <input type="number" min="0" max="${have}" value="${value}" data-fleet-count="${id}" data-testid="fleet-count-${id}" ${busy ? "disabled" : ""} />
      </label>`;
  }).join("");

  // ETA preview uses first rival + 1 scout default for hint text only.
  const sampleTarget = others[0];
  const sampleShips: FleetShips = { scout: 1, hauler: 0, interceptor: 0 };
  const sampleEta = flightSecondsOneWay(
    view.planet.coords,
    sampleTarget.coords,
    sampleShips,
    view.universe.fleetSpeed ?? view.universe.speed,
  );
  const sampleFuel = fuelCostOneWay(
    view.planet.coords,
    sampleTarget.coords,
    sampleShips,
  );

  return `
    <form id="fleet-form" data-testid="fleet-form" class="fleet-form">
      <label>
        Target
        <select id="fleet-target" data-testid="fleet-target" ${busy ? "disabled" : ""}>
          ${targetOptions}
        </select>
      </label>
      <fieldset class="mission-pick">
        <legend>Mission</legend>
        <label><input type="radio" name="fleet-mission" value="deploy" data-testid="mission-deploy" ${mission === "deploy" ? "checked" : ""} ${busy ? "disabled" : ""} /> Deploy (peaceful round-trip)</label>
        <label><input type="radio" name="fleet-mission" value="raid" data-testid="mission-raid" ${mission === "raid" ? "checked" : ""} ${busy ? "disabled" : ""} /> Raid / attack</label>
      </fieldset>
      <div class="fleet-ships">${shipInputs}</div>
      <p class="hint">Example one-way ETA ~${fmtEta(sampleEta)} · fuel ~${sampleFuel} deut (1 scout → ${escapeHtml(sampleTarget.name)}). Formulas: see packages/game FLEETS.md.</p>
      <button type="submit" data-testid="launch-fleet" ${busy ? "disabled" : ""}>Launch fleet</button>
    </form>
  `;
}

function fleetsInFlight(
  fleets: PlayerView["fleets"],
  roster: PlayerView["roster"],
  now: number,
): string {
  if (!fleets.length) {
    return `<p class="hint">No fleets in flight.</p>`;
  }
  const nameFor = (playerId: string) =>
    roster.find((r) => r.id === playerId)?.name ?? "commander";
  return `
    <ul class="roster fleets-live" data-testid="fleets-live">
      ${fleets
        .map((f) => {
          const ships = SHIP_ORDER.filter((id) => (f.ships[id] ?? 0) > 0)
            .map((id) => `${f.ships[id]}× ${SHIPS[id].name}`)
            .join(", ");
          const eta = fmtEta(remainingSeconds(f.arrivesAt, now));
          const phase =
            f.phase === "outbound"
              ? `→ ${escapeHtml(nameFor(f.targetPlayerId))} (${f.mission})`
              : `← returning home`;
          return `<li data-testid="fleet-${f.id}"><span>${phase}<br/><span class="meta">${escapeHtml(ships)}</span></span><span>${eta}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

function reportsHtml(
  reports: PlayerView["reports"],
  selfId: string,
): string {
  if (!reports.length) {
    return `<p class="hint">No combat reports yet.</p>`;
  }
  return `
    <h3 class="subhead">Combat reports</h3>
    <ul class="reports" data-testid="combat-reports">
      ${reports
        .map((r) => {
          const role = r.attackerPlayerId === selfId ? "Attack" : "Defense";
          const loot =
            r.loot.metal + r.loot.crystal + r.loot.deuterium > 0
              ? ` · loot ${fmt(r.loot.metal)}/${fmt(r.loot.crystal)}/${fmt(r.loot.deuterium)}`
              : "";
          return `<li data-testid="report-${r.id}"><strong>${role}: ${escapeHtml(r.outcome)}</strong> vs ${escapeHtml(r.attackerPlayerId === selfId ? r.defenderName : r.attackerName)} @ ${fmtCoords(r.targetCoords)}${loot}<br/><span class="meta">${escapeHtml(r.summary)}</span></li>`;
        })
        .join("")}
    </ul>
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
    <article class="item item-thumb" data-testid="building-${id}">
      <img class="thumb" src="${BUILDING_ART[id]}" alt="" width="48" height="48" />
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
    <article class="item item-thumb" data-testid="ship-${id}">
      <img class="thumb" src="${SHIP_ART[id]}" alt="" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(def.cost)} each · yard L${def.shipyardLevel}+ · cargo ${def.cargo} · atk ${def.attack}${
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
