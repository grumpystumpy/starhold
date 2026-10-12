import {
  SHIP_ORDER,
  SHIPS,
  fuelCostOneWay,
  flightSecondsOneWay,
  type FleetShips,
  type MissionType,
  type PlayerView,
} from "@starhold/game";
import { SHIP_ART } from "./assets";
import { fmt, fmtCoords, fmtEta, remainingSeconds } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

export type FleetDraft = {
  targetPlanetId: string | null;
  mission: MissionType;
  counts: Partial<FleetShips>;
};

export function salvageFleetForm(root: HTMLElement): FleetDraft | null {
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

export function fleetComposer(
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

export function fleetsInFlight(
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

export function reportsHtml(
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


