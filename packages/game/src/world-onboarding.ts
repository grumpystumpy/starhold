import { SHIP_ORDER } from "./catalog.js";
import { GOALS, ONBOARDING_STEPS } from "./data/tuning.js";
import { nextGoalSuggestionFor } from "./next-goal.js";
import type {
  OnboardingView,
  PlanetState,
  PlayerState,
  UniverseState,
} from "./types.js";
import { grantStarshards, storageForPlanet } from "./world-boosts.js";
import { addCargoToPlanet } from "./world-tick.js";

export type OnboardingActionResult =
  | { ok: true; stepId: string }
  | { ok: false; error: string };

type OnboardingResult = OnboardingActionResult;

function ownedPlanets(
  universe: UniverseState,
  player: PlayerState,
): PlanetState[] {
  const out: PlanetState[] = [];
  for (const id of player.planetIds) {
    const planet = universe.planets[id];
    if (planet) out.push(planet);
  }
  return out;
}

function buildingAtLeast(
  planets: PlanetState[],
  buildingId: "metalMine" | "crystalMine" | "solarPlant" | "deutSynth" | "researchLab" | "shipyard",
  level: number,
): boolean {
  return planets.some((planet) => (planet.buildings[buildingId] ?? 0) >= level);
}

function shipCount(
  ships: Partial<Record<string, number>> | undefined,
  shipId?: string,
): number {
  if (!ships) return 0;
  if (shipId) return Math.max(0, Math.floor(ships[shipId] ?? 0));
  let total = 0;
  for (const id of SHIP_ORDER) total += Math.max(0, Math.floor(ships[id] ?? 0));
  return total;
}

function ownsAnyShip(universe: UniverseState, player: PlayerState): boolean {
  for (const planet of ownedPlanets(universe, player)) {
    if (shipCount(planet.ships) >= 1) return true;
  }
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.ownerPlayerId !== player.id) continue;
    if (shipCount(fleet.ships) >= 1) return true;
  }
  return false;
}

function ownsShip(
  universe: UniverseState,
  player: PlayerState,
  shipId: string,
): boolean {
  for (const planet of ownedPlanets(universe, player)) {
    if (shipCount(planet.ships, shipId) >= 1) return true;
  }
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.ownerPlayerId !== player.id) continue;
    if (shipCount(fleet.ships, shipId) >= 1) return true;
  }
  return false;
}

function anyResearchLevel(player: PlayerState): boolean {
  return Object.values(player.research ?? {}).some((level) => (level ?? 0) >= 1);
}

function expeditionNoted(player: PlayerState): boolean {
  const progress = player.goals?.progress ?? {};
  return GOALS.some(
    (goal) => goal.metric === "expedition" && Math.floor(progress[goal.id] ?? 0) >= 1,
  );
}

function hasReconReport(universe: UniverseState, playerId: string): boolean {
  for (const report of Object.values(universe.spyReports)) {
    if (report.spyPlayerId === playerId) return true;
  }
  for (const report of Object.values(universe.expeditionReports ?? {})) {
    if (report.playerId === playerId) return true;
  }
  return false;
}

function reconComplete(universe: UniverseState, player: PlayerState): boolean {
  if (player.onboarding?.recon) return true;
  if (ownsShip(universe, player, "probe")) return true;
  if (expeditionNoted(player)) return true;
  return hasReconReport(universe, player.id);
}

function colonyReady(planets: PlanetState[]): boolean {
  return planets.some(
    (planet) =>
      (planet.buildings.metalMine ?? 0) >= 4 &&
      (planet.buildings.crystalMine ?? 0) >= 3 &&
      (planet.buildings.solarPlant ?? 0) >= 3,
  );
}

