import {
  BUILDINGS,
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  CHRONO_LATHE_SHIPYARD_REQ,
  MANTLE_LOOM_LAB_REQ,
  MANTLE_LOOM_SOLAR_REQ,
  MOON_FIELDS_BASE,
  MOON_FIELDS_PER_LUNAR_BASE,
  RESEARCH,
  RESEARCH_ORDER,
  RIG_FOUNDRY_SHIPYARD_REQ,
} from "./catalog.js";
import {
  buildingAllowedOn,
  buildingUpgradeCost,
  canAfford,
  fieldsRemaining,
  fieldsUsed,
  researchUpgradeCost,
  scaleResourceCost,
  type FieldCapMods,
} from "./formulas.js";
import type {
  BuildingId,
  PlanetState,
  PlayerState,
  ResearchId,
  Resources,
} from "./types.js";
import { researchQueueCap, yardQueueCap } from "./world-queue-caps.js";

export type QueuePreview =
  | { ok: true; current: number; targetLevel: number; cost: Resources }
  | { ok: false; error: string; current: number; cost: Resources };

export interface BuildingPreviewMods {
  costMult?: number;
  fieldMods?: FieldCapMods;
}

/**
 * Why a building upgrade would be rejected, or the level it would queue.
 * Shared by the server action and the buildings screen so the button
 * matches `/api/upgrade` (cost includes levels already waiting in the queue).
 */
export function previewBuildingUpgrade(
  planet: PlanetState,
  player: PlayerState,
  buildingId: BuildingId,
  now = Date.now(),
  mods?: BuildingPreviewMods,
): QueuePreview {
  const empty: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  const def = BUILDINGS[buildingId];
  if (!def) {
    return { ok: false, error: "Unknown building.", current: 0, cost: empty };
  }
  if (!buildingAllowedOn(planet, buildingId)) {
    const error = planet.flags?.mini
      ? "That structure cannot be built on a mini planet."
      : planet.kind === "moon"
        ? "That structure cannot be built on a moon."
        : "That structure can only be built on a moon.";
    return { ok: false, error, current: 0, cost: empty };
  }

  const queue = planet.buildQueue ?? [];
  const pendingSame = queue.filter((q) => q.buildingId === buildingId).length;
  const current = (planet.buildings[buildingId] ?? 0) + pendingSame;
  const cost = scaleResourceCost(
    buildingUpgradeCost(buildingId, current),
    mods?.costMult ?? 1,
  );
  const fail = (error: string): QueuePreview => ({
    ok: false,
    error,
    current,
    cost,
  });

  if (typeof def.maxLevel === "number" && current >= def.maxLevel) {
    return fail(`${def.name} is maxed at level ${def.maxLevel}.`);
  }
  if (buildingId === "sensorArray" && (planet.buildings.lunarBase ?? 0) < 1) {
    return fail("System Scanner needs Lunar Habitat level 1.");
  }
  if (buildingId === "jumpGate" && (planet.buildings.lunarBase ?? 0) < 1) {
    return fail("Moon Bridge needs Lunar Habitat level 1.");
  }
  if (buildingId === "rigFoundry") {
    const yard = planet.buildings.shipyard ?? 0;
    if (yard < RIG_FOUNDRY_SHIPYARD_REQ) {
      return fail(
        `Manufacture Line needs Shipyard level ${RIG_FOUNDRY_SHIPYARD_REQ} (you have ${yard}).`,
      );
    }
  }
  if (buildingId === "mantleLoom") {
    if (planet.kind === "moon") {
      return fail("Land Reclamation cannot be built on moons.");
    }
    const solar = planet.buildings.solarPlant ?? 0;
    const lab = planet.buildings.researchLab ?? 0;
    if (solar < MANTLE_LOOM_SOLAR_REQ) {
      return fail(
        `Land Reclamation needs Solar Array level ${MANTLE_LOOM_SOLAR_REQ} (you have ${solar}).`,
      );
    }
    if (lab < MANTLE_LOOM_LAB_REQ) {
      return fail(
        `Land Reclamation needs Research Lab level ${MANTLE_LOOM_LAB_REQ} (you have ${lab}).`,
      );
    }
  }
  if (buildingId === "chronoLathe") {
    const yard = planet.buildings.shipyard ?? 0;
    const foundry = planet.buildings.rigFoundry ?? 0;
    if (yard < CHRONO_LATHE_SHIPYARD_REQ) {
      return fail(
        `Nano Production needs Shipyard level ${CHRONO_LATHE_SHIPYARD_REQ} (you have ${yard}).`,
      );
    }
    if (foundry < CHRONO_LATHE_RIG_FOUNDRY_REQ) {
      return fail(
        `Nano Production needs Manufacture Line level ${CHRONO_LATHE_RIG_FOUNDRY_REQ} (you have ${foundry}).`,
      );
    }
  }

  const cap = yardQueueCap(player, now);
  if (queue.length >= cap) {
    return fail(`Building queue is full (${queue.length}/${cap}).`);
  }

  const targetLevel = current + 1;
  if (buildingId === "lunarBase") {
    const nextCap = MOON_FIELDS_BASE + targetLevel * MOON_FIELDS_PER_LUNAR_BASE;
    if (nextCap < fieldsUsed(planet) + 1) {
      return fail("No free planet fields remaining.");
    }
  } else {
    const pendingFieldUsers = queue.filter(
      (q) => q.buildingId !== "lunarBase",
    ).length;
    if (fieldsRemaining(planet, mods?.fieldMods) < pendingFieldUsers + 1) {
      return fail("No free planet fields remaining.");
    }
  }

  if (!canAfford(planet.resources, cost)) {
    return fail("Not enough resources.");
  }

  return { ok: true, current, targetLevel, cost };
}

/**
 * Why research would be rejected. `lab` is the best Research Lab in the
 * empire (not only the open world). New prerequisites gate level 1 only.
 * Queue cap is the real cap, not the hard max.
 */
export function previewResearchUpgrade(
  player: PlayerState,
  planet: PlanetState,
  researchId: ResearchId,
  lab: number,
  now = Date.now(),
  bonusLab = lab,
): QueuePreview {
  const empty: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  const def = RESEARCH[researchId];
  if (!def) {
    return { ok: false, error: "Unknown research.", current: 0, cost: empty };
  }
  const queue = player.researchQueue ?? [];
  const pendingSame = queue.filter((q) => q.researchId === researchId).length;
  const current = (player.research?.[researchId] ?? 0) + pendingSame;
  const cost = researchUpgradeCost(researchId, current, bonusLab);
  const fail = (error: string): QueuePreview => ({
    ok: false,
    error,
    current,
    cost,
  });

  const cap = researchQueueCap(player, now);
  if (queue.length >= cap) {
    return fail(`Research queue is full (${queue.length}/${cap}).`);
  }
  if (current === 0) {
    if (lab < def.labLevel) {
      return fail(
        `Needs Research Lab level ${def.labLevel} (best lab ${lab}).`,
      );
    }
    for (const requiredId of RESEARCH_ORDER) {
      const requiredLevel = def.requires?.[requiredId];
      if (requiredLevel == null) continue;
      const have = player.research?.[requiredId] ?? 0;
      if (have < requiredLevel) {
        return fail(
          `Needs ${RESEARCH[requiredId].name} level ${requiredLevel} (have ${have}).`,
        );
      }
    }
  }
  if (!canAfford(planet.resources, cost)) {
    return fail("Not enough resources on active planet.");
  }
  return { ok: true, current, targetLevel: current + 1, cost };
}
