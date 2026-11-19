import {
  DEFENSE_ORDER,
  DEFENSES,
  SHIP_ORDER,
  SHIPS,
  debrisFromDestroyed,
  destroyedShipResources,
  emptyDefenses,
  emptyFleetShips,
  normalizeFleetShips,
  parseCombatSimPaste,
  runCombatSandbox,
  simDefenseId,
  simShipId,
  type CombatReport,
  type CombatResolution,
  type DefenseId,
  type DefenseStock,
  type EspionageReport,
  type FleetShips,
  type PlanetState,
  type PlayerView,
  type ResearchLevels,
  type Resources,
} from "@starhold/game";
import { fmt, fmtCoords } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { combatBattleExtrasHtml } from "./render-fleets-panels";
import { combatReadoutHtml } from "./render-messages";

const SIM_REPORT_ID = "combat-sim";

interface SimState {
  planetId: string | null;
  attacker: FleetShips;
  defenderShips: FleetShips;
  defenderDefenses: DefenseStock;
  defenderResearch: Partial<ResearchLevels> | null;
  defenderLabel: string;
  seed: string;
  paste: string;
  spyId: string;
  touchedAttacker: boolean;
  touchedDefender: boolean;
  result: CombatResolution | null;
  debris: Resources | null;
  error: string | null;
}

function freshState(): SimState {
  return {
    planetId: null,
    attacker: emptyFleetShips(),
    defenderShips: emptyFleetShips(),
    defenderDefenses: emptyDefenses(),
    defenderResearch: null,
    defenderLabel: "Defender",
    seed: "starhold-sim",
    paste: "",
    spyId: "",
    touchedAttacker: false,
    touchedDefender: false,
    result: null,
    debris: null,
    error: null,
  };
}

let state: SimState = freshState();

export function resetCombatSimState(): void {
  state = freshState();
}

export function syncCombatSimPlanet(planet: PlanetState): void {
  if (state.planetId === planet.id) return;
  state.planetId = planet.id;
  state.attacker = normalizeFleetShips(planet.ships);
  state.touchedAttacker = false;
  state.result = null;
  state.debris = null;
}

export function resetCombatSimOrbit(planet: PlanetState): void {
  state.planetId = planet.id;
  state.attacker = normalizeFleetShips(planet.ships);
  state.touchedAttacker = false;
  state.result = null;
  state.debris = null;
}

export function loadCombatSimSpy(report: EspionageReport): void {
  state.spyId = report.id;
  state.defenderLabel = report.targetName || "Defender";
  state.touchedDefender = false;
  state.error = null;
  if (report.ships) state.defenderShips = normalizeFleetShips(report.ships);
  if (report.defenses) state.defenderDefenses = { ...emptyDefenses(), ...report.defenses };
  state.defenderResearch = report.research ? { ...report.research } : null;
  if (!report.ships && !report.defenses) {
    state.error = "This scan has no fleet or defense counts.";
  }
}

export function applyCombatSimPaste(text: string): boolean {
  state.paste = text;
  const parsed = parseCombatSimPaste(text);
  if (!parsed.ok) {
    state.error = parsed.error;
    return false;
  }
  state.defenderShips = parsed.ships;
  state.defenderDefenses = parsed.defenses;
  state.defenderResearch = parsed.research;
  state.defenderLabel = "Pasted defender";
  state.spyId = "";
  state.touchedDefender = false;
  state.error = null;
  return true;
}

export function applyCombatSimField(el: HTMLInputElement | HTMLTextAreaElement): void {
  if (el instanceof HTMLTextAreaElement) {
    if (el.hasAttribute("data-sim-paste")) state.paste = el.value;
    return;
  }
  if (el.hasAttribute("data-sim-seed")) {
    state.seed = el.value;
    return;
  }
  const n = countOf(el.value);
  const attacker = simShipId(el.getAttribute("data-sim-attacker"));
  if (attacker) {
    state.attacker[attacker] = n;
    state.touchedAttacker = true;
    return;
  }
  const defenderShip = simShipId(el.getAttribute("data-sim-defender-ship"));
  if (defenderShip) {
    state.defenderShips[defenderShip] = n;
    state.touchedDefender = true;
    return;
  }
  const defense = simDefenseId(el.getAttribute("data-sim-defender-defense"));
  if (defense) {
    state.defenderDefenses[defense] = n;
    state.touchedDefender = true;
  }
}

