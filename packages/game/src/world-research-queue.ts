import { RESEARCH } from "./catalog.js";
import {
  canAfford,
  levelBonuses,
  researchUpgradeCost,
  researchUpgradeSeconds,
  spend,
} from "./formulas.js";
import type { ResearchId, UniverseState } from "./types.js";
import { activePlanet, bestLabLevel } from "./world-bootstrap.js";
import { advanceUniverse } from "./world-arrival.js";
import type { ActionResult } from "./world-queues.js";
import { playerBoosts } from "./world-boosts.js";

export function queueResearch(
  universe: UniverseState,
  playerId: string,
  researchId: ResearchId,
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = RESEARCH[researchId];
  if (!def) return { ok: false, error: "Unknown research." };

  advanceUniverse(universe, now);
  if (player.researchQueue) {
    return { ok: false, error: "Research is already in progress." };
  }

  const lab = bestLabLevel(universe, player);
  if (lab < def.labLevel) {
    return {
      ok: false,
      error: `Needs Research Lab level ${def.labLevel} (best lab ${lab}).`,
    };
  }

  // Spend from active planet.
  const planet = activePlanet(universe, player);
  if (!planet) return { ok: false, error: "Planet missing." };

  const current = player.research[researchId] ?? 0;
  // Soft gate: research level cannot exceed lab level.
  if (current + 1 > lab) {
    return {
      ok: false,
      error: `Lab level ${lab} can only research up to level ${lab}.`,
    };
  }

  const cost = researchUpgradeCost(researchId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources on active planet." };
  }

  const researchSpeed = playerBoosts(player, now).researchSpeed;
  const lb = levelBonuses(player.level ?? 1);
  // Stack: base → lab → level → officers/skills researchSpeed.
  const seconds = Math.max(
    1,
    Math.ceil(
      (researchUpgradeSeconds(researchId, current, lab) * lb.researchTime) /
        universe.speed /
        Math.max(0.01, researchSpeed),
    ),
  );

  planet.resources = spend(planet.resources, cost);
  player.researchQueue = {
    kind: "research",
    researchId,
    targetLevel: current + 1,
    completesAt: now + seconds * 1000,
  };
  universe.planets[planet.id] = planet;
  universe.players[player.id] = player;
  return { ok: true, planet };
}
