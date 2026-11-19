import {
  MIDGAME_BRIEFING_CARDS,
  type MidgameCardId,
} from "./data/tuning.js";
import type {
  OnboardingNavPage,
  PlayerState,
  PlayerView,
  UniverseState,
} from "./types.js";
import { ownedPlanetCount } from "./world-moons.js";
import { onboardingViewFor } from "./world-onboarding.js";

export interface MidgameBriefingFacts {
  onboardingDismissed: boolean;
  onboardingAllClaimed: boolean;
  midgameBriefingDismissed?: boolean;
  /** Owned worlds that are not moons. Same count as the colony cap. */
  colonyCount: number;
  ownsMoon: boolean;
  sensorArrayLevel: number;
  jumpGateLevel: number;
}

export interface MidgameBriefingCard {
  id: MidgameCardId;
  title: string;
  unlocks: string;
  targetNavPage: OnboardingNavPage;
  /** Null on Joint Strike, which is an info card. */
  completed: boolean | null;
}

export type MidgameBriefingActionResult =
  | { ok: true }
  | { ok: false; error: string };

function cardComplete(
  id: MidgameCardId,
  facts: MidgameBriefingFacts,
): boolean | null {
  switch (id) {
    case "extraColony":
      return facts.colonyCount >= 2;
    case "firstMoon":
      return facts.ownsMoon;
    case "systemScanner":
      return facts.sensorArrayLevel >= 1;
    case "moonBridge":
      return facts.jumpGateLevel >= 1;
    case "jointStrike":
      return null;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/**
 * Milestone cards for Overview. Null until the commander briefing is
 * dismissed or every tutorial step is claimed, and null after this
 * guide is dismissed. Does not write the save.
 */
export function midgameBriefingCards(
  facts: MidgameBriefingFacts,
): MidgameBriefingCard[] | null {
  if (facts.midgameBriefingDismissed) return null;
  if (!facts.onboardingDismissed && !facts.onboardingAllClaimed) return null;
  return MIDGAME_BRIEFING_CARDS.map((card) => ({
    id: card.id,
    title: card.title,
    unlocks: card.unlocks,
    targetNavPage: card.targetNavPage,
    completed: cardComplete(card.id, facts),
  }));
}

function maxBuilding(
  universe: UniverseState,
  player: PlayerState,
  buildingId: "sensorArray" | "jumpGate",
): number {
  let max = 0;
  for (const id of player.planetIds) {
    const planet = universe.planets[id];
    if (!planet) continue;
    const level = planet.buildings[buildingId] ?? 0;
    if (level > max) max = level;
  }
  return max;
}

function ownsMoon(universe: UniverseState, player: PlayerState): boolean {
  for (const id of player.planetIds) {
    if (universe.planets[id]?.kind === "moon") return true;
  }
  return false;
}

/** Live cards from the universe. Does not write `player.midgameBriefingDismissed`. */
export function midgameBriefingFor(
  universe: UniverseState,
  player: PlayerState,
): MidgameBriefingCard[] | null {
  const onboarding = onboardingViewFor(universe, player);
  return midgameBriefingCards({
    onboardingDismissed: onboarding.dismissed,
    onboardingAllClaimed: onboarding.allClaimed,
    midgameBriefingDismissed: player.midgameBriefingDismissed,
    colonyCount: ownedPlanetCount(universe, player.id),
    ownsMoon: ownsMoon(universe, player),
    sensorArrayLevel: maxBuilding(universe, player, "sensorArray"),
    jumpGateLevel: maxBuilding(universe, player, "jumpGate"),
  });
}

/** Same cards as `midgameBriefingFor`, from fields already on a player view. */
export function midgameFactsFromView(
  view: Pick<PlayerView, "onboarding" | "player" | "planet" | "ownedPlanets">,
): MidgameBriefingFacts {
  const rows = view.ownedPlanets ?? [];
  let colonies = 0;
  let moon = false;
  let sensor = 0;
  let gate = 0;
  if (rows.length > 0) {
    for (const row of rows) {
      if (row.isMoon) moon = true;
      else colonies += 1;
      sensor = Math.max(sensor, row.sensorArrayLevel ?? 0);
      gate = Math.max(gate, row.jumpGateLevel ?? 0);
    }
  } else if (view.planet) {
    moon = view.planet.kind === "moon";
    colonies = moon || view.planet.flags?.mini ? 0 : 1;
  }
  sensor = Math.max(sensor, view.planet?.buildings.sensorArray ?? 0);
  gate = Math.max(gate, view.planet?.buildings.jumpGate ?? 0);
  return {
    onboardingDismissed: Boolean(view.onboarding?.dismissed),
    onboardingAllClaimed: Boolean(view.onboarding?.allClaimed),
    midgameBriefingDismissed: view.player.midgameBriefingDismissed,
    colonyCount: colonies,
    ownsMoon: moon,
    sensorArrayLevel: sensor,
    jumpGateLevel: gate,
  };
}

export function setMidgameBriefingDismissed(
  universe: UniverseState,
  playerId: string,
  dismissed: boolean,
): MidgameBriefingActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (dismissed) player.midgameBriefingDismissed = true;
  else delete player.midgameBriefingDismissed;
  universe.players[player.id] = player;
  return { ok: true };
}
