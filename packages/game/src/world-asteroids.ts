import {
  ASTEROID_COUNT_WEIGHTS,
  ASTEROID_RICHNESS,
  MAP_GALAXIES,
  MAP_SYSTEMS,
} from "./catalog.js";
import { hashSeed } from "./formulas-position.js";
import type { AsteroidField, Coordinates, UniverseState } from "./types.js";

export function asteroidId(
  galaxy: number,
  system: number,
  index: number,
): string {
  return `ast:${galaxy}:${system}:a${index}`;
}

function rollInRange(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashSeed(seed) % span);
}

export function rollAsteroidCount(
  universeSeed: string,
  galaxy: number,
  system: number,
): number {
  const totalWeight = ASTEROID_COUNT_WEIGHTS.reduce(
    (sum, row) => sum + row.weight,
    0,
  );
  let roll = hashSeed(`${universeSeed}:ast-count:${galaxy}:${system}`) % totalWeight;
  for (const row of ASTEROID_COUNT_WEIGHTS) {
    if (roll < row.weight) return row.count;
    roll -= row.weight;
  }
  return 0;
}

export function createAsteroidField(
  universeSeed: string,
  galaxy: number,
  system: number,
  index: number,
): AsteroidField {
  const id = asteroidId(galaxy, system, index);
  const richness = ASTEROID_RICHNESS;
  // Per-harvest yield ranges × richness = field stockpile.
  const metalPer =
    rollInRange(`${universeSeed}:${id}:m`, 2000, 8000) * richness;
  const crystalPer =
    rollInRange(`${universeSeed}:${id}:c`, 1000, 4000) * richness;
  const deutPer = rollInRange(`${universeSeed}:${id}:d`, 0, 500) * richness;
  // Slot is a reserved local index (not a planet slot); UI shows system row.
  const coords: Coordinates = {
    galaxy,
    system,
    slot: 100 + index,
  };
  return {
    id,
    coords,
    metal: metalPer,
    crystal: crystalPer,
    deuterium: deutPer,
    richness,
  };
}

/** Populate asteroids for the whole map from universe.seed (idempotent replace). */
export function seedUniverseAsteroids(universe: UniverseState): void {
  const seed = universe.seed ?? universe.id;
  const asteroids: Record<string, AsteroidField> = {};
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      const count = rollAsteroidCount(seed, galaxy, system);
      for (let i = 0; i < count; i++) {
        const field = createAsteroidField(seed, galaxy, system, i);
        asteroids[field.id] = field;
      }
    }
  }
  universe.asteroids = asteroids;
}

export function asteroidsInSystem(
  universe: UniverseState,
  galaxy: number,
  system: number,
): AsteroidField[] {
  const out: AsteroidField[] = [];
  for (const field of Object.values(universe.asteroids ?? {})) {
    if (field.coords.galaxy === galaxy && field.coords.system === system) {
      out.push(field);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Apply one harvest cycle: fill cargo from field stock, decrement richness.
 * Despawns when richness hits 0 or stock is empty.
 */
export function harvestAsteroidField(
  universe: UniverseState,
  asteroidId: string,
  cargoCap: number,
): { metal: number; crystal: number; deuterium: number } {
  const field = universe.asteroids?.[asteroidId];
  if (!field || field.richness <= 0 || cargoCap <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }

  let remaining = cargoCap;
  const takeMetal = Math.min(field.metal, remaining);
  remaining -= takeMetal;
  const takeCrystal = Math.min(field.crystal, remaining);
  remaining -= takeCrystal;
  const takeDeut = Math.min(field.deuterium, remaining);

  field.metal -= takeMetal;
  field.crystal -= takeCrystal;
  field.deuterium -= takeDeut;
  field.richness -= 1;

  if (
    field.richness <= 0 ||
    (field.metal <= 0 && field.crystal <= 0 && field.deuterium <= 0)
  ) {
    delete universe.asteroids![asteroidId];
  } else {
    universe.asteroids![asteroidId] = field;
  }

  return { metal: takeMetal, crystal: takeCrystal, deuterium: takeDeut };
}