export function setCombatSimSeed(seed: string): void {
  state.seed = seed;
}

export function runCombatSim(view: PlayerView): CombatResolution {
  const result = runCombatSandbox({
    attacker: state.attacker,
    defender: state.defenderShips,
    defenses: state.defenderDefenses,
    attackerResearch: view.player.research,
    attackerLevel: view.player.level,
    attackerClassId: view.player.playerClass?.classId ?? null,
    defenderResearch: state.defenderResearch,
    seed: state.seed,
  });
  state.result = result;
  state.debris = addResources(
    debrisFromDestroyed(destroyedShipResources(state.attacker, result.attackerAfter)),
    debrisFromDestroyed(destroyedShipResources(state.defenderShips, result.defenderAfter)),
  );
  state.error = null;
  return result;
}

function countOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function addResources(a: Resources, b: Resources): Resources {
  return {
    metal: a.metal + b.metal,
    crystal: a.crystal + b.crystal,
    deuterium: 0,
  };
}

function editedAttr(on: boolean): string {
  return on ? ` data-user-edited="1"` : "";
}

function shipFields(
  kind: "attacker" | "defender",
  counts: FleetShips,
  orbit: FleetShips | null,
  touched: boolean,
): string {
  return SHIP_ORDER.map((id) => {
    const attr = kind === "attacker" ? "data-sim-attacker" : "data-sim-defender-ship";
    const orbitNote = orbit
      ? ` <span class="meta">(in orbit ${fmt(orbit[id] ?? 0)})</span>`
      : "";
    return `<label class="fleet-ship" data-testid="combat-sim-${kind}-row-${id}"><span>${escapeHtml(SHIPS[id].name)}${orbitNote}</span><input type="number" min="0" step="1" inputmode="numeric" value="${counts[id] ?? 0}" ${attr}="${id}" data-testid="combat-sim-${kind}-${id}"${editedAttr(touched)} /></label>`;
  }).join("");
}

function defenseFields(counts: DefenseStock, touched: boolean): string {
  return DEFENSE_ORDER.map((id: DefenseId) => {
    return `<label class="fleet-ship" data-testid="combat-sim-defense-row-${id}"><span>${escapeHtml(DEFENSES[id].name)}</span><input type="number" min="0" step="1" inputmode="numeric" value="${counts[id] ?? 0}" data-sim-defender-defense="${id}" data-testid="combat-sim-defense-${id}"${editedAttr(touched)} /></label>`;
  }).join("");
}

