import {
  BUILDINGS,
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  CHRONO_LATHE_SHIPYARD_REQ,
  MANTLE_LOOM_LAB_REQ,
  MANTLE_LOOM_SOLAR_REQ,
  RESEARCH,
  RESEARCH_ORDER,
  RIG_FOUNDRY_SHIPYARD_REQ,
  SHIPS,
  SHIP_ORDER,
} from "./catalog.js";
import { buildingAllowedOn } from "./formulas-build.js";
import type {
  BuildingId,
  NextGoalSuggestion,
  PlanetState,
  PlayerState,
  ResearchId,
  ShipId,
  UniverseState,
} from "./types.js";

/**
 * Level-1 building gates from `previewBuildingUpgrade`.
 * System Scanner and Moon Bridge use Lunar Habitat 1, the same check
 * as that preview. Higher levels add no further prerequisites.
 */
const LUNAR_HABITAT_REQ = 1;

interface BuildingNeed {
  buildingId: BuildingId;
  level: number;
}

interface BuildingGate {
  id: BuildingId;
  needs: readonly BuildingNeed[];
}

const BUILDING_GATES: readonly BuildingGate[] = [
  { id: "sensorArray", needs: [{ buildingId: "lunarBase", level: LUNAR_HABITAT_REQ }] },
  { id: "jumpGate", needs: [{ buildingId: "lunarBase", level: LUNAR_HABITAT_REQ }] },
  {
    id: "rigFoundry",
    needs: [{ buildingId: "shipyard", level: RIG_FOUNDRY_SHIPYARD_REQ }],
  },
  {
    id: "mantleLoom",
    needs: [
      { buildingId: "solarPlant", level: MANTLE_LOOM_SOLAR_REQ },
      { buildingId: "researchLab", level: MANTLE_LOOM_LAB_REQ },
    ],
  },
  {
    id: "chronoLathe",
    needs: [
      { buildingId: "shipyard", level: CHRONO_LATHE_SHIPYARD_REQ },
      { buildingId: "rigFoundry", level: CHRONO_LATHE_RIG_FOUNDRY_REQ },
    ],
  },
];

interface ShortfallBase {
  gap: number;
  /** Lower sorts first when gaps tie. Lab is checked before research requires. */
  order: number;
  need: number;
  have: number;
}

type Shortfall =
  | (ShortfallBase & { kind: "research"; researchId: ResearchId })
  | (ShortfallBase & {
      kind: "building";
      buildingId: BuildingId;
      /** Empire best lab, or the building's own world. */
      haveScope: "empire" | "planet";
    });

interface Candidate {
  minGap: number;
  totalGap: number;
  /** Research, then gated buildings, then hulls. */
  order: number;
  suggestion: NextGoalSuggestion;
}

function ownedPlanets(universe: UniverseState, player: PlayerState): PlanetState[] {
  const out: PlanetState[] = [];
  for (const id of player.planetIds ?? []) {
    const planet = universe.planets[id];
    if (planet) out.push(planet);
  }
  return out;
}

function researchLevel(player: PlayerState, id: ResearchId): number {
  return Math.max(0, Math.floor(player.research?.[id] ?? 0));
}

function buildingLevel(planet: PlanetState, id: BuildingId): number {
  return Math.max(0, Math.floor(planet.buildings?.[id] ?? 0));
}

function bestLab(planets: PlanetState[]): number {
  let best = 0;
  for (const planet of planets) {
    best = Math.max(best, buildingLevel(planet, "researchLab"));
  }
  return best;
}

function bestShipyard(planets: PlanetState[]): number {
  let best = 0;
  for (const planet of planets) {
    best = Math.max(best, buildingLevel(planet, "shipyard"));
  }
  return best;
}

function researchSuggestion(id: ResearchId, rationale: string): NextGoalSuggestion {
  return {
    id: `research:${id}`,
    title: RESEARCH[id].name,
    rationale,
    targetNavPage: "research",
  };
}

function buildingSuggestion(id: BuildingId, rationale: string): NextGoalSuggestion {
  return {
    id: `building:${id}`,
    title: BUILDINGS[id].name,
    rationale,
    targetNavPage: "buildings",
  };
}

