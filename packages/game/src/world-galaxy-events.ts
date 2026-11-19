import { MAP_GALAXIES } from "./catalog.js";
import {
  GALAXY_EVENT_DURATION_MS,
  GALAXY_EVENT_METEOR_DEBRIS_MULT,
  GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT,
  GALAXY_EVENTS_PER_WEEK,
} from "./data/tuning.js";
import { hashSeed } from "./formulas-position.js";
import type { Coordinates, UniverseState } from "./types.js";
import type {
  GalaxyEventState,
  GalaxyEventType,
  GalaxyEventView,
} from "./types-view.js";

const WEEK_MS = 7 * GALAXY_EVENT_DURATION_MS;
const EVENT_TYPES: GalaxyEventType[] = ["meteor_shower", "solar_flare"];

const EVENT_LABEL: Record<GalaxyEventType, string> = {
  meteor_shower: "Meteor shower",
  solar_flare: "Solar flare",
};

function eventSeed(universe: UniverseState): string {
  return universe.seed || universe.id || "starhold";
}

function weekIndex(now: number): number {
  return Math.floor(now / WEEK_MS);
}

function slotMs(): number {
  return Math.floor(WEEK_MS / GALAXY_EVENTS_PER_WEEK);
}

/** The scheduled window that contains `now`, or null in the gap between events. */
export function scheduledGalaxyEvent(
  universe: UniverseState,
  now: number,
): GalaxyEventState | null {
  if (!Number.isFinite(now)) return null;
  const week = weekIndex(now);
  const slot = slotMs();
  const offset = now - week * WEEK_MS;
  const index = Math.floor(offset / slot);
  if (index < 0 || index >= GALAXY_EVENTS_PER_WEEK) return null;
  const startsAt = week * WEEK_MS + index * slot;
  const endsAt = startsAt + GALAXY_EVENT_DURATION_MS;
  if (now < startsAt || now >= endsAt) return null;
  const seed = eventSeed(universe);
  const galaxy =
    (hashSeed(`${seed}:galaxy-event:g:${week}:${index}`) % MAP_GALAXIES) + 1;
  const type =
    EVENT_TYPES[
      hashSeed(`${seed}:galaxy-event:t:${week}:${index}`) % EVENT_TYPES.length
    ]!;
  return { type, galaxy, startsAt, endsAt };
}

function inWindow(event: GalaxyEventState, now: number): boolean {
  return now >= event.startsAt && now < event.endsAt;
}

/** Stored event if its window still covers `now`. */
export function activeGalaxyEvent(
  universe: UniverseState,
  now: number,
): GalaxyEventState | undefined {
  const event = universe.galaxyEvent;
  if (!event || !inWindow(event, now)) return undefined;
  if (event.type !== "meteor_shower" && event.type !== "solar_flare") {
    return undefined;
  }
  return event;
}

/**
 * Keep the current window as-is. Roll or clear only when `now` leaves it.
 * O(1): no universe scan. Called from `advanceUniverse`.
 */
export function tickGalaxyEvents(universe: UniverseState, now: number): void {
  const current = universe.galaxyEvent;
  if (current && inWindow(current, now)) return;
  const next = scheduledGalaxyEvent(universe, now);
  if (!next) {
    if (current) universe.galaxyEvent = undefined;
    return;
  }
  universe.galaxyEvent = next;
}

export function galaxyEventDebrisMult(
  universe: UniverseState,
  coords: Coordinates,
  now: number,
): number {
  const event = activeGalaxyEvent(universe, now);
  if (!event || event.type !== "meteor_shower" || event.galaxy !== coords.galaxy) {
    return 1;
  }
  return GALAXY_EVENT_METEOR_DEBRIS_MULT;
}

export function galaxyEventShieldMult(
  universe: UniverseState,
  coords: Coordinates,
  now: number,
): number {
  const event = activeGalaxyEvent(universe, now);
  if (!event || event.type !== "solar_flare" || event.galaxy !== coords.galaxy) {
    return 1;
  }
  return GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT;
}

/** Fold the flare into mods that may already include alliance or boost shields. */
export function galaxyEventShieldMods(
  universe: UniverseState,
  coords: Coordinates,
  now: number,
  attackerShieldMult = 1,
  defenderShieldMult = 1,
): { attackerShieldMult: number; defenderShieldMult: number } {
  const mult = galaxyEventShieldMult(universe, coords, now);
  if (mult === 1) return { attackerShieldMult, defenderShieldMult };
  return {
    attackerShieldMult: attackerShieldMult * mult,
    defenderShieldMult: defenderShieldMult * mult,
  };
}

export function galaxyEventView(
  universe: UniverseState,
  now: number,
): GalaxyEventView | undefined {
  const event = activeGalaxyEvent(universe, now);
  if (!event) return undefined;
  return {
    type: event.type,
    galaxy: event.galaxy,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    label: EVENT_LABEL[event.type],
  };
}
