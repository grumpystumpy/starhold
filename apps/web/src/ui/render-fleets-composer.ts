import {
  MAP_SYSTEMS,
  SHIP_ORDER,
  SHIPS,
  fuelCostOneWay,
  flightSecondsOneWay,
  type Coordinates,
  type FleetShips,
  type MissionType,
  type PlayerView,
  type Resources,
} from "@starhold/game";
import { SHIP_ART } from "./assets";
import { fmt, fmtCoords, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { MISSIONS, type FleetDraft } from "./render-fleets-draft.js";

export function fleetComposer(
  view: PlayerView,
  busy: boolean,
  draft: FleetDraft | null,
): string {
  const mission = draft?.mission ?? "deploy";
  const rivals = view.roster.filter((r) => r.id !== view.player.id);
  const ownOther = view.ownedPlanets.filter((p) => p.id !== view.planet.id);
  const emptySlots = view.galaxy.slots.filter((s) => !s.planetId);
  const debrisSlots = view.galaxy.slots.filter((s) => s.debris);

  const options: string[] = [];
  if (mission === "transport") {
    for (const p of ownOther) {
      options.push(
        `<option value="planet:${escapeAttr(p.id)}">${escapeHtml(p.name)} · ${fmtCoords(p.coords)}</option>`,
      );
    }
  } else if (mission === "deploy") {
    for (const p of ownOther) {
      options.push(
        `<option value="planet:${escapeAttr(p.id)}">Park @ ${escapeHtml(p.name)} · ${fmtCoords(p.coords)}</option>`,
      );
    }
    for (const r of rivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}">Visit ${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
  } else if (mission === "colonize") {
    for (const s of emptySlots) {
      options.push(
        `<option value="coords:${s.coords.galaxy}:${s.coords.system}:${s.coords.slot}">Empty ${fmtCoords(s.coords)}</option>`,
      );
    }
  } else if (mission === "harvest") {
    for (const s of debrisSlots) {
      options.push(
        `<option value="coords:${s.coords.galaxy}:${s.coords.system}:${s.coords.slot}">Debris ${fmtCoords(s.coords)} (${fmt(s.debris!.metal)}/${fmt(s.debris!.crystal)})</option>`,
      );
    }
  } else {
    for (const r of rivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}">${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
  }

  let selected =
    draft?.targetPlanetId != null
      ? `planet:${draft.targetPlanetId}`
      : draft?.targetCoords
        ? `coords:${draft.targetCoords.galaxy}:${draft.targetCoords.system}:${draft.targetCoords.slot}`
        : options[0]?.match(/value="([^"]+)"/)?.[1] ?? "";

  if (selected && !options.some((o) => o.includes(`value="${selected}"`))) {
    selected = options[0]?.match(/value="([^"]+)"/)?.[1] ?? "";
  }

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

  const cargoBlock =
    mission === "transport"
      ? `<div class="cargo-load" data-testid="cargo-load">
          <label>Metal <input type="number" min="0" value="${draft?.cargo.metal ?? 0}" data-cargo-metal /></label>
          <label>Crystal <input type="number" min="0" value="${draft?.cargo.crystal ?? 0}" data-cargo-crystal /></label>
          <label>Deut <input type="number" min="0" value="${draft?.cargo.deuterium ?? 0}" data-cargo-deuterium /></label>
        </div>`
      : "";

  const needHint =
    options.length === 0
      ? mission === "transport"
        ? `<p class="hint" data-testid="fleet-need-colony">Need a second world: research Astrophysics, build a Colony Ship, colonize an empty galaxy slot — then transport cargo there.</p>`
        : mission === "deploy"
          ? `<p class="hint" data-testid="fleet-need-deploy-target">Colonize for park targets, or join a second commander to visit rivals.</p>`
          : mission === "colonize"
            ? `<p class="hint">Browse the galaxy for an empty slot in this system (or change system).</p>`
            : mission === "harvest"
              ? `<p class="hint">No debris in this system yet — win a raid that destroys ships.</p>`
              : `<p class="hint" data-testid="fleet-need-rival">Join a second commander (another tab) to unlock raid / spy targets.</p>`
      : "";

  const sampleShips: FleetShips = {
    scout: 1,
    hauler: 0,
    interceptor: 0,
    probe: 0,
    recycler: 0,
    colonyShip: 0,
  };
  const sampleTarget = rivals[0]?.coords ?? view.planet.coords;
  const sampleEta = flightSecondsOneWay(
    view.planet.coords,
    sampleTarget,
    sampleShips,
    view.universe.fleetSpeed ?? view.universe.speed,
    view.player.research.combustionDrive ?? 0,
  );
  const sampleFuel = fuelCostOneWay(
    view.planet.coords,
    sampleTarget,
    sampleShips,
  );

  const missionRadios = MISSIONS.map((m) => {
    const labels: Record<MissionType, string> = {
      deploy: "Deploy (park own / visit rival)",
      raid: "Raid / attack",
      espionage: "Espionage (Spy Probe)",
      transport: "Transport cargo (own worlds)",
      colonize: "Colonize empty slot",
      harvest: "Harvest debris",
    };
    return `<label><input type="radio" name="fleet-mission" value="${m}" data-testid="mission-${m}" ${mission === m ? "checked" : ""} ${busy ? "disabled" : ""} /> ${labels[m]}</label>`;
  }).join("");

  return `
    <form id="fleet-form" data-testid="fleet-form" class="fleet-form">
      <fieldset class="mission-pick">
        <legend>Mission</legend>
        ${missionRadios}
      </fieldset>
      <label>
        Target
        <select id="fleet-target" data-testid="fleet-target" ${busy || options.length === 0 ? "disabled" : ""}>
          ${options.join("") || `<option value="">No targets</option>`}
        </select>
      </label>
      ${cargoBlock}
      <div class="fleet-ships">${shipInputs}</div>
      ${needHint}
      <p class="hint">Example one-way ETA ~${fmtEta(sampleEta)} · fuel ~${sampleFuel} deut (1 scout). Fleet slots: ${1 + (view.player.research.computerTech ?? 0)}.</p>
      <button type="submit" data-testid="launch-fleet" ${busy || options.length === 0 ? "disabled" : ""}>Launch fleet</button>
    </form>
  `;
}
