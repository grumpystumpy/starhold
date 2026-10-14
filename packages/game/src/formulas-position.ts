import {
  FIELD_BAND,
  FIELD_CENTER_BY_SLOT,
  FIELD_MIN,
  SLOT_PRODUCTION_MULT,
  SLOT_TEMPERATURE_K,
  SOLAR_TEMP_BASELINE_K,
} from "./catalog.js";
import type { SlotProductionMult } from "./types.js";

/** Slot temperature K (same table as formulas-round3.planetTemperatureK). */
export function temperatureKForSlot(slot: number): number {
  return SLOT_TEMPERATURE_K[slot] ?? SOLAR_TEMP_BASELINE_K;
}

/** FNV-1a style hash → unsigned 32-bit. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Neutral multipliers when slot is out of 1..15. */
const NEUTRAL_MULT: SlotProductionMult = {
  metal: 1,
  crystal: 1,
  deuterium: 1,
  energy: 1,
};

export function productionMultForSlot(slot: number): SlotProductionMult {
  const row = SLOT_PRODUCTION_MULT[slot];
  if (!row) return { ...NEUTRAL_MULT };
  return { ...row };
}

/**
 * Deterministic field cap from universe seed + coords.
 * Uniform in [center − FIELD_BAND, center + FIELD_BAND], then floor FIELD_MIN.
 */
export function rollPlanetFields(slot: number, seed: string): number {
  const center = FIELD_CENTER_BY_SLOT[slot] ?? FIELD_CENTER_BY_SLOT[8]!;
  const span = FIELD_BAND * 2 + 1;
  const offset = (hashSeed(seed) % span) - FIELD_BAND;
  return Math.max(FIELD_MIN, center + offset);
}
