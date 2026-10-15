import {
  DEFENSE_ORDER,
  DEFENSES,
  MAP_SYSTEMS,
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type CombatRoundLog,
  type DefenseStock,
  type FleetShips,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCoords, fmtEta, remainingSeconds } from "./format";
import { planetDiscHtml } from "./planet-disc";
import { escapeAttr, escapeHtml } from "./render-escape";
import { infoTooltip } from "./render-tooltips";

export function fleetsInFlight(
  fleets: PlayerView["fleets"],
  roster: PlayerView["roster"],
  now: number,
): string {
  if (!fleets.length) {
    return `<p class="hint">No fleets in flight.</p>`;
  }
  const nameFor = (playerId: string | null) =>
    playerId
      ? (roster.find((r) => r.id === playerId)?.name ?? "commander")
      : "empty slot";
  return `
    <ul class="roster fleets-live" data-testid="fleets-live">
      ${fleets
        .map((f) => {
          const ships = SHIP_ORDER.filter((id) => (f.ships[id] ?? 0) > 0)
            .map((id) => `${fmt(f.ships[id] ?? 0)}× ${SHIPS[id].name}`)
            .join(", ");
          const eta = fmtEta(remainingSeconds(f.arrivesAt, now));
          let phase: string;
          switch (f.phase) {
            case "outbound":
              phase = `→ ${escapeHtml(nameFor(f.targetPlayerId))} @ ${fmtCoords(f.targetCoords)} (${f.mission}${f.acsGroupId ? " · ACS" : ""})`;
              break;
            case "holding":
              phase = `◎ holding ACS @ ${fmtCoords(f.targetCoords)}`;
              break;
            case "returning":
              phase = `← returning home`;
              break;
            default: {
              const _exhaustive: never = f.phase;
              phase = _exhaustive;
            }
          }
          return `<li data-testid="fleet-${f.id}"><span>${phase}<br/><span class="meta">${escapeHtml(ships)}</span></span><span>${eta}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

function unitLossLine(
  ships: Partial<FleetShips> | undefined,
  defenses?: Partial<DefenseStock>,
): string {
  const parts: string[] = [];
  for (const id of SHIP_ORDER) {
    const n = ships?.[id] ?? 0;
    if (n > 0) parts.push(`${fmt(n)}× ${escapeHtml(SHIPS[id].name)}`);
  }
  if (defenses) {
    for (const id of DEFENSE_ORDER) {
      const n = defenses[id] ?? 0;
      if (n > 0) parts.push(`${fmt(n)}× ${escapeHtml(DEFENSES[id].name)}`);
    }
  }
  return parts.length ? parts.join(", ") : "none";
}

function roundPaneHtml(round: CombatRoundLog, active: boolean): string {
  const debris =
    (round.debrisThisRound?.metal ?? 0) + (round.debrisThisRound?.crystal ?? 0);
  return `
    <div class="battle-round" data-battle-round="${round.round}" ${active ? "" : "hidden"} data-testid="battle-round-${round.round}">
      <p class="meta"><strong>Round ${fmt(round.round)}</strong></p>
      <p class="meta">Attacker losses: ${unitLossLine(round.attackerLosses.ships)}</p>
      <p class="meta">Defender losses: ${unitLossLine(round.defenderLosses.ships, round.defenderLosses.defenses)}</p>
      ${
        debris > 0
          ? `<p class="meta">Round debris: ${fmt(round.debrisThisRound.metal)}/${fmt(round.debrisThisRound.crystal)}</p>`
          : `<p class="meta">Round debris: none</p>`
      }
    </div>
  `;
}

function battleReplayHtml(report: CombatReport): string {
  const log = report.roundLog ?? [];
  if (!log.length) {
    return `<p class="hint" data-testid="battle-replay-legacy">Summary only — older reports have no round replay.</p>`;
  }
  const tabs = log
    .map(
      (round, i) =>
        `<button type="button" class="battle-round-tab${i === 0 ? " is-active" : ""}" data-battle-round-tab="${round.round}" data-testid="battle-round-tab-${round.round}">R${fmt(round.round)}</button>`,
    )
    .join("");
  const panes = log.map((round, i) => roundPaneHtml(round, i === 0)).join("");
  return `
    <div class="battle-replay" data-testid="battle-replay">
      <div class="battle-round-tabs" role="tablist">${tabs}</div>
      ${panes}
    </div>
  `;
}

/** Share + round replay controls (Fleet list and Messages inbox). */
export function combatBattleExtrasHtml(report: CombatReport): string {
  return `
    <div class="battle-report-actions">
      <button type="button" class="ghost" data-copy-battle-share="${escapeAttr(report.id)}" data-testid="copy-battle-share-${escapeAttr(report.id)}">Copy share</button>
    </div>
    <details class="battle-report-details" data-testid="battle-details-${escapeAttr(report.id)}">
      <summary>Replay rounds</summary>
      ${battleReplayHtml(report)}
    </details>
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
          const debris =
            (r.debrisCreated?.metal ?? 0) + (r.debrisCreated?.crystal ?? 0) > 0
              ? ` · debris ${fmt(r.debrisCreated.metal)}/${fmt(r.debrisCreated.crystal)}`
              : "";
          const moon = r.moonFormed ? " · moon formed" : "";
          const xp =
            r.xpAwarded != null
              ? ` · XP atk +${fmt(r.xpAwarded.attacker)} / def +${fmt(r.xpAwarded.defender)}`
              : "";
          const share =
            r.shareCode != null
              ? ` · share ${escapeHtml(r.shareCode)}`
              : "";
          return `<li data-testid="report-${r.id}" data-report-id="${escapeAttr(r.id)}">
            <strong>${role}: ${escapeHtml(r.outcome)}</strong>${typeof r.rounds === "number" ? ` · ${r.rounds}r` : ""} vs ${escapeHtml(r.attackerPlayerId === selfId ? r.defenderName : r.attackerName)} @ ${fmtCoords(r.targetCoords)}${loot}${debris}${moon}${xp}${share}
            <br/><span class="meta">${escapeHtml(r.summary)}</span>
            ${combatBattleExtrasHtml(r)}
          </li>`;
        })
        .join("")}
    </ul>
  `;
}

export function sensorContactsHtml(
  contacts: PlayerView["sensorContacts"],
  roster: PlayerView["roster"],
  now: number,
): string {
  if (!contacts?.length) {
    return "";
  }
  const nameFor = (playerId: string) =>
    roster.find((r) => r.id === playerId)?.name ?? "commander";
  return `
    <h3 class="subhead">Sensor contacts</h3>
    <ul class="roster" data-testid="sensor-contacts">
      ${contacts
        .map((f) => {
          const ships = SHIP_ORDER.filter((id) => (f.ships[id] ?? 0) > 0)
            .map((id) => `${fmt(f.ships[id] ?? 0)}× ${SHIPS[id].name}`)
            .join(", ");
          return `<li data-testid="sensor-${f.id}"><span>${escapeHtml(nameFor(f.ownerPlayerId))} ${escapeHtml(f.mission)} → ${fmtCoords(f.targetCoords)}<br/><span class="meta">${escapeHtml(ships)}</span></span><span>${fmtEta(remainingSeconds(f.arrivesAt, now))}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

export function hostileInboundHtml(
  contacts: PlayerView["hostileInbound"],
  roster: PlayerView["roster"],
  now: number,
): string {
  if (!contacts?.length) {
    return "";
  }
  const nameFor = (playerId: string) =>
    roster.find((r) => r.id === playerId)?.name ?? "commander";
  return `
    <h3 class="subhead">Hostile inbound</h3>
    <ul class="roster" data-testid="hostile-inbound">
      ${contacts
        .map((f) => {
          const ships = SHIP_ORDER.filter((id) => (f.ships[id] ?? 0) > 0)
            .map((id) => `${fmt(f.ships[id] ?? 0)}× ${SHIPS[id].name}`)
            .join(", ");
          return `<li data-testid="inbound-${f.id}"><span>${escapeHtml(nameFor(f.ownerPlayerId))} ${escapeHtml(f.mission)} → ${fmtCoords(f.targetCoords)}<br/><span class="meta">${escapeHtml(ships)}</span></span><span>${fmtEta(remainingSeconds(f.arrivesAt, now))}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

export function spyReportsHtml(
  reports: PlayerView["spyReports"],
  inAlliance = false,
): string {
  if (!reports?.length) {
    return `<p class="hint">No espionage reports yet.</p>`;
  }
  return `
    <h3 class="subhead">Spy reports</h3>
    <ul class="reports" data-testid="spy-reports">
      ${reports
        .map((r) => {
          const bits: string[] = [];
          if (r.resources) {
            bits.push(
              `res ${fmt(r.resources.metal)}/${fmt(r.resources.crystal)}/${fmt(r.resources.deuterium)}`,
            );
          }
          if (r.ships) {
            const ships = SHIP_ORDER.filter((id) => (r.ships?.[id] ?? 0) > 0)
              .map((id) => `${fmt(r.ships![id] ?? 0)}×${SHIPS[id].name}`)
              .join(", ");
            if (ships) bits.push(ships);
          }
          const share = inAlliance
            ? `<button type="button" data-share-intel="${escapeAttr(r.id)}" data-testid="share-intel-${escapeAttr(r.id)}">Share with alliance</button>`
            : "";
          return `<li data-testid="spy-${r.id}"><strong>Spy L${fmt(r.detail)}</strong> ${escapeHtml(r.targetName)} @ ${fmtCoords(r.targetCoords)}<br/><span class="meta">${escapeHtml(r.summary)}${bits.length ? ` · ${escapeHtml(bits.join(" · "))}` : ""}</span>${share}</li>`;
        })
        .join("")}
    </ul>
  `;
}

export function expeditionReportsHtml(
  reports: PlayerView["expeditionReports"],
): string {
  if (!reports?.length) {
    return `<p class="hint">No expedition reports yet.</p>`;
  }
  return `
    <h3 class="subhead">Expedition reports</h3>
    <ul class="reports" data-testid="expedition-reports">
      ${reports
        .map((r) => {
          const cargo =
            r.cargoGained.metal +
              r.cargoGained.crystal +
              r.cargoGained.deuterium >
            0
              ? ` · ${fmt(r.cargoGained.metal)}/${fmt(r.cargoGained.crystal)}/${fmt(r.cargoGained.deuterium)}`
              : "";
          return `<li data-testid="expedition-${r.id}"><strong>${escapeHtml(r.kind)}</strong> @ ${fmtCoords(r.targetCoords)}${cargo}<br/><span class="meta">${escapeHtml(r.summary)}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

export function galaxyPanel(
  view: PlayerView,
  busy: boolean,
): string {
  const { galaxy } = view;
  const inAlliance = Boolean(view.alliance);
  const rows = galaxy.slots
    .map((s) => {
      const debris = s.debris
        ? ` · debris ${fmt(s.debris.metal)}/${fmt(s.debris.crystal)}`
        : "";
      const moon = s.hasMoon ? " · Moon" : "";
      const tag = s.allianceTag ? ` [${escapeHtml(s.allianceTag)}]` : "";
      const who = s.playerName
        ? `${escapeHtml(s.playerName)}${tag}${s.isOwn ? " (you)" : ""}${s.isMini ? " · Mini" : ""} · ~${fmt(s.pointsHint)} pts${moon}`
        : "Empty";
      const marker = s.allianceMarker;
      const tip = marker
        ? marker.note
          ? `${marker.note} — marked by ${marker.markedBy}`
          : `Marked by ${marker.markedBy}`
        : "";
      const pin = marker
        ? `<span class="galaxy-marker-pin" data-testid="galaxy-marker-${s.coords.slot}" title="${escapeAttr(tip)}">◆</span>`
        : "";
      const actions = inAlliance
        ? `<span class="galaxy-slot-actions"><button type="button" data-galaxy-mark="${s.coords.slot}" data-testid="galaxy-mark-${s.coords.slot}" ${busy ? "disabled" : ""}>Mark</button><button type="button" data-galaxy-propose="${s.coords.slot}" data-testid="galaxy-propose-${s.coords.slot}" ${busy ? "disabled" : ""}>Propose Joint Strike</button></span>`
        : "";
      const disc = planetDiscHtml({
        src: s.artThumbUrl,
        artId: s.artId,
        size: 40,
        className: s.planetId ? undefined : "planet-disc-empty",
        testId: `galaxy-art-${s.coords.slot}`,
      });
      const moonDisc = s.hasMoon
        ? planetDiscHtml({
            src: s.artThumbUrl,
            artId: s.artId,
            size: 26,
            className: "planet-disc-moon",
            testId: `galaxy-moon-art-${s.coords.slot}`,
          })
        : "";
      return `<li class="galaxy-slot${marker ? " galaxy-slot-marked" : ""}" data-testid="galaxy-slot-${s.coords.slot}" data-art-id="${escapeAttr(s.artId)}"><span class="galaxy-slot-main">${pin}${disc}${moonDisc}<span class="galaxy-slot-label">${fmt(s.coords.slot)}. ${who}${debris}</span></span><span class="galaxy-slot-side">${fmtCoords(s.coords)}${actions}</span></li>`;
    })
    .join("");
  const markerTools = inAlliance
    ? `<div class="galaxy-alliance-tools alliance-form" data-testid="galaxy-alliance-tools"><label>Marker note<input type="text" id="galaxy-marker-note" data-testid="galaxy-marker-note" maxlength="80" placeholder="Siege window" ${busy ? "disabled" : ""} /></label></div>`
    : "";
  const asteroids =
    galaxy.asteroids?.length > 0
      ? `<ul class="roster" data-testid="galaxy-asteroids">${galaxy.asteroids
          .map(
            (a) =>
              `<li data-testid="asteroid-${escapeAttr(a.id)}"><span>Asteroid ${escapeHtml(a.id)} · richness ${fmt(a.richness)}</span><span>${fmt(a.metal)}/${fmt(a.crystal)}/${fmt(a.deuterium)}</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="hint" data-testid="galaxy-asteroids-empty">No asteroid fields in this system.</p>`;
  const pirate = galaxy.pirateBase
    ? `<p class="hint pirate-row" data-testid="galaxy-pirate">${escapeHtml(galaxy.pirateBase.name)} · Lv ${fmt(galaxy.pirateBase.level ?? galaxy.pirateBase.tier)} · threat ${escapeHtml(galaxy.pirateBase.threatHint)} · ${fmtCoords(galaxy.pirateBase.coords)}</p>`
    : `<p class="hint" data-testid="galaxy-pirate-empty">No pirate base reported.</p>`;
  const alien = galaxy.alienBase
    ? `<p class="hint alien-row" data-testid="galaxy-alien">${escapeHtml(galaxy.alienBase.name)} · Aliens · Lv ${fmt(galaxy.alienBase.level ?? galaxy.alienBase.tier)} · threat ${escapeHtml(galaxy.alienBase.threatHint)}${galaxy.alienBase.active ? "" : " · buildup"} · ${fmtCoords(galaxy.alienBase.coords)}</p>`
    : `<p class="hint" data-testid="galaxy-alien-empty">No alien base reported.</p>`;
  const deep = galaxy.deepSpace
    ? `<p class="hint" data-testid="galaxy-deep-space">Deep space ${fmtCoords(galaxy.deepSpace.coords)} — expedition target.</p>`
    : "";
  const maxTip = infoTooltip({
    title: "Send max expeditions",
    lines: [
      "Launches as many expeditions as free slots allow.",
      "Uses the Expedition fleet preset and ships in orbit on the selected colony.",
    ],
    requires: [
      "Expedition preset",
      "Free expedition slots",
      "Ships in orbit",
    ],
    testId: "galaxy-max-expeditions-tip",
  });
  const scanTip = infoTooltip({
    title: "Scan system",
    lines: [
      "Send Whisper Probes to every foreign-owned planet and moon in this system.",
      "Consumes probes from ships in orbit on the selected colony.",
    ],
    requires: ["Whisper Probe in orbit"],
    testId: "galaxy-scan-tip",
  });
  return `
    <section class="panel" data-testid="galaxy-panel">
      <h2>Galaxy</h2>
      <div class="galaxy-nav">
        <button type="button" data-galaxy-nav="prev" data-testid="galaxy-prev" ${busy ? "disabled" : ""}>◀ System</button>
        <span data-testid="galaxy-label">${galaxy.galaxy}:${galaxy.system} / ${MAP_SYSTEMS}</span>
        <button type="button" data-galaxy-nav="next" data-testid="galaxy-next" ${busy ? "disabled" : ""}>System ▶</button>
      </div>
      <div class="galaxy-actions" data-testid="galaxy-actions">
        <span class="galaxy-action">
          <button type="button" data-galaxy-max-expeditions data-testid="galaxy-max-expeditions" ${busy ? "disabled" : ""} title="${maxTip.title}">Send max expeditions</button>
          ${maxTip.html}
        </span>
        <span class="galaxy-action">
          <button type="button" data-galaxy-scan-system data-testid="galaxy-scan-system" ${busy ? "disabled" : ""} title="${scanTip.title}">Scan system (probes)</button>
          ${scanTip.html}
        </span>
      </div>
      <p class="hint">Send max uses the Expedition preset and fills free expedition slots from ships in orbit on the selected colony. Scan probes every foreign-owned planet/moon in this system.</p>
      ${markerTools}
      <ul class="roster galaxy-slots" data-testid="galaxy-slots">${rows}</ul>
      ${
        galaxy.minis.length > 0
          ? `<h3 class="subhead">Mini planets</h3>
      <ul class="roster galaxy-slots" data-testid="galaxy-minis">${galaxy.minis
        .map((mini) => {
          const debris = mini.debris
            ? ` · debris ${fmt(mini.debris.metal)}/${fmt(mini.debris.crystal)}`
            : "";
          const who = mini.playerName
            ? `${escapeHtml(mini.playerName)}${mini.isOwn ? " (you)" : ""}`
            : escapeHtml(mini.name);
          return `<li data-testid="galaxy-mini-${escapeAttr(mini.planetId)}" data-art-id="${escapeAttr(mini.artId)}"><span class="galaxy-slot-main">${planetDiscHtml({ src: mini.artThumbUrl, artId: mini.artId, size: 40, testId: `galaxy-mini-art-${mini.planetId}` })}<span class="galaxy-slot-label">Mini ${fmt(mini.coords.slot)}. ${who}${debris}</span></span><span class="galaxy-slot-coords">${fmtCoords(mini.coords)}</span></li>`;
        })
        .join("")}</ul>`
          : ""
      }
      <h3 class="subhead">Deep space</h3>
      ${deep}
      <h3 class="subhead">Asteroids</h3>
      ${asteroids}
      <h3 class="subhead">Pirates</h3>
      ${pirate}
      <h3 class="subhead">Aliens</h3>
      ${alien}
      <p class="hint">Use Fleet → Colonize / Harvest / Expedition with coords from this view.</p>
    </section>
  `;
}
