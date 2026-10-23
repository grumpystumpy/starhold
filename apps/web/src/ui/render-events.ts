import type { FleetMission, PlayerView } from "@starhold/game";
import { fmtCoords, fmtEta, remainingSeconds } from "./format";
import { escapeHtml } from "./render-escape";

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

export function eventsBannerHtml(view: PlayerView, now = Date.now()): string {
  const rows = eventRows(view);
  if (rows.length === 0) return "";
  return `<section class="events-banner" aria-label="Fleet events"><h2>Fleet events</h2><ul>${rows
    .map(({ fleet, hostile }) => {
      const presentation = eventPresentation(fleet, hostile);
      const from = originCoords(view, fleet, hostile);
      const to = fleet.mission === "jump" ? "—" : fmtCoords(fleet.targetCoords);
      const returning = !hostile && fleet.phase === "returning";
      const routeFrom = returning ? to : from;
      const routeTo = returning ? from : to;
      const arrival = new Date(fleet.arrivesAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      const id = escapeHtml(`${hostile ? "hostile-" : ""}${fleet.id}`);
      return `<li class="event-row ${presentation.className}" data-event-id="${id}" data-event-arrives-at="${fleet.arrivesAt}"><span class="event-kind">${presentation.label}</span><span class="event-route">${escapeHtml(missionLabel(fleet.mission))} · ${escapeHtml(routeFrom)} → ${escapeHtml(routeTo)}</span><span class="event-arrival"><time>${escapeHtml(arrival)}</time> · <span data-event-countdown>${formatEventCountdown(fleet.arrivesAt, now)}</span></span></li>`;
    })
    .join("")}</ul></section>`;
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
