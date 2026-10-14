import { RESEARCH } from "./catalog.js";
import {
  astrolabeResearchTimeMult,
  canAfford,
  classBonuses,
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
import { researchQueueCap } from "./world-queue-caps.js";
import {
  ensureQueueFrontStarted,
  newQueueItemId,
} from "./world-queue-normalize.js";
import { empireRelicResearchTimeFactor } from "./world-mini.js";

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
  const cap = researchQueueCap(player, now);
  if (player.researchQueue.length >= cap) {
    return {
      ok: false,
      error: `Research queue is full (${player.researchQueue.length}/${cap}).`,
    };
  }

  const lab = bestLabLevel(universe, player);
  if (lab < def.labLevel) {
    return {
      ok: false,
      error: `Needs Research Lab level ${def.labLevel} (best lab ${lab}).`,
    };
  }

  const planet = activePlanet(universe, player);
  if (!planet) return { ok: false, error: "Planet missing." };

  const pendingSame = player.researchQueue.filter(
    (q) => q.researchId === researchId,
  ).length;
  const current = (player.research[researchId] ?? 0) + pendingSame;
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
  const cls = classBonuses(player.playerClass?.classId);
  const astrolabe = astrolabeResearchTimeMult(universe, player.id);
  const relic = empireRelicResearchTimeFactor(universe, player.id);
  // Stack: base → lab → level → officers/skills → class → Astrolabe → Relic.
  const seconds = Math.max(
    1,
    Math.ceil(
      (researchUpgradeSeconds(researchId, current, lab) *
        lb.researchTime *
        cls.researchTime *
        astrolabe *
        relic) /
        universe.speed /
        Math.max(0.01, researchSpeed),
    ),
  );

  planet.resources = spend(planet.resources, cost);
  const startNow = player.researchQueue.length === 0;
  player.researchQueue.push({
    id: newQueueItemId(now),
    kind: "research",
    researchId,
    targetLevel: current + 1,
    enqueuedAt: now,
    workSeconds: seconds,
    startedAt: startNow ? now : null,
    completesAt: startNow ? now + seconds * 1000 : now + seconds * 1000,
    paidCost: { ...cost },
  });
  ensureQueueFrontStarted(player.researchQueue, now);
  universe.planets[planet.id] = planet;
  universe.players[player.id] = player;
  return { ok: true, planet };
}