function summarize(shortfalls: Shortfall[]): { minGap: number; totalGap: number } {
  if (shortfalls.length === 0) return { minGap: 0, totalGap: 0 };
  let minGap = shortfalls[0]!.gap;
  let totalGap = 0;
  for (const row of shortfalls) {
    minGap = Math.min(minGap, row.gap);
    totalGap += row.gap;
  }
  return { minGap, totalGap };
}

function firstBlocker(shortfalls: Shortfall[]): Shortfall | null {
  if (shortfalls.length === 0) return null;
  const ranked = [...shortfalls].sort((a, b) => a.gap - b.gap || a.order - b.order);
  return ranked[0] ?? null;
}

function actionFor(targetName: string, blocker: Shortfall): NextGoalSuggestion {
  switch (blocker.kind) {
    case "research": {
      const name = RESEARCH[blocker.researchId].name;
      return researchSuggestion(
        blocker.researchId,
        `${targetName} needs ${name} level ${blocker.need} (you have ${blocker.have}).`,
      );
    }
    case "building": {
      const name = BUILDINGS[blocker.buildingId].name;
      const where =
        blocker.haveScope === "empire"
          ? `best lab ${blocker.have}`
          : `you have ${blocker.have}`;
      return buildingSuggestion(
        blocker.buildingId,
        `${targetName} needs ${name} level ${blocker.need} (${where}).`,
      );
    }
    default: {
      const _exhaustive: never = blocker;
      return _exhaustive;
    }
  }
}

function researchShortfalls(player: PlayerState, id: ResearchId, lab: number): Shortfall[] {
  const def = RESEARCH[id];
  const shortfalls: Shortfall[] = [];
  if (lab < def.labLevel) {
    shortfalls.push({
      gap: def.labLevel - lab,
      order: -1,
      kind: "building",
      buildingId: "researchLab",
      haveScope: "empire",
      need: def.labLevel,
      have: lab,
    });
  }
  for (let index = 0; index < RESEARCH_ORDER.length; index += 1) {
    const reqId = RESEARCH_ORDER[index]!;
    const need = def.requires?.[reqId];
    if (need == null) continue;
    const have = researchLevel(player, reqId);
    if (have < need) {
      shortfalls.push({
        gap: need - have,
        order: index,
        kind: "research",
        researchId: reqId,
        need,
        have,
      });
    }
  }
  return shortfalls;
}

function readyResearchRationale(
  id: ResearchId,
  player: PlayerState,
  lab: number,
): string {
  const def = RESEARCH[id];
  const parts = [
    def.description,
    `Research Lab level ${def.labLevel} is met (best lab ${lab}).`,
  ];
  for (const reqId of RESEARCH_ORDER) {
    const need = def.requires?.[reqId];
    if (need == null) continue;
    const have = researchLevel(player, reqId);
    parts.push(`${RESEARCH[reqId].name} level ${need} is met (you have ${have}).`);
  }
  return parts.join(" ");
}

function researchCandidates(player: PlayerState, lab: number): Candidate[] {
  const out: Candidate[] = [];
  for (let index = 0; index < RESEARCH_ORDER.length; index += 1) {
    const id = RESEARCH_ORDER[index]!;
    if (researchLevel(player, id) >= 1) continue;
    const shortfalls = researchShortfalls(player, id, lab);
    const { minGap, totalGap } = summarize(shortfalls);
    const blocker = firstBlocker(shortfalls);
    const suggestion = blocker
      ? actionFor(RESEARCH[id].name, blocker)
      : researchSuggestion(id, readyResearchRationale(id, player, lab));
    out.push({ minGap, totalGap, order: index, suggestion });
  }
  return out;
}

function buildingShortfalls(planet: PlanetState, needs: readonly BuildingNeed[]): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  for (let index = 0; index < needs.length; index += 1) {
    const need = needs[index]!;
    const have = buildingLevel(planet, need.buildingId);
    if (have < need.level) {
      shortfalls.push({
        gap: need.level - have,
        order: index,
        kind: "building",
        buildingId: need.buildingId,
        haveScope: "planet",
        need: need.level,
        have,
      });
    }
  }
  return shortfalls;
}

