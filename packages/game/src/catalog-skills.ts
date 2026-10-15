import type { SkillNodeDef } from "./types.js";

/**
 * Permanent skill tree purchased with Starshards.
 * Costs by depth: tier1=25, tier2=40, tier3=60 (contract v1).
 */
export const SKILL_ORDER: string[] = [
  "eco_mines_1",
  "eco_energy_1",
  "eco_mines_2",
  "yardDepth",
  "eco_capstone",
  "mil_fleet_1",
  "mil_slots_1",
  "mil_def_1",
  "mil_capstone",
  "exp_spy_1",
  "exp_research_1",
  "exp_spy_2",
  "exp_capstone",
];

/** Round 2 skill: +1 building/ship/defense queue slot. */
export const YARD_DEPTH_SKILL_ID = "yardDepth";

export const SKILLS: Record<string, SkillNodeDef> = {
  eco_mines_1: {
    id: "eco_mines_1",
    branch: "economy",
    name: "Strip Mining I",
    description: "Permanent +5% mine output per level.",
    cost: 25,
    requires: [],
    effects: [{ kind: "mineOutput", value: 1.05 }],
  },
  eco_energy_1: {
    id: "eco_energy_1",
    branch: "economy",
    name: "Grid Tuning I",
    description: "Permanent +5% energy output per level.",
    cost: 25,
    requires: [],
    effects: [{ kind: "energyOutput", value: 1.05 }],
  },
  eco_mines_2: {
    id: "eco_mines_2",
    branch: "economy",
    name: "Strip Mining II",
    description: "Further +5% mine output per level.",
    cost: 40,
    requires: ["eco_mines_1"],
    effects: [{ kind: "mineOutput", value: 1.05 }],
  },
  yardDepth: {
    id: "yardDepth",
    branch: "economy",
    name: "Yard Depth",
    description:
      "Extra building, ship, and defense queue slots. Level 1 adds 1 slot.",
    cost: 40,
    requires: ["eco_mines_1"],
    effects: [],
  },
  eco_capstone: {
    id: "eco_capstone",
    branch: "economy",
    name: "Industrial Doctrine",
    description: "Capstone: +5% mines and +5% energy per level.",
    cost: 60,
    requires: ["eco_mines_2", "eco_energy_1"],
    effects: [
      { kind: "mineOutput", value: 1.05 },
      { kind: "energyOutput", value: 1.05 },
    ],
  },
  mil_fleet_1: {
    id: "mil_fleet_1",
    branch: "military",
    name: "Warp Discipline I",
    description: "Permanent +5% fleet speed per level.",
    cost: 25,
    requires: [],
    effects: [{ kind: "fleetSpeed", value: 1.05 }],
  },
  mil_slots_1: {
    id: "mil_slots_1",
    branch: "military",
    name: "Command Bandwidth",
    description: "Permanent extra fleet slots. Level 1 adds 1.",
    cost: 25,
    requires: [],
    effects: [{ kind: "fleetSlots", value: 1 }],
  },
  mil_def_1: {
    id: "mil_def_1",
    branch: "military",
    name: "Hardened Emplacements",
    description: "Permanent +5% defense power per level.",
    cost: 40,
    requires: ["mil_fleet_1"],
    effects: [{ kind: "defensePower", value: 1.05 }],
  },
  mil_capstone: {
    id: "mil_capstone",
    branch: "military",
    name: "War College",
    description: "Capstone: +5% fleet speed and defense per level.",
    cost: 60,
    requires: ["mil_def_1", "mil_slots_1"],
    effects: [
      { kind: "fleetSpeed", value: 1.05 },
      { kind: "defensePower", value: 1.05 },
    ],
  },
  exp_spy_1: {
    id: "exp_spy_1",
    branch: "exploration",
    name: "Sensor Craft I",
    description: "Permanent extra espionage detail. Level 1 adds 1.",
    cost: 25,
    requires: [],
    effects: [{ kind: "espionageLevel", value: 1 }],
  },
  exp_research_1: {
    id: "exp_research_1",
    branch: "exploration",
    name: "Archive Protocols",
    description: "Permanent +5% research speed per level.",
    cost: 25,
    requires: [],
    effects: [{ kind: "researchSpeed", value: 1.05 }],
  },
  exp_spy_2: {
    id: "exp_spy_2",
    branch: "exploration",
    name: "Sensor Craft II",
    description: "Further espionage detail. Level 1 adds 1.",
    cost: 40,
    requires: ["exp_spy_1"],
    effects: [{ kind: "espionageLevel", value: 1 }],
  },
  exp_capstone: {
    id: "exp_capstone",
    branch: "exploration",
    name: "Deep Survey Corps",
    description: "Capstone: +10% research speed per level.",
    cost: 60,
    requires: ["exp_spy_2", "exp_research_1"],
    effects: [{ kind: "researchSpeed", value: 1.1 }],
  },
};
