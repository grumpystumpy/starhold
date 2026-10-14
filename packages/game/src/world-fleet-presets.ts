import { SHIP_ORDER } from "./catalog.js";
import { normalizeFleetShips } from "./formulas.js";
import type {
  FleetPreset,
  FleetPresetIntent,
  FleetShips,
  PlayerState,
  ShipId,
  UniverseState,
} from "./types.js";

export const BUILTIN_PRESET_IDS = [
  "expedition",
  "raid",
  "moonDestruction",
  "miniPlanetCapture",
  "miniPlanetDestruction",
] as const;

export type BuiltinPresetId = (typeof BUILTIN_PRESET_IDS)[number];

const BUILTIN_META: Record<
  BuiltinPresetId,
  { name: string; intent: FleetPresetIntent; ships: Partial<FleetShips> }
> = {
  expedition: {
    name: "Expedition",
    intent: "expedition",
    ships: { scout: 2, hauler: 1 },
  },
  raid: {
    name: "Raid",
    intent: "raid",
    ships: { interceptor: 10, cruiser: 2 },
  },
  moonDestruction: {
    name: "Moon Destruction",
    intent: "moonDestruction",
    ships: { voidforgeTitan: 1 },
  },
  miniPlanetCapture: {
    name: "Mini Planet Capture",
    intent: "miniCapture",
    ships: { worldEater: 5 },
  },
  miniPlanetDestruction: {
    name: "Mini Planet Destruction",
    intent: "miniDestroy",
    ships: { worldEater: 5 },
  },
};

export type PresetActionResult =
  | { ok: true; presets: FleetPreset[] }
  | { ok: false; error: string };

function clampShips(ships: Partial<FleetShips>): Partial<FleetShips> {
  const out: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const n = Math.max(0, Math.floor(ships[id] ?? 0));
    if (n > 0) out[id] = n;
  }
  return out;
}

function builtinDefaults(): FleetPreset[] {
  return BUILTIN_PRESET_IDS.map((id) => {
    const meta = BUILTIN_META[id];
    return {
      id,
      name: meta.name,
      intent: meta.intent,
      builtIn: true,
      ships: { ...meta.ships },
    };
  });
}

/** Seed / repair built-in presets; keep custom entries and edited built-in ship counts. */
export function ensurePlayerFleetPresets(player: PlayerState): FleetPreset[] {
  const existing = Array.isArray(player.fleetPresets)
    ? player.fleetPresets
    : [];
  const byId = new Map<string, FleetPreset>();
  for (const p of existing) {
    if (!p || typeof p.id !== "string" || !p.id) continue;
    byId.set(p.id, {
      id: p.id,
      name: String(p.name ?? "Custom").slice(0, 48),
      intent: p.intent ?? "custom",
      builtIn: Boolean(p.builtIn),
      ships: clampShips(p.ships ?? {}),
    });
  }

  const merged: FleetPreset[] = [];
  for (const id of BUILTIN_PRESET_IDS) {
    const meta = BUILTIN_META[id];
    const prev = byId.get(id);
    merged.push({
      id,
      name: meta.name,
      intent: meta.intent,
      builtIn: true,
      ships: prev?.ships && Object.keys(prev.ships).length > 0
        ? clampShips(prev.ships)
        : { ...meta.ships },
    });
    byId.delete(id);
  }
  for (const p of byId.values()) {
    if (p.builtIn) continue;
    merged.push({
      ...p,
      builtIn: false,
      intent: "custom",
    });
  }
  player.fleetPresets = merged;
  return merged;
}

export function listFleetPresets(player: PlayerState): FleetPreset[] {
  return ensurePlayerFleetPresets(player);
}

export function getFleetPreset(
  player: PlayerState,
  presetId: string,
): FleetPreset | null {
  return listFleetPresets(player).find((p) => p.id === presetId) ?? null;
}

export function expeditionPresetShips(player: PlayerState): FleetShips {
  const preset = getFleetPreset(player, "expedition");
  return normalizeFleetShips(preset?.ships ?? BUILTIN_META.expedition.ships);
}

export function saveFleetPreset(
  universe: UniverseState,
  playerId: string,
  opts: {
    id?: string;
    name: string;
    ships: Partial<FleetShips>;
  },
): PresetActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };

  const name = opts.name.trim().slice(0, 48);
  if (!name) return { ok: false, error: "Preset name is required." };

  const ships = clampShips(opts.ships);
  if (Object.keys(ships).length < 1) {
    return { ok: false, error: "Select at least one ship type." };
  }

  const presets = ensurePlayerFleetPresets(player);
  const id = opts.id?.trim();

  if (id && (BUILTIN_PRESET_IDS as readonly string[]).includes(id)) {
    const idx = presets.findIndex((p) => p.id === id);
    if (idx < 0) return { ok: false, error: "Unknown preset." };
    presets[idx] = {
      ...presets[idx],
      ships,
    };
    player.fleetPresets = presets;
    return { ok: true, presets };
  }

  if (id) {
    const idx = presets.findIndex((p) => p.id === id && !p.builtIn);
    if (idx < 0) return { ok: false, error: "Unknown custom preset." };
    presets[idx] = {
      id,
      name,
      intent: "custom",
      builtIn: false,
      ships,
    };
    player.fleetPresets = presets;
    return { ok: true, presets };
  }

  const customId = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  presets.push({
    id: customId,
    name,
    intent: "custom",
    builtIn: false,
    ships,
  });
  player.fleetPresets = presets;
  return { ok: true, presets };
}

export function deleteFleetPreset(
  universe: UniverseState,
  playerId: string,
  presetId: string,
): PresetActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };

  if ((BUILTIN_PRESET_IDS as readonly string[]).includes(presetId)) {
    return { ok: false, error: "Cannot delete a built-in preset." };
  }

  const presets = ensurePlayerFleetPresets(player);
  const next = presets.filter((p) => p.id !== presetId);
  if (next.length === presets.length) {
    return { ok: false, error: "Unknown custom preset." };
  }
  player.fleetPresets = next;
  return { ok: true, presets: next };
}

/** @internal test helper */
export function defaultBuiltinPresets(): FleetPreset[] {
  return builtinDefaults();
}

export type { ShipId };