function readyBuildingRationale(planet: PlanetState, gate: BuildingGate): string {
  const parts = [BUILDINGS[gate.id].description];
  for (const need of gate.needs) {
    const have = buildingLevel(planet, need.buildingId);
    parts.push(
      `${BUILDINGS[need.buildingId].name} level ${need.level} is met (you have ${have}).`,
    );
  }
  return parts.join(" ");
}

function buildingCandidates(planets: PlanetState[]): Candidate[] {
  const out: Candidate[] = [];
  for (let index = 0; index < BUILDING_GATES.length; index += 1) {
    const gate = BUILDING_GATES[index]!;
    const eligible = planets.filter((planet) => buildingAllowedOn(planet, gate.id));
    if (eligible.length === 0) continue;
    if (eligible.some((planet) => buildingLevel(planet, gate.id) >= 1)) continue;

    let best: { minGap: number; totalGap: number; planet: PlanetState; shortfalls: Shortfall[] } | null =
      null;
    const ranked = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
    for (const planet of ranked) {
      const shortfalls = buildingShortfalls(planet, gate.needs);
      const score = summarize(shortfalls);
      if (
        !best ||
        score.minGap < best.minGap ||
        (score.minGap === best.minGap && score.totalGap < best.totalGap)
      ) {
        best = { ...score, planet, shortfalls };
      }
    }
    if (!best) continue;
    const blocker = firstBlocker(best.shortfalls);
    const suggestion = blocker
      ? actionFor(BUILDINGS[gate.id].name, blocker)
      : buildingSuggestion(gate.id, readyBuildingRationale(best.planet, gate));
    out.push({
      minGap: best.minGap,
      totalGap: best.totalGap,
      order: 1_000 + index,
      suggestion,
    });
  }
  return out;
}

function shipShortfalls(
  player: PlayerState,
  shipId: ShipId,
  yard: number,
): Shortfall[] {
  const ship = SHIPS[shipId];
  const shortfalls: Shortfall[] = [];
  const req = ship.researchReq ?? {};
  for (let index = 0; index < RESEARCH_ORDER.length; index += 1) {
    const reqId = RESEARCH_ORDER[index]!;
    const need = req[reqId];
    if (need == null) continue;
    const have = researchLevel(player, reqId);
    if (have < need) {
      shortfalls.push({
        gap: need - have,
        order: index,
        kind: "research",
        researchId: reqId,
        need,
        have,
      });
    }
  }
  if (yard < ship.shipyardLevel) {
    shortfalls.push({
      gap: ship.shipyardLevel - yard,
      order: 1_000,
      kind: "building",
      buildingId: "shipyard",
      haveScope: "planet",
      need: ship.shipyardLevel,
      have: yard,
    });
  }
  return shortfalls;
}

function shipCandidates(player: PlayerState, yard: number): Candidate[] {
  const out: Candidate[] = [];
  for (let index = 0; index < SHIP_ORDER.length; index += 1) {
    const id = SHIP_ORDER[index]!;
    const ship = SHIPS[id];
    if (!ship?.researchReq || Object.keys(ship.researchReq).length === 0) continue;
    const shortfalls = shipShortfalls(player, id, yard);
    if (shortfalls.length === 0) continue;
    const { minGap, totalGap } = summarize(shortfalls);
    const blocker = firstBlocker(shortfalls);
    if (!blocker) continue;
    out.push({
      minGap,
      totalGap,
      order: 2_000 + index,
      suggestion: actionFor(ship.name, blocker),
    });
  }
  return out;
}

function pick(candidates: Candidate[]): NextGoalSuggestion | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(
    (a, b) => a.minGap - b.minGap || a.totalGap - b.totalGap || a.order - b.order,
  );
  return ranked[0]?.suggestion ?? null;
}

/**
 * One optional next step from the commander's buildings and research.
 * Reads catalog prerequisites only. Does not write the save, pay a
 * reward, or change claims.
 */
export function nextGoalSuggestionFor(
  universe: UniverseState,
  player: PlayerState,
): NextGoalSuggestion | null {
  const planets = ownedPlanets(universe, player);
  const lab = bestLab(planets);
  const yard = bestShipyard(planets);
  return pick([
    ...researchCandidates(player, lab),
    ...buildingCandidates(planets),
    ...shipCandidates(player, yard),
  ]);
}
