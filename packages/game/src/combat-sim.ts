import {
  DEFENSE_ORDER,
  DEFENSES,
  RESEARCH,
  RESEARCH_ORDER,
  SHIP_ORDER,
  SHIPS,
} from "./catalog.js";
import {
  emptyDefenses,
  emptyFleetShips,
  emptyResearch,
  normalizeFleetShips,
  resolveCombat,
  type CombatMods,
  type CombatResolution,
} from "./formulas.js";
import { levelBonuses } from "./formulas-progress.js";
import { classBonuses } from "./formulas-round3.js";
import type {
  DefenseId,
  DefenseStock,
  FleetShips,
  PlayerClassId,
  ResearchLevels,
  ShipId,
} from "./types.js";

export interface CombatSimInput {
  attacker: Partial<FleetShips>;
  defender: Partial<FleetShips>;
  defenses?: Partial<DefenseStock> | null;
  attackerResearch?: ResearchLevels;
  defenderResearch?: Partial<ResearchLevels> | null;
  mods?: CombatMods;
}

/** Copy of the live combat call. Callers' fleets, research, and mods stay put. */
export function simulateCombat(input: CombatSimInput): CombatResolution {
  const mods = input.mods ? { ...input.mods } : undefined;
  if (mods?.battlefield) mods.battlefield = { ...mods.battlefield };
  return resolveCombat(
    normalizeFleetShips(input.attacker),
    normalizeFleetShips(input.defender),
    { ...emptyDefenses(), ...(input.defenses ?? {}) },
    input.attackerResearch ? { ...input.attackerResearch } : undefined,
    input.defenderResearch ? { ...emptyResearch(), ...input.defenderResearch } : undefined,
    mods,
  );
}

/** Level bonus and class attack, read from a player snapshot. Does not write the player. */
export function attackerSimResearch(player: {
  research: ResearchLevels;
  level?: number;
}): ResearchLevels {
  const bonus = levelBonuses(player.level ?? 1);
  return {
    ...player.research,
    weaponsTech: (player.research.weaponsTech ?? 0) + bonus.weaponsBonus,
    shieldingTech: (player.research.shieldingTech ?? 0) + bonus.shieldingBonus,
  };
}

export interface CombatSandboxInput {
  attacker: Partial<FleetShips>;
  defender: Partial<FleetShips>;
  defenses?: Partial<DefenseStock> | null;
  attackerResearch: ResearchLevels;
  attackerLevel?: number;
  attackerClassId?: PlayerClassId | null;
  defenderResearch?: Partial<ResearchLevels> | null;
  seed?: string;
}

/** Planet-fight rules the sandbox knows: seeded combat, level research, class attack. */
export function runCombatSandbox(input: CombatSandboxInput): CombatResolution {
  const seed = input.seed?.trim() || "starhold-sim";
  return simulateCombat({
    attacker: input.attacker,
    defender: input.defender,
    defenses: input.defenses,
    attackerResearch: attackerSimResearch({
      research: input.attackerResearch,
      level: input.attackerLevel,
    }),
    defenderResearch: input.defenderResearch,
    mods: {
      seed,
      attackMult: classBonuses(input.attackerClassId).attack,
    },
  });
}

export interface DefenderDraft {
  ships: FleetShips | null;
  defenses: DefenseStock | null;
  research: ResearchLevels | null;
}

export function defenderFromSpyReport(report: {
  ships?: Partial<FleetShips> | null;
  defenses?: Partial<DefenseStock> | null;
  research?: Partial<ResearchLevels> | null;
}): DefenderDraft {
  return {
    ships: report.ships ? normalizeFleetShips(report.ships) : null,
    defenses: report.defenses
      ? { ...emptyDefenses(), ...report.defenses }
      : null,
    research: report.research
      ? { ...emptyResearch(), ...report.research }
      : null,
  };
}

export type CombatSimPaste =
  | { ok: true; ships: FleetShips; defenses: DefenseStock; research: ResearchLevels | null }
  | { ok: false; error: string };

const SHIP_NAMES = catalogNames(SHIP_ORDER, SHIPS);
const DEFENSE_NAMES = catalogNames(DEFENSE_ORDER, DEFENSES);
const RESEARCH_NAMES = catalogNames(RESEARCH_ORDER, RESEARCH);

function catalogNames<T extends string>(
  order: readonly T[],
  catalog: Record<T, { name: string }>,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const id of order) {
    map.set(catalog[id].name.trim().toLowerCase(), id);
    map.set(id.toLowerCase(), id);
  }
  return map;
}

