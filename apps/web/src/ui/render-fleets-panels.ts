import {
  MAP_SYSTEMS,
  SHIP_ORDER,
  SHIPS,
  type PlayerView,
} from "@starhold/game";
import { SHIP_ART } from "./assets";
import { fmt, fmtCoords, fmtEta, remainingSeconds } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

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
            .map((id) => `${f.ships[id]}× ${SHIPS[id].name}`)
            .join(", ");
          const eta = fmtEta(remainingSeconds(f.arrivesAt, now));
          const phase =
            f.phase === "outbound"
              ? `→ ${escapeHtml(nameFor(f.targetPlayerId))} @ ${fmtCoords(f.targetCoords)} (${f.mission})`
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
          const debris =
            (r.debrisCreated?.metal ?? 0) + (r.debrisCreated?.crystal ?? 0) > 0
              ? ` · debris ${fmt(r.debrisCreated.metal)}/${fmt(r.debrisCreated.crystal)}`
              : "";
          const moon = r.moonFormed ? " · moon formed" : "";
          return `<li data-testid="report-${r.id}"><strong>${role}: ${escapeHtml(r.outcome)}</strong>${typeof r.rounds === "number" ? ` · ${r.rounds}r` : ""} vs ${escapeHtml(r.attackerPlayerId === selfId ? r.defenderName : r.attackerName)} @ ${fmtCoords(r.targetCoords)}${loot}${debris}${moon}<br/><span class="meta">${escapeHtml(r.summary)}</span></li>`;
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
            .map((id) => `${f.ships[id]}× ${SHIPS[id].name}`)
            .join(", ");
          return `<li data-testid="sensor-${f.id}"><span>${escapeHtml(nameFor(f.ownerPlayerId))} ${escapeHtml(f.mission)} → ${fmtCoords(f.targetCoords)}<br/><span class="meta">${escapeHtml(ships)}</span></span><span>${fmtEta(remainingSeconds(f.arrivesAt, now))}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

export function spyReportsHtml(reports: PlayerView["spyReports"]): string {
  if (!reports?.length) {
    return `<p class="hint">No espionage reports yet.</p>`;
  }
  return `
    <h3 class="subhead">Espionage reports</h3>
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
              .map((id) => `${r.ships![id]}×${SHIPS[id].name}`)
              .join(", ");
            if (ships) bits.push(ships);
          }
          return `<li data-testid="spy-${r.id}"><strong>Spy L${r.detail}</strong> ${escapeHtml(r.targetName)} @ ${fmtCoords(r.targetCoords)}<br/><span class="meta">${escapeHtml(r.summary)}${bits.length ? ` · ${escapeHtml(bits.join(" · "))}` : ""}</span></li>`;
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
  const rows = galaxy.slots
    .map((s) => {
      const debris = s.debris
        ? ` · debris ${fmt(s.debris.metal)}/${fmt(s.debris.crystal)}`
        : "";
      const moon = s.hasMoon ? " · Moon" : "";
      const who = s.playerName
        ? `${escapeHtml(s.playerName)}${s.isOwn ? " (you)" : ""} · ~${s.pointsHint} pts${moon}`
        : "Empty";
      return `<li data-testid="galaxy-slot-${s.coords.slot}"><span>${s.coords.slot}. ${who}${debris}</span><span>${fmtCoords(s.coords)}</span></li>`;
    })
    .join("");
  return `
    <section class="panel" data-testid="galaxy-panel">
      <h2>Galaxy</h2>
      <div class="galaxy-nav">
        <button type="button" data-galaxy-nav="prev" data-testid="galaxy-prev" ${busy ? "disabled" : ""}>◀ System</button>
        <span data-testid="galaxy-label">${galaxy.galaxy}:${galaxy.system} / ${MAP_SYSTEMS}</span>
        <button type="button" data-galaxy-nav="next" data-testid="galaxy-next" ${busy ? "disabled" : ""}>System ▶</button>
      </div>
      <ul class="roster" data-testid="galaxy-slots">${rows}</ul>
      <p class="hint">Use Fleets → Colonize / Harvest with coords from this system view.</p>
    </section>
  `;
}
