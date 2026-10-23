import {
  EXPEDITION_SLOT,
  NEWBIE_PROTECTION_POINTS,
  SHIP_ORDER,
  SHIPS,
  fuelCostOneWay,
  flightSecondsOneWay,
  normalizeFleetShips,
  type MissionType,
  type PlayerView,
} from "@starhold/game";
import { SHIP_ART } from "./assets";
import { fmt, fmtCoords, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { MISSIONS, type FleetDraft } from "./render-fleets-draft.js";
import { infoTooltip } from "./render-tooltips";

export function fleetComposer(
  view: PlayerView,
  busy: boolean,
  draft: FleetDraft | null,
): string {
  const mission = draft?.mission ?? "deploy";
  const rivals = view.roster.filter((r) => r.id !== view.player.id);
  const attackableRivals = rivals.filter(
    (r) => r.pointsHint >= NEWBIE_PROTECTION_POINTS,
  );
  const canAttack = (playerId: string): boolean => {
    const row = view.roster.find((r) => r.id === playerId);
    return row != null && row.pointsHint >= NEWBIE_PROTECTION_POINTS;
  };
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
    for (const r of attackableRivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}" data-target-role="attack">Attack ${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
    for (const s of view.galaxy.slots) {
      if (
        s.moonId &&
        s.playerId &&
        s.playerId !== view.player.id &&
        canAttack(s.playerId)
      ) {
        options.push(
          `<option value="planet:${escapeAttr(s.moonId)}" data-target-role="attack">Attack moon @ ${fmtCoords(s.coords)}</option>`,
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
        `<option value="asteroid:${escapeAttr(a.id)}">Asteroid ${escapeHtml(a.id)} (${fmt(a.metal)}/${fmt(a.crystal)}/${fmt(a.deuterium)} · ${fmt(a.richness)} left)</option>`,
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
        `<option value="pirate:${escapeAttr(pirate.id)}">${escapeHtml(pirate.name)} · Lv ${pirate.level ?? pirate.tier} · ${pirate.threatHint} · ${fmtCoords(pirate.coords)}</option>`,
      );
    }
  } else if (mission === "alienRaid") {
    const alien = view.galaxy.alienBase;
    if (alien) {
      options.push(
        `<option value="alien:${escapeAttr(alien.id)}">${escapeHtml(alien.name)} · Aliens · Lv ${alien.level ?? alien.tier} · ${alien.threatHint} · ${fmtCoords(alien.coords)}</option>`,
      );
    }
  } else if (mission === "espionage") {
    for (const r of rivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}" data-target-role="spy">Spy ${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
    for (const s of view.galaxy.slots) {
      if (s.moonId && s.playerId && s.playerId !== view.player.id) {
        options.push(
          `<option value="planet:${escapeAttr(s.moonId)}" data-target-role="spy" data-has-moon="1">Spy moon @ ${fmtCoords(s.coords)}</option>`,
        );
      }
    }
  } else if (mission === "raid") {
    for (const r of attackableRivals) {
      options.push(
        `<option value="planet:${escapeAttr(r.planetId)}" data-target-role="attack">Attack ${escapeHtml(r.name)} · ${fmtCoords(r.coords)}</option>`,
      );
    }
    for (const s of view.galaxy.slots) {
      if (
        s.moonId &&
        s.playerId &&
        s.playerId !== view.player.id &&
        canAttack(s.playerId)
      ) {
        options.push(
          `<option value="planet:${escapeAttr(s.moonId)}" data-target-role="attack" data-has-moon="1">Attack moon @ ${fmtCoords(s.coords)}</option>`,
        );
      }
    }
  } else {
    const _exhaustive: never = mission;
    void _exhaustive;
  }

  if (
    draft?.targetCoords &&
    (mission === "raid" || mission === "pirateRaid")
  ) {
    const c = draft.targetCoords;
    const value = `coords:${c.galaxy}:${c.system}:${c.slot}`;
    if (!options.some((o) => o.includes(`value="${value}"`))) {
      options.push(
        `<option value="${value}">Joint Strike ${fmtCoords(c)}</option>`,
      );
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
  const selectedPlanetId = selected.startsWith("planet:")
    ? selected.slice("planet:".length)
    : null;
  const selectedCoords = selected.startsWith("coords:")
    ? selected.slice("coords:".length).split(":").map(Number)
    : null;
  const targetIsRealPlayer =
    mission === "raid" &&
    (view.roster.some(
      (r) =>
        r.id !== view.player.id &&
        (selectedPlanetId != null
          ? r.planetId === selectedPlanetId
          : selectedCoords != null &&
            r.coords.galaxy === selectedCoords[0] &&
            r.coords.system === selectedCoords[1] &&
            r.coords.slot === selectedCoords[2]),
    ) ||
      view.galaxy.slots.some(
        (s) =>
          s.playerId != null &&
          s.playerId !== view.player.id &&
          (selectedPlanetId != null
            ? s.planetId === selectedPlanetId || s.moonId === selectedPlanetId
            : selectedCoords != null &&
              s.coords.galaxy === selectedCoords[0] &&
              s.coords.system === selectedCoords[1] &&
              s.coords.slot === selectedCoords[2]),
      ));
  const currentPlayer = view.roster.find((r) => r.id === view.player.id);
  const showNewbieProtectionWarning =
    targetIsRealPlayer &&
    currentPlayer != null &&
    currentPlayer.pointsHint < NEWBIE_PROTECTION_POINTS &&
    view.player.newbieForfeitedAt == null;
  const optionHtml = options
    .map((html) => markSelectedOption(html, selected))
    .join("");

  const orbitShipIds = SHIP_ORDER.filter(
    (id) => (view.planet.ships[id] ?? 0) > 0 && !SHIPS[id].stationary,
  );
  const shipInputs = orbitShipIds.length
    ? orbitShipIds
        .map((id) => {
          const have = view.planet.ships[id] ?? 0;
          const raw = draft?.counts[id] ?? 0;
          const value = Math.min(have, Math.max(0, raw));
          const def = SHIPS[id];
          const tip = infoTooltip({
            title: def.name,
            lines: [
              def.description,
              `Cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)} · in orbit ${fmt(have)}`,
            ],
            testId: `fleet-ship-tip-${id}`,
          });
          return `
      <label class="fleet-ship">
        <img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />
        <span>${escapeHtml(def.name)} ${tip.html} <span class="meta">(in orbit ${fmt(have)})</span></span>
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

  const expeditionCap = view.expeditionSlotCap;
  const fleetCap = view.fleetSlotCap;
  const fleetActive = view.fleets.length;
  const expeditionActive = view.fleets.filter((f) => f.mission === "expedition")
    .length;
  const protectedFromAttack =
    (mission === "raid" || mission === "deploy") &&
    options.length === 0 &&
    rivals.length > 0 &&
    attackableRivals.length === 0;
  const needHint = protectedFromAttack
    ? `<p class="hint" data-testid="fleet-targets-protected">No attack targets. Commanders under ${fmt(NEWBIE_PROTECTION_POINTS)} points are protected.</p>`
    : mission === "expedition" && expeditionActive >= expeditionCap
      ? `<p class="hint" data-testid="fleet-need-expedition-slot">Expedition slots full (${fmt(expeditionActive)}/${fmt(expeditionCap)}). Research Stellar Cartography for more.</p>`
      : options.length === 0
        ? mission === "transport"
          ? `<p class="hint" data-testid="fleet-need-colony">Need a second world: research Stellar Cartography, build a Colonizer, colonize an empty galaxy slot — then transport cargo there.</p>`
          : mission === "jump"
            ? `<p class="hint" data-testid="fleet-need-jump-moon">Need another of your moons with a Fold Bridge (form moons from large debris, then build Crater Hab + Fold Bridge on both).</p>`
            : mission === "deploy"
              ? `<p class="hint" data-testid="fleet-need-deploy-target">Colonize for park targets, or join a second commander for attacking another rival.</p>`
              : mission === "colonize"
                ? `<p class="hint">Browse the galaxy for an empty slot in this system (or change system).</p>`
                : mission === "harvest"
                  ? `<p class="hint">No debris in this system yet — win a raid that destroys ships.</p>`
                  : mission === "harvestAsteroid"
                    ? `<p class="hint">No asteroids in this system — browse another system.</p>`
                    : mission === "pirateRaid"
                      ? `<p class="hint">No pirate base in this system — browse the galaxy for NPC activity.</p>`
                    : mission === "alienRaid"
                      ? `<p class="hint">No alien base in this system — find them via expedition.</p>`
                      : `<p class="hint" data-testid="fleet-need-rival">Join a second commander (another tab) for attacking another rival / spy targets.</p>`
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

  const missionMeta: Record<
    MissionType,
    { label: string; detail: string; requires?: string[] }
  > = {
    deploy: {
      label: "Deploy (park own / attack rival)",
      detail: "Park ships on your worlds or strike a rival colony.",
    },
    raid: {
      label: "Raid / attack",
      detail: "Combat mission against a rival — winners leave debris.",
    },
    espionage: {
      label: "Spy (Whisper Probe)",
      detail: "Probe a foreign world for fleet, defense, and resource intel.",
      requires: ["Whisper Probe in orbit"],
    },
    transport: {
      label: "Transport cargo (own worlds)",
      detail: "Move metal, crystal, and deuterium between your colonies.",
      requires: ["Second owned world"],
    },
    colonize: {
      label: "Colonize empty slot",
      detail: "Found a new colony on an empty galaxy slot.",
      requires: ["Colonizer in the fleet"],
    },
    harvest: {
      label: "Harvest debris",
      detail: "Collect metal/crystal from a debris field after combat.",
      requires: ["Recycler / harvester hull"],
    },
    harvestAsteroid: {
      label: "Harvest asteroid (Salvage Trawler)",
      detail: "Mine an asteroid field for resources.",
      requires: ["Salvage Trawler"],
    },
    expedition: {
      label: "Expedition (deep space)",
      detail: "Send fleets beyond the system for finds and Starshards.",
      requires: ["Free expedition slot"],
    },
    pirateRaid: {
      label: "Raid pirate base",
      detail: "Attack the system pirate base — destroy to earn rewards.",
    },
    alienRaid: {
      label: "Raid alien base",
      detail: "Strike the system alien base while it is active.",
    },
    jump: {
      label: "Fold Bridge (moon → moon)",
      detail: "Instant transfer between your moons with Fold Bridges.",
      requires: ["Fold Bridge on both moons"],
    },
  };
  const missionRadios = MISSIONS.map((m) => {
    const meta = missionMeta[m];
    const tip = infoTooltip({
      title: meta.label,
      lines: [meta.detail],
      requires: meta.requires,
      testId: `mission-tip-${m}`,
    });
    return `<label><input type="radio" name="fleet-mission" value="${m}" data-testid="mission-${m}" ${mission === m ? "checked" : ""} ${busy ? "disabled" : ""} /> ${meta.label} ${tip.html}</label>`;
  }).join("");

  const presets = view.player.fleetPresets ?? [];
  const presetOptions = presets
    .map((p) => {
      const ships = SHIP_ORDER.filter((id) => (p.ships[id] ?? 0) > 0)
        .map((id) => `${fmt(p.ships[id] ?? 0)}×${SHIPS[id].name}`)
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
      <p class="hint" data-testid="fleet-slot-counters">Fleets ${fmt(fleetActive)}/${fmt(fleetCap)} · Expeditions ${fmt(expeditionActive)}/${fmt(expeditionCap)}</p>
      <fieldset class="mission-pick">
        <legend>Mission</legend>
        ${missionRadios}
      </fieldset>
      ${presetPanel}
      <label>
        Target
        <select id="fleet-target" data-testid="fleet-target" ${launchBlocked ? "disabled" : ""}>
          ${optionHtml || `<option value="">No targets</option>`}
        </select>
      </label>
      ${cargoBlock}
      <div class="fleet-ships" data-testid="fleet-orbit-ships">${shipInputs}</div>
      ${needHint}
      ${
        showNewbieProtectionWarning
          ? `<p class="hint" data-testid="fleet-newbie-protection-warning">Launching this attack ends your newbie protection.</p>`
          : ""
      }
      ${acsBlock(view, mission, busy, draft)}
      <p class="hint">Ships shown are in orbit on the selected colony. Example one-way ETA ~${fmtEta(sampleEta)} · fuel ~${fmt(sampleFuel)} deut (1 scout).</p>
      <button type="submit" data-testid="launch-fleet" ${launchBlocked || orbitShipIds.length === 0 ? "disabled" : ""}>Launch fleet</button>
      ${
        view.alliance
          ? `<button type="button" data-propose-strike data-testid="propose-joint-strike" ${busy ? "disabled" : ""}>Propose Joint Strike</button>`
          : ""
      }
    </form>
  `;
}

function markSelectedOption(html: string, selected: string): string {
  if (!selected) return html;
  const needle = `value="${selected}"`;
  if (!html.includes(needle)) return html;
  return html.replace(needle, `${needle} selected`);
}

function acsBlock(
  view: PlayerView,
  mission: MissionType,
  busy: boolean,
  draft: FleetDraft | null,
): string {
  if (mission !== "raid" && mission !== "pirateRaid") return "";
  if (!view.alliance) {
    return `<p class="hint" data-testid="acs-need-alliance">Joint Strike (ACS) requires an alliance.</p>`;
  }
  const open = view.openAcsGroups ?? [];
  const joinOpts = open
    .filter((g) => g.mission === mission)
    .map(
      (g) =>
        `<option value="${escapeAttr(g.id)}">${escapeHtml(g.id.slice(0, 12))} · ${g.fleetIds.length} fleets · closes ${fmtEta(Math.max(0, (g.joinClosesAt - view.now) / 1000))}</option>`,
    )
    .join("");
  return `
    <fieldset class="acs-pick" data-testid="acs-pick">
      <legend>Joint Strike (ACS)</legend>
      <label>
        <input type="checkbox" id="fleet-open-acs" data-testid="fleet-open-acs" ${draft?.openAcs ? "checked" : ""} ${busy ? "disabled" : ""} />
        Open Joint Strike for alliance mates
      </label>
      <label>
        Or join open ACS
        <select id="fleet-acs-join" data-testid="fleet-acs-join" ${busy ? "disabled" : ""}>
          <option value="">— solo / open new —</option>
          ${joinOpts}
        </select>
      </label>
    </fieldset>
  `;
}