function parseNum(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function takeCounts<T extends string>(
  body: string,
  names: Map<string, T>,
): { counts: Record<string, number>; unknown: string[] } {
  const counts: Record<string, number> = {};
  const unknown: string[] = [];
  for (const part of body.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const times = part.match(/^([\d][\d,]*)\s*[×xX]\s*(.+)$/);
    const level = part.match(/^(.+?)\s+L([\d][\d,]*)$/);
    const idCount = part.match(/^([A-Za-z][A-Za-z0-9]*)\s*[:=]\s*([\d][\d,]*)$/);
    const matched = times
      ? { key: times[2]!.trim().toLowerCase(), n: parseNum(times[1]!) }
      : level
        ? { key: level[1]!.trim().toLowerCase(), n: parseNum(level[2]!) }
        : idCount
          ? { key: idCount[1]!.trim().toLowerCase(), n: parseNum(idCount[2]!) }
          : null;
    if (!matched || matched.n == null) {
      unknown.push(part);
      continue;
    }
    const id = names.get(matched.key);
    if (!id) {
      unknown.push(part);
      continue;
    }
    counts[id] = matched.n;
  }
  return { counts, unknown };
}

function stockShips(counts: Record<string, number>): FleetShips {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) out[id] = counts[id] ?? 0;
  return out;
}

function stockDefenses(counts: Record<string, number>): DefenseStock {
  const out = emptyDefenses();
  for (const id of DEFENSE_ORDER) out[id] = counts[id] ?? 0;
  return out;
}

function stockResearch(counts: Record<string, number>): ResearchLevels {
  const out = emptyResearch();
  for (const id of RESEARCH_ORDER) out[id] = counts[id] ?? 0;
  return out;
}

/** Spy-report lines (`Ships: 4× Recon Drone`) or `cruiser=4` rows. */
export function parseCombatSimPaste(text: string): CombatSimPaste {
  const shipCounts: Record<string, number> = {};
  const defenseCounts: Record<string, number> = {};
  const researchCounts: Record<string, number> = {};
  let sawShips = false;
  let sawDefenses = false;
  let sawResearch = false;
  const unknown: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^metal\b/i.test(line) && /crystal/i.test(line)) continue;
    const headed = line.match(/^(ships|defenses|research)\s*:\s*(.*)$/i);
    if (headed) {
      const kind = headed[1]!.toLowerCase();
      const body = headed[2] ?? "";
      if (kind === "ships") {
        sawShips = true;
        const parsed = takeCounts(body, SHIP_NAMES);
        Object.assign(shipCounts, parsed.counts);
        unknown.push(...parsed.unknown);
      } else if (kind === "defenses") {
        sawDefenses = true;
        const parsed = takeCounts(body, DEFENSE_NAMES);
        Object.assign(defenseCounts, parsed.counts);
        unknown.push(...parsed.unknown);
      } else if (kind === "research") {
        sawResearch = true;
        const parsed = takeCounts(body, RESEARCH_NAMES);
        Object.assign(researchCounts, parsed.counts);
        unknown.push(...parsed.unknown);
      }
      continue;
    }
    const idCount = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*[:=]\s*([\d][\d,]*)$/);
    if (idCount) {
      const key = idCount[1]!.toLowerCase();
      const n = parseNum(idCount[2]!);
      if (n == null) {
        unknown.push(line);
        continue;
      }
      const ship = SHIP_NAMES.get(key);
      const defense = DEFENSE_NAMES.get(key);
      const research = RESEARCH_NAMES.get(key);
      if (ship) {
        sawShips = true;
        shipCounts[ship] = n;
      } else if (defense) {
        sawDefenses = true;
        defenseCounts[defense] = n;
      } else if (research) {
        sawResearch = true;
        researchCounts[research] = n;
      } else {
        unknown.push(line);
      }
      continue;
    }
    if (/\d/.test(line)) unknown.push(line);
  }

  if (unknown.length) {
    return { ok: false, error: `Unrecognized: ${unknown.slice(0, 3).join("; ")}` };
  }
  if (!sawShips && !sawDefenses && !sawResearch) {
    return { ok: false, error: "Paste ships, defenses, or research from a spy report." };
  }
  return {
    ok: true,
    ships: stockShips(shipCounts),
    defenses: stockDefenses(defenseCounts),
    research: sawResearch ? stockResearch(researchCounts) : null,
  };
}

export function simShipId(value: string | null | undefined): ShipId | null {
  if (!value) return null;
  for (const id of SHIP_ORDER) if (id === value) return id;
  return null;
}

export function simDefenseId(value: string | null | undefined): DefenseId | null {
  if (!value) return null;
  for (const id of DEFENSE_ORDER) if (id === value) return id;
  return null;
}
