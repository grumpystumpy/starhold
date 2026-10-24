import type { OfficerDef, OfficerId } from "./types.js";

/** Base wall-clock duration for the first officer hire. */
export const OFFICER_DURATION_MS = 20 * 60 * 60 * 1000;

export function officerRenewalCost(baseCost: number, renewals: number): number {
  return Math.floor(baseCost * (1 + 0.5 * Math.max(0, Math.floor(renewals))));
}

export function officerRenewalDurationMs(renewals: number): number {
  return OFFICER_DURATION_MS * (1 + 0.15 * Math.max(0, Math.floor(renewals)));
}

export const OFFICER_ORDER: OfficerId[] = [
  "quartermaster",
  "archivist",
  "navigator",
  "warden",
  "engineer",
  "spymaster",
  "vaultkeeper",
];

/** Officer catalog — Starshard costs / effects per universe contract v1. */
export const OFFICERS: Record<OfficerId, OfficerDef> = {
  quartermaster: {
    id: "quartermaster",
    name: "Quartermaster",
    description:
      "While on duty, +10% mine output per level and extra build queue slots.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "mineOutput", value: 1.1 }],
  },
  archivist: {
    id: "archivist",
    name: "Archivist",
    description:
      "While on duty, +15% research speed per level and extra research queue slots.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "researchSpeed", value: 1.15 }],
  },
  navigator: {
    id: "navigator",
    name: "Navigator",
    description:
      "While on duty, +10% fleet speed per level and extra fleet slots.",
    cost: 60,
    durationMs: OFFICER_DURATION_MS,
    effects: [
      { kind: "fleetSpeed", value: 1.1 },
      { kind: "fleetSlots", value: 1 },
    ],
  },
  warden: {
    id: "warden",
    name: "Warden",
    description: "While on duty, +15% defense power per level.",
    cost: 60,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "defensePower", value: 1.15 }],
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    description: "While on duty, +15% energy output per level.",
    cost: 40,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "energyOutput", value: 1.15 }],
  },
  spymaster: {
    id: "spymaster",
    name: "Spymaster",
    description: "While on duty, extra espionage detail. Level 1 adds 1.",
    cost: 70,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "espionageLevel", value: 1 }],
  },
  vaultkeeper: {
    id: "vaultkeeper",
    name: "Vaultkeeper",
    description: "While on duty, +10% metal, crystal, and deuterium storage capacity.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "storageCapacity", value: 1.1 }],
  },
};
