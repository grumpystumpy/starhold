import { MAP_GALAXIES, MAP_SYSTEMS } from "@starhold/game";

export type GalaxySystem = {
  galaxy: number;
  system: number;
};

export type ParseGalaxyCoordsResult =
  | GalaxySystem
  | { error: string };

const ERROR_MESSAGE =
  "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)";

export function parseGalaxyCoords(
  text: string,
  currentGalaxy: number,
): ParseGalaxyCoordsResult {
  if (text === undefined || text === null) {
    return { error: ERROR_MESSAGE };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { error: ERROR_MESSAGE };
  }

  // Try to split by common separators: : space . ,
  const separators = [":", " ", ".", ","];
  let galaxyStr: string | null = null;
  let systemStr: string | null = null;

  for (const sep of separators) {
    if (trimmed.includes(sep)) {
      const parts = trimmed.split(sep);
      if (parts.length === 2) {
        galaxyStr = parts[0].trim();
        systemStr = parts[1].trim();
        break;
      }
    }
  }

  if (galaxyStr !== null && systemStr !== null) {
    // Both galaxy and system provided
    if (galaxyStr.length === 0 || systemStr.length === 0) {
      return { error: ERROR_MESSAGE };
    }

    // Must be integers only
    if (!/^-?\d+$/.test(galaxyStr) || !/^-?\d+$/.test(systemStr)) {
      return { error: ERROR_MESSAGE };
    }

    const galaxy = parseInt(galaxyStr, 10);
    const system = parseInt(systemStr, 10);

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
