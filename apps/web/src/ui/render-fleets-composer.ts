import {
  EXPEDITION_SLOT,
  SHIP_ORDER,
  SHIPS,
  fuelCostOneWay,
  flightSecondsOneWay,
  maxExpeditions,
  normalizeFleetShips,
  type MissionType,
  type PlayerView,
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
        `<option value="planet:${escapeAttr(p.id)}">${escapeHtml(p.name)}${p.isMoon ? " · Moon" : ""} · ${fmtCoords(p.coords)}</option>`,
      );
    }
  } else if (mission === "jump") {
    const originGate = view.planet.kind === "moon"
      ? (view.planet.buildings.jumpGate ?? 0)
      : 0;
    for (const p of ownOther) {
      if (!p.isMoon || (p.jumpGateLevel ?? 0) < 1 || originGate < 1) continue;
      options.push(
        `<option value="planet:${escapeAttr(p.id)}">Jump → ${escapeHtml(p.name)} · ${fmtCoords(p.coords)}</option>`,
      );
    }
  } else if (mission === "deploy") {
    for (const p of ownOther) {
      options.push(
        `<option value="planet:${escapeAttr(p.id)}">Park @ ${escapeHtml(p.name)}${p.isMoon ? " Moon" : ""} · ${fmtCoords(p.coords)}</option>`,
      );
    }
    for (const r of rivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}">Visit ${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
    for (const s of view.galaxy.slots) {
      if (s.moonId && s.playerId && s.playerId !== view.player.id) {
        options.push(
          `<option value="planet:${escapeAttr(s.moonId)}">Visit moon @ ${fmtCoords(s.coords)}</option>`,
        );
      }
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
  } else if (mission === "harvestAsteroid") {
    for (const a of view.galaxy.asteroids ?? []) {
      options.push(
        `<option value="asteroid:${escapeAttr(a.id)}">Asteroid ${escapeHtml(a.id)} (${fmt(a.metal)}/${fmt(a.crystal)}/${fmt(a.deuterium)} · ${a.richness} left)</option>`,
      );
    }
  } else if (mission === "expedition") {
    const systems = new Set<number>([
      view.galaxy.system,
      view.planet.coords.system,
    ]);
    for (const system of [...systems].sort((a, b) => a - b)) {
      const c = {
        galaxy: view.galaxy.galaxy,
        system,
        slot: EXPEDITION_SLOT,
      };
      options.push(
        `<option value="coords:${c.galaxy}:${c.system}:${c.slot}">Deep space ${fmtCoords(c)}</option>`,
      );
    }
  } else if (mission === "pirateRaid") {
    const pirate = view.galaxy.pirateBase;
    if (pirate) {
      options.push(
        `<option value="pirate:${escapeAttr(pirate.id)}">${escapeHtml(pirate.name)} · T${pirate.tier} · ${pirate.threatHint} · ${fmtCoords(pirate.coords)}</option>`,
      );
    }
  } else {
    for (const r of rivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}">${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
    for (const s of view.galaxy.slots) {
      if (s.moonId && s.playerId && s.playerId !== view.player.id) {
        options.push(
          `<option value="planet:${escapeAttr(s.moonId)}" data-has-moon="1">Moon @ ${fmtCoords(s.coords)}</option>`,
        );
      }
    }
  }

  let selected =
    draft?.pirateBaseId != null
      ? `pirate:${draft.pirateBaseId}`
      : draft?.asteroidId != null
        ? `asteroid:${draft.asteroidId}`
        : draft?.targetPlanetId != null
          ? `planet:${draft.targetPlanetId}`
          : draft?.targetCoords
            ? `coords:${draft.targetCoords.galaxy}:${draft.targetCoords.system}:${draft.targetCoords.slot}`
            : options[0]?.match(/value="([^"]+)"/)?.[1] ?? "";

  if (selected && !options.some((o) => o.includes(`value="${selected}"`))) {
    selected = options[0]?.match(/value="([^"]+)"/)?.[1] ?? "";
  }

  const orbitShipIds = SHIP_ORDER.filter(
    (id) => (view.planet.ships[id] ?? 0) > 0,
  );
  const shipInputs = orbitShipIds.length
    ? orbitShipIds
        .map((id) => {
          const have = view.planet.ships[id] ?? 0;
          const raw = draft?.counts[id] ?? 0;
          const value = Math.min(have, Math.max(0, raw));
          return `
      <label class="fleet-ship">
        <img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />
        <span>${escapeHtml(SHIPS[id].name)} <span class="meta">(in orbit ${have})</span></span>
        <input type="number" min="0" max="${have}" value="${value}" data-fleet-count="${id}" data-testid="fleet-count-${id}" ${busy ? "disabled" : ""} />
      </label>`;
        })
        .join("")
    : `<p class="hint" data-testid="fleet-orbit-empty">No ships in orbit on this colony. Build at the shipyard or park a fleet here.</p>`;

  const cargoBlock =
    mission === "transport"
      ? `<div class="cargo-load" data-testid="cargo-load">
          <label>Metal <input type="number" min="0" value="${draft?.cargo.metal ?? 0}" data-cargo-metal /></label>
          <label>Crystal <input type="number" min="0" value="${draft?.cargo.crystal ?? 0}" data-cargo-crystal /></label>
          <label>Deut <input type="number" min="0" value="${draft?.cargo.deuterium ?? 0}" data-cargo-deuterium /></label>
        </div>`
      : "";

  const expeditionCap = maxExpeditions(view.player.research.astrophysics ?? 0);
  const expeditionActive = view.fleets.filter((f) => f.mission === "expedition")
    .length;
  const needHint =
    mission === "expedition" && expeditionActive >= expeditionCap
      ? `<p class="hint" data-testid="fleet-need-expedition-slot">Expedition slots full (${expeditionActive}/${expeditionCap}). Research Stellar Cartography for more.</p>`
      : options.length === 0
        ? mission === "transport"
          ? `<p class="hint" data-testid="fleet-need-colony">Need a second world: research Stellar Cartography, build an Outpost Cradle, colonize an empty galaxy slot — then transport cargo there.</p>`
          : mission === "jump"
            ? `<p class="hint" data-testid="fleet-need-jump-moon">Need another of your moons with a Fold Bridge (form moons from large debris, then build Crater Hab + Fold Bridge on both).</p>`
            : mission === "deploy"
              ? `<p class="hint" data-testid="fleet-need-deploy-target">Colonize for park targets, or join a second commander to visit rivals.</p>`
              : mission === "colonize"
                ? `<p class="hint">Browse the galaxy for an empty slot in this system (or change system).</p>`
                : mission === "harvest"
                  ? `<p class="hint">No debris in this system yet — win a raid that destroys ships.</p>`
                  : mission === "harvestAsteroid"
                    ? `<p class="hint">No asteroids in this system — browse another system.</p>`
                    : mission === "pirateRaid"
                      ? `<p class="hint">No pirate base in this system — browse the galaxy for NPC activity.</p>`
                      : `<p class="hint" data-testid="fleet-need-rival">Join a second commander (another tab) to unlock raid / spy targets.</p>`
        : "";
  const launchBlocked =
    busy ||
    options.length === 0 ||
    (mission === "expedition" && expeditionActive >= expeditionCap);

  const sampleShips = normalizeFleetShips({ scout: 1 });
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
      espionage: "Spy (Whisper Probe)",
      transport: "Transport cargo (own worlds)",
      colonize: "Colonize empty slot",
      harvest: "Harvest debris",
      harvestAsteroid: "Harvest asteroid (Salvage Trawler)",
      expedition: "Expedition (deep space)",
      pirateRaid: "Raid pirate base",
      jump: "Fold Bridge (moon → moon)",
    };
    return `<label><input type="radio" name="fleet-mission" value="${m}" data-testid="mission-${m}" ${mission === m ? "checked" : ""} ${busy ? "disabled" : ""} /> ${labels[m]}</label>`;
  }).join("");

  const presets = view.player.fleetPresets ?? [];
  const presetOptions = presets
    .map((p) => {
      const ships = SHIP_ORDER.filter((id) => (p.ships[id] ?? 0) > 0)
        .map((id) => `${p.ships[id]}×${SHIPS[id].name}`)
        .join(", ");
      return `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}${ships ? ` — ${escapeHtml(ships)}` : ""}</option>`;
    })
    .join("");
  const presetPanel = `
      <div class="fleet-presets" data-testid="fleet-presets">
        <label>
          Preset
          <select id="fleet-preset" data-testid="fleet-preset" ${busy ? "disabled" : ""}>
            <option value="">— select —</option>
            ${presetOptions}
          </select>
        </label>
        <button type="button" data-fleet-preset-apply data-testid="fleet-preset-apply" ${busy ? "disabled" : ""}>Load into form</button>
        <label class="fleet-preset-name">
          Save as
          <input type="text" id="fleet-preset-name" data-testid="fleet-preset-name" maxlength="48" placeholder="Custom name" ${busy ? "disabled" : ""} />
        </label>
        <button type="button" data-fleet-preset-save data-testid="fleet-preset-save" ${busy ? "disabled" : ""}>Save preset</button>
        <button type="button" data-fleet-preset-delete data-testid="fleet-preset-delete" ${busy ? "disabled" : ""}>Delete custom</button>
      </div>`;

  return `
    <form id="fleet-form" data-testid="fleet-form" class="fleet-form">
      <fieldset class="mission-pick">
        <legend>Mission</legend>
        ${missionRadios}
      </fieldset>
      ${presetPanel}
      <label>
        Target
        <select id="fleet-target" data-testid="fleet-target" ${launchBlocked ? "disabled" : ""}>
          ${options.join("") || `<option value="">No targets</option>`}
        </select>
      </label>
      ${cargoBlock}
      <div class="fleet-ships" data-testid="fleet-orbit-ships">${shipInputs}</div>
      ${needHint}
      <p class="hint">Ships shown are in orbit on the selected colony. Example one-way ETA ~${fmtEta(sampleEta)} · fuel ~${sampleFuel} deut (1 scout). Fleet slots: ${1 + (view.player.research.computerTech ?? 0)}${mission === "expedition" ? ` · expeditions ${expeditionActive}/${expeditionCap}` : ""}.</p>
      <button type="submit" data-testid="launch-fleet" ${launchBlocked || orbitShipIds.length === 0 ? "disabled" : ""}>Launch fleet</button>
    </form>
  `;
}
