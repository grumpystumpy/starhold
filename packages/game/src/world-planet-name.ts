import type { UniverseState } from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import type { ActionResult } from "./world-queues.js";

export const PLANET_NAME_MAX_LEN = 24;
export const PLANET_NAME_MIN_LEN = 2;

/** Minimal blocklist — case-insensitive substring match on normalized name. */
const PROFANITY = [
  "fuck",
  "shit",
  "asshole",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
] as const;

/**
 * Validate + normalize a planet display name.
 * Length-limited, printable letters/numbers/space/light punctuation, profanity-safe.
 */
export function validatePlanetName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) {
    return { ok: false, error: "Planet name is required." };
  }
  if (name.length < PLANET_NAME_MIN_LEN) {
    return { ok: false, error: "Planet name is too short." };
  }
  if (name.length > PLANET_NAME_MAX_LEN) {
    return {
      ok: false,
      error: `Planet name must be ${PLANET_NAME_MAX_LEN} characters or fewer.`,
    };
  }
  if (!/^[\p{L}\p{N} .'_-]+$/u.test(name)) {
    return { ok: false, error: "Planet name has invalid characters." };
  }
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const bad of PROFANITY) {
    if (compact.includes(bad)) {
      return { ok: false, error: "Choose a different planet name." };
    }
  }
  return { ok: true, name };
}

export function renamePlanet(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  rawName: string,
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  const checked = validatePlanetName(rawName);
  if (!checked.ok) return { ok: false, error: checked.error };
  planet.name = checked.name;
  universe.planets[planetId] = planet;
  return { ok: true, planet };
}
