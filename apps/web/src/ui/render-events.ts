import {
  FLEET_SAVE_MIN_LEAD_MS,
  type FleetMission,
  type FleetSaveSuggestion,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCompact, fmtCoords, fmtCoordsLink, fmtEta, remainingSeconds } from "./format";
import { isFleetSaveDismissed } from "./fleet-save-dismiss";
import { escapeAttr, escapeHtml } from "./render-escape";
import { bossDamageCallout, formatBossCountdown } from "./render-seasons";

export interface EventPresentation {
  className: "event-outgoing" | "event-returning" | "event-hostile";
  label: "Outgoing" | "Returning" | "Hostile incoming";
}

export function eventPresentation(
  fleet: FleetMission,
  hostile: boolean,
): EventPresentation {
  if (hostile) return { className: "event-hostile", label: "Hostile incoming" };
  if (fleet.phase === "returning") {
    return { className: "event-returning", label: "Returning" };
  }
  return { className: "event-outgoing", label: "Outgoing" };
}

export function formatEventCountdown(arrivesAt: number, now: number): string {
  return fmtEta(remainingSeconds(arrivesAt, now));
}

function missionLabel(mission: string): string {
  if (mission === "occupy") return "Occupation";
  return mission
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function eventRows(view: PlayerView): Array<{ fleet: FleetMission; hostile: boolean }> {
  return [
    ...view.fleets
      .filter((fleet) => fleet.ownerPlayerId === view.player.id)
      .map((fleet) => ({ fleet, hostile: false })),
    ...view.hostileInbound.map((fleet) => ({ fleet, hostile: true })),
  ].sort((a, b) => a.fleet.arrivesAt - b.fleet.arrivesAt);
}

function originCoords(
  view: PlayerView,
  fleet: FleetMission,
  hostile: boolean,
): string {
  const owned = view.ownedPlanets.find((planet) => planet.id === fleet.originPlanetId);
  if (owned) return fmtCoords(owned.coords);
  if (hostile) {
    const player = view.roster.find(
      (entry) => entry.planetId === fleet.originPlanetId,
    );
    if (player) return fmtCoords(player.coords);
  }
  return "—";
}

function fleetSaveFor(
  view: PlayerView,
  fleet: FleetMission,
  hostile: boolean,
  now: number,
): FleetSaveSuggestion | null {
  if (!hostile) return null;
  const suggestion = (view.fleetSave ?? []).find((row) => row.attackId === fleet.id);
  if (!suggestion) return null;
  if (suggestion.arrivesAt - now <= FLEET_SAVE_MIN_LEAD_MS) return null;
  if (isFleetSaveDismissed(suggestion.attackId)) return null;
  return suggestion;
}

function fleetSaveNote(suggestion: FleetSaveSuggestion): string {
  const id = escapeAttr(suggestion.attackId);
  switch (suggestion.mission) {
    case "expedition":
      return `<span class="hint" data-testid="fleet-save-note-${id}">Expedition. Expeditions can meet ambushes.</span>`;
    case "deploy":
      return "";
    default: {
      const unexpected: never = suggestion.mission;
      return unexpected;
    }
  }
}

function fleetSaveControls(suggestion: FleetSaveSuggestion | null): string {
  if (!suggestion) return "";
  const id = escapeAttr(suggestion.attackId);
  return `<span class="event-fleet-save"><button type="button" data-fleet-save="${id}" data-testid="fleet-save-${id}">Send fleet away</button>${fleetSaveNote(suggestion)}<button type="button" class="ghost" data-fleet-save-dismiss="${id}" data-testid="fleet-save-dismiss-${id}" aria-label="Dismiss send fleet away">Dismiss</button></span>`;
}

function renderCoordLink(c: { galaxy: number; system: number; slot: number } | string): string {
  if (typeof c === "string") return escapeHtml(c);
  const formatted = fmtCoords(c);
  return `<a href="/galaxy?galaxy=${c.galaxy}&amp;system=${c.system}" class="coord-link" data-galaxy-coords="${formatted}">${formatted}</a>`;
}

/** Compact boss status for the fleet-events strip. Empty when no boss is tracked. */
export function pirateBossEventCard(view: PlayerView, now = view.now): string {
  const boss = view.pirateBoss;
  if (!boss) return "";
  const active = boss.activeUntil != null;
  const until = active ? boss.activeUntil : boss.nextSpawnAt;
  const when =
    until == null
      ? ""
      : active
        ? ` · ends in ${formatBossCountdown(until, now)}`
        : ` · next spawn ${formatBossCountdown(until, now)}`;
  const rank = boss.myRank == null ? "unranked" : `#${fmt(boss.myRank)}`;
  const flavor = boss.flavorTitle ? ` · ${escapeHtml(boss.flavorTitle)}` : "";
  const next =
    active && boss.projectedSpawnAt != null
      ? `<p class="hint" data-testid="pirate-boss-event-next">Next spawn ${formatBossCountdown(boss.projectedSpawnAt, now)}</p>`
      : "";
  return `<section class="pirate-boss-card" data-testid="pirate-boss-event-card" aria-label="Seasonal pirate boss"><p><strong>Pirate mothership</strong>${flavor} · ${active ? "Active" : "Cooldown"}${when} · ${fmtCoordsLink(boss.coords)} · ${fmt(boss.hpPct)}% hull</p><p class="hint" data-testid="pirate-boss-event-me">You ${fmtCompact(boss.myDamage)} · ${rank}</p>${next}${bossDamageCallout(view)}</section>`;
}

export function eventsBannerHtml(view: PlayerView, now = Date.now()): string {
  const card = pirateBossEventCard(view, now);
  const rows = eventRows(view);
  if (rows.length === 0) return card;

  const renderRow = ({ fleet, hostile }: { fleet: FleetMission; hostile: boolean }, isSoonest = false) => {
    const presentation = eventPresentation(fleet, hostile);
    const fromStr = originCoords(view, fleet, hostile);
    const toStr = fleet.mission === "jump" ? "—" : fmtCoords(fleet.targetCoords);
    const returning = !hostile && fleet.phase === "returning";

    const originC = view.ownedPlanets.find((planet) => planet.id === fleet.originPlanetId)?.coords ?? (hostile ? view.roster.find((entry) => entry.planetId === fleet.originPlanetId)?.coords : null);
    const targetC = fleet.mission === "jump" ? "—" : fleet.targetCoords;

    const routeFrom = returning ? (targetC === "—" ? "—" : renderCoordLink(targetC)) : (originC ? renderCoordLink(originC) : escapeHtml(fromStr));
    const routeTo = returning ? (originC ? renderCoordLink(originC) : escapeHtml(fromStr)) : (targetC === "—" ? "—" : renderCoordLink(targetC));

    const arrival = new Date(fleet.arrivesAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const id = escapeHtml(`${hostile ? "hostile-" : ""}${fleet.id}`);
    const testid = isSoonest ? ' data-testid="event-soonest"' : "";
    const tag = isSoonest ? "div" : "li";
    const missionCls = fleet.mission === "occupy" ? " mission-occupy" : "";
    const recall =
      !hostile && fleet.phase === "outbound"
        ? `<button type="button" class="event-recall" data-recall-fleet="${escapeAttr(fleet.id)}" data-testid="recall-fleet">Recall</button>`
        : "";
    const save = fleetSaveControls(fleetSaveFor(view, fleet, hostile, now));

    return `<${tag} class="event-row ${presentation.className}${missionCls}" data-event-id="${id}" data-event-arrives-at="${fleet.arrivesAt}"${testid}><span class="event-kind">${presentation.label}</span><span class="event-route"><span class="${fleet.mission === "occupy" ? "mission-occupy" : ""}">${escapeHtml(missionLabel(fleet.mission))}</span> · ${routeFrom} → ${routeTo}</span><span class="event-arrival"><time>${escapeHtml(arrival)}</time> · <span data-event-countdown>${formatEventCountdown(fleet.arrivesAt, now)}</span></span>${recall}${save}</${tag}>`;
  };

  const soonestHtml = renderRow(rows[0]!, true);
  const remainingRows = rows.slice(1);
  const remainingHtml = remainingRows.length > 0
    ? `<ul class="events-dropdown-list" data-testid="events-dropdown-list">${remainingRows.map((r) => renderRow(r, false)).join("")}</ul>`
    : `<ul class="events-dropdown-list" data-testid="events-dropdown-list"></ul>`;

  return card + `<section class="events-banner" aria-label="Fleet events" data-testid="events-banner"><details class="events-dropdown" data-testid="events-dropdown"><summary class="events-dropdown-summary" data-testid="events-dropdown-summary"><h2>Fleet events (${rows.length})</h2>${soonestHtml}</summary>${remainingHtml}</details></section>`;
}

let timer: number | undefined;
let refreshEvents: (() => void) | undefined;
const refreshedArrivals = new Set<string>();

export function startEventsCountdown(
  view: PlayerView,
  onRefresh: () => void,
): void {
  refreshEvents = onRefresh;
  if (eventRows(view).length === 0) {
    stopEventsCountdown();
    return;
  }
  if (timer !== undefined) return;
  timer = window.setInterval(() => {
    const now = Date.now();
    document
      .querySelectorAll<HTMLElement>("[data-event-arrives-at]")
      .forEach((row) => {
        const arrivesAt = Number(row.dataset.eventArrivesAt);
        if (!Number.isFinite(arrivesAt)) return;
        const countdown = row.querySelector<HTMLElement>("[data-event-countdown]");
        if (countdown) {
          countdown.textContent = formatEventCountdown(arrivesAt, now);
        }
        if (now < arrivesAt) return;
        const key = `${row.dataset.eventId ?? ""}:${arrivesAt}`;
        if (refreshedArrivals.has(key)) return;
        refreshedArrivals.add(key);
        refreshEvents?.();
      });
  }, 1000);
}

export function stopEventsCountdown(): void {
  if (timer !== undefined) {
    if (typeof window !== "undefined") window.clearInterval(timer);
    timer = undefined;
  }
  refreshEvents = undefined;
}

let watchedPlayerId: string | null = null;
const seenFleetIds = new Set<string>();

export function watchFleetLaunches(
  view: PlayerView,
  onRefresh: () => void,
): void {
  if (watchedPlayerId !== view.player.id) {
    watchedPlayerId = view.player.id;
    seenFleetIds.clear();
    for (const fleet of view.fleets) seenFleetIds.add(fleet.id);
    return;
  }
  let launched = false;
  for (const fleet of view.fleets) {
    if (fleet.ownerPlayerId !== view.player.id || seenFleetIds.has(fleet.id)) {
      continue;
    }
    seenFleetIds.add(fleet.id);
    launched = true;
  }
  if (launched) onRefresh();
}
