import { MAP_GALAXIES, MAP_SYSTEMS } from "@starhold/game";

export type GalaxySystem = {
  galaxy: number;
  system: number;
};

export type ParseGalaxyCoordsResult =
  | GalaxySystem
  | { error: string };

const ERROR_MESSAGE = `Use galaxy:system, like 9:143 (galaxy 1–${MAP_GALAXIES}, system 1–${MAP_SYSTEMS})`;

const PAIR_RE = /^(-?\d+)[\s:.,]+(-?\d+)$/;

export function parseGalaxyCoords(
  text: string,
  currentGalaxy: number,
): ParseGalaxyCoordsResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { error: ERROR_MESSAGE };
  }

  const pair = PAIR_RE.exec(trimmed);
  if (pair !== null) {
    const galaxy = parseInt(pair[1], 10);
    const system = parseInt(pair[2], 10);

    if (
      galaxy < 1 ||
      galaxy > MAP_GALAXIES ||
      system < 1 ||
      system > MAP_SYSTEMS
    ) {
      return { error: ERROR_MESSAGE };
    }

    return { galaxy, system };
  }

  // No separator found - check if it's just a system number
  if (!/^-?\d+$/.test(trimmed)) {
    return { error: ERROR_MESSAGE };
  }

  const system = parseInt(trimmed, 10);
  if (system < 1 || system > MAP_SYSTEMS) {
    return { error: ERROR_MESSAGE };
  }

  // Galaxy defaults to currentGalaxy if it's in valid range
  if (currentGalaxy < 1 || currentGalaxy > MAP_GALAXIES) {
    return { error: ERROR_MESSAGE };
  }

  return { galaxy: currentGalaxy, system };
}