function stepComplete(
  universe: UniverseState,
  player: PlayerState,
  stepId: string,
): boolean {
  const planets = ownedPlanets(universe, player);
  switch (stepId) {
    case "metalMine1":
      return buildingAtLeast(planets, "metalMine", 1);
    case "solarPlant1":
      return buildingAtLeast(planets, "solarPlant", 1);
    case "crystalMine1":
      return buildingAtLeast(planets, "crystalMine", 1);
    case "deutSynth1":
      return buildingAtLeast(planets, "deutSynth", 1);
    case "researchLab1":
      return buildingAtLeast(planets, "researchLab", 1) && anyResearchLevel(player);
    case "shipyardScout1":
      return buildingAtLeast(planets, "shipyard", 1) && ownsAnyShip(universe, player);
    case "firstReconOrExpedition":
      return reconComplete(universe, player);
    case "colonyFoundation":
      return colonyReady(planets);
    default:
      return false;
  }
}

/** Mark recon done without touching claims. Safe to call more than once. */
export function noteOnboardingRecon(player: PlayerState): void {
  if (player.onboarding?.recon) return;
  player.onboarding = { ...(player.onboarding ?? {}), recon: true };
}

/** Live checklist. Does not write `player.onboarding`. */
export function onboardingViewFor(
  universe: UniverseState,
  player: PlayerState,
): OnboardingView {
  const claimed = new Set(player.onboarding?.claimed ?? []);
  const steps = ONBOARDING_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    targetNavPage: step.targetNavPage,
    completed: stepComplete(universe, player, step.id),
    claimed: claimed.has(step.id),
    reward: {
      starshards: step.starshards,
      metal: step.metal,
      crystal: step.crystal,
      deuterium: step.deuterium,
    },
  }));
  const completedCount = steps.reduce((n, step) => n + (step.completed ? 1 : 0), 0);
  return {
    steps,
    dismissed: Boolean(player.onboarding?.dismissed),
    allClaimed: steps.length > 0 && steps.every((step) => step.claimed),
    completedCount,
    suggestion: nextGoalSuggestionFor(universe, player),
  };
}

function activePlanet(universe: UniverseState, player: PlayerState): PlanetState | null {
  return (
    universe.planets[player.activePlanetId] ??
    universe.planets[player.homePlanetId] ??
    null
  );
}

/**
 * Claim one finished tutorial step. Any completed step can be claimed
 * in any order. A full vault is clamped to remaining storage and the
 * step still counts as claimed.
 */
export function claimOnboardingStep(
  universe: UniverseState,
  playerId: string,
  stepId: string,
  now = Date.now(),
): OnboardingResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const step = ONBOARDING_STEPS.find((row) => row.id === stepId);
  if (!step) return { ok: false, error: "Unknown onboarding step." };
  const already = player.onboarding?.claimed ?? [];
  if (already.includes(step.id)) {
    return { ok: false, error: "Onboarding step already claimed." };
  }
  if (!stepComplete(universe, player, step.id)) {
    return { ok: false, error: "Onboarding step is not complete." };
  }

  const paysResources = step.metal > 0 || step.crystal > 0 || step.deuterium > 0;
  const planet = paysResources ? activePlanet(universe, player) : null;
  if (paysResources && !planet) return { ok: false, error: "Planet missing." };

  if (step.starshards > 0) grantStarshards(player, step.starshards);
  if (paysResources && planet) {
    const caps = storageForPlanet(universe, planet, now);
    addCargoToPlanet(universe, planet, {
      metal: Math.max(0, Math.min(step.metal, caps.metal - planet.resources.metal)),
      crystal: Math.max(0, Math.min(step.crystal, caps.crystal - planet.resources.crystal)),
      deuterium: Math.max(0, Math.min(step.deuterium, caps.deuterium - planet.resources.deuterium)),
    }, now);
    universe.planets[planet.id] = planet;
  }

  player.onboarding = {
    ...(player.onboarding ?? {}),
    claimed: [...already, step.id],
  };
  universe.players[player.id] = player;
  return { ok: true, stepId: step.id };
}

export function setOnboardingDismissed(
  universe: UniverseState,
  playerId: string,
  dismissed: boolean,
): OnboardingResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  player.onboarding = {
    ...(player.onboarding ?? {}),
    dismissed: Boolean(dismissed),
  };
  universe.players[player.id] = player;
  return { ok: true, stepId: dismissed ? "dismissed" : "restored" };
}