function unitTable(
  title: string,
  testId: string,
  rows: Array<{ name: string; before: number; after: number }>,
): string {
  const body = rows
    .filter((row) => row.before > 0 || row.after > 0)
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row.name)}</th><td>${fmt(row.before)}</td><td>${fmt(row.after)}</td><td>${fmt(Math.max(0, row.before - row.after))}</td></tr>`,
    )
    .join("");
  return `<div class="battle-ship-totals" data-testid="${testId}"><h4>${escapeHtml(title)}</h4>${
    body
      ? `<table class="report-composition-table"><thead><tr><th>Unit</th><th>Before</th><th>After</th><th>Lost</th></tr></thead><tbody>${body}</tbody></table>`
      : `<p class="meta">None</p>`
  }</div>`;
}

function resultHtml(view: PlayerView): string {
  const result = state.result;
  if (!result || !state.debris) return "";
  const report: CombatReport = {
    id: SIM_REPORT_ID,
    at: view.now,
    missionId: SIM_REPORT_ID,
    attackerPlayerId: view.player.id,
    defenderPlayerId: "sim-defender",
    attackerName: view.player.name,
    defenderName: state.defenderLabel,
    originCoords: view.planet.coords,
    targetCoords: view.planet.coords,
    attackerBefore: normalizeFleetShips(state.attacker),
    attackerAfter: result.attackerAfter,
    defenderBefore: normalizeFleetShips(state.defenderShips),
    defenderAfter: result.defenderAfter,
    defensesBefore: { ...state.defenderDefenses },
    defensesAfter: result.defensesAfter,
    loot: { metal: 0, crystal: 0, deuterium: 0 },
    debrisCreated: state.debris,
    outcome: result.outcome,
    rounds: result.rounds,
    summary: result.summary,
    roundLog: result.roundLog,
  };
  const defenses = DEFENSE_ORDER.map((id) => ({
    name: DEFENSES[id].name,
    before: state.defenderDefenses[id] ?? 0,
    after: result.defensesAfter[id] ?? 0,
  }));
  return `<div class="sim-result" data-testid="combat-sim-result">
    <h3>Simulation</h3>
    <p data-testid="combat-sim-outcome">${escapeHtml(result.summary)} · ${fmt(result.rounds)} rounds · ${escapeHtml(result.outcome.replaceAll("_", " "))}</p>
    ${combatReadoutHtml(report, view.player.id)}
    ${unitTable("Attacker ships", "combat-sim-attacker-table", SHIP_ORDER.map((id) => ({ name: SHIPS[id].name, before: state.attacker[id] ?? 0, after: result.attackerAfter[id] ?? 0 })))}
    ${unitTable("Defender ships", "combat-sim-defender-table", SHIP_ORDER.map((id) => ({ name: SHIPS[id].name, before: state.defenderShips[id] ?? 0, after: result.defenderAfter[id] ?? 0 })))}
    ${unitTable("Defenses", "combat-sim-defense-table", defenses)}
    ${combatBattleExtrasHtml(report)}
    <p class="hint">Loot stays at zero. Debris is the ship-loss figure from the combat rules. The sandbox hauls nothing and writes nothing.</p>
  </div>`;
}

export function combatSimHtml(view: PlayerView): string {
  syncCombatSimPlanet(view.planet);
  const reports = view.spyReports ?? [];
  const options = [
    `<option value="">Choose a spy report</option>`,
    ...reports.map((report) => {
      const selected = report.id === state.spyId ? " selected" : "";
      const label = `${report.targetName} ${fmtCoords(report.targetCoords)}`;
      return `<option value="${escapeAttr(report.id)}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
  const error = state.error
    ? `<p class="hint" data-testid="combat-sim-error">${escapeHtml(state.error)}</p>`
    : "";
  return `
    <section class="panel" data-testid="combat-sim">
      <h2>Combat simulator</h2>
      <p class="hint">This page runs the live combat engine in the browser. Fleets, resources, and the save stay as they are. Attacker fire includes your commander level and class attack. The seed repeats the same fight. Alliance, officer, and newbie multipliers stay on the real battle.</p>
      <div class="sim-columns" data-testid="combat-sim-columns">
        <div data-testid="combat-sim-attackers">
          <h3>Your ships</h3>
          <p class="hint">Prefilled from this colony. Edit any count.</p>
          ${shipFields("attacker", state.attacker, view.planet.ships, state.touchedAttacker)}
          <div class="fleet-actions" data-testid="combat-sim-reset-actions">
            <button type="button" data-sim-reset data-testid="combat-sim-reset-orbit">Use orbit counts</button>
          </div>
        </div>
        <div data-testid="combat-sim-defenders">
          <h3>Defender</h3>
          <label class="sim-spy" data-testid="combat-sim-spy-field">Spy report
            <select data-sim-spy data-testid="combat-sim-spy">${options}</select>
          </label>
          <label class="sim-paste" data-testid="combat-sim-paste-field">Paste a spy report
            <textarea data-sim-paste data-testid="combat-sim-paste" rows="4">${escapeHtml(state.paste)}</textarea>
          </label>
          <div class="fleet-actions" data-testid="combat-sim-paste-actions">
            <button type="button" data-sim-apply-paste data-testid="combat-sim-apply-paste">Load pasted report</button>
          </div>
          <h3>Defender ships</h3>
          ${shipFields("defender", state.defenderShips, null, state.touchedDefender)}
          <h3>Defender defenses</h3>
          ${defenseFields(state.defenderDefenses, state.touchedDefender)}
        </div>
      </div>
      <label class="sim-seed" data-testid="combat-sim-seed-field">Seed
        <input type="text" value="${escapeAttr(state.seed)}" data-sim-seed data-testid="combat-sim-seed"${editedAttr(true)} />
      </label>
      ${error}
      <div class="fleet-actions" data-testid="combat-sim-actions">
        <button type="button" data-sim-run data-testid="combat-sim-run">Run simulation</button>
      </div>
      ${resultHtml(view)}
    </section>`;
}
