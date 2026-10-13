import type { OfficerDef, OfficerId } from "./types.js";

/** Wall-clock officer hire duration (v1). */
export const OFFICER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export const OFFICER_ORDER: OfficerId[] = [
  "quartermaster",
  "archivist",
  "navigator",
  "warden",
  "engineer",
  "spymaster",
];

/** Officer catalog — Starshard costs / effects per universe contract v1. */
export const OFFICERS: Record<OfficerId, OfficerDef> = {
  quartermaster: {
    id: "quartermaster",
    name: "Quartermaster",
    description: "Boosts mine output and +1 building/ship/defense queue slot while on duty.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "mineOutput", value: 1.1 }],
  },
  archivist: {
    id: "archivist",
    name: "Archivist",
    description: "Speeds empire research and +1 research queue slot while on duty.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "researchSpeed", value: 1.15 }],
  },
  navigator: {
    id: "navigator",
    name: "Navigator",
    description: "Faster fleets and one extra fleet slot.",
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
    description: "Hardens planetary defenses in combat.",
    cost: 60,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "defensePower", value: 1.15 }],
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    description: "Increases solar / energy output.",
    cost: 40,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "energyOutput", value: 1.15 }],
  },
  spymaster: {
    id: "spymaster",
    name: "Spymaster",
    description: "Raises espionage detail floor.",
    cost: 70,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "espionageLevel", value: 1 }],
  },
};
