import { hashSeed } from "./formulas-position.js";
import manifest from "./data/planet-art-manifest.json" with { type: "json" };
import type { Coordinates, PlanetState, UniverseState } from "./types.js";

/**
 * Procedural planet discs. Ids and paths come from the committed catalog
 * (`planet-art-manifest.json`, also served at `/planet-art/manifest.json`).
 * Nothing is stored on the planet — views derive art from coordinates.
 *
 * Normal slots 1–15 are assigned together per system so the result is stable
 * across reloads and colonization:
 *   1. Hash `galaxy:system:slot` into that slot's pool.
 *   2. If the id is already used in the system (which includes slot−1 when
 *      slots are walked in order), take the next pool index, wrapping.
 *   3. If every id in the pool is blocked, keep the original hash index.
 *      Uniqueness is preferred; a full pool cannot satisfy it (best effort).
 *
 * Moons reuse the parent body's art id. The UI draws that id smaller.
 * Minis use the mini pool, resolved against the other mini slots in the
 * same system (ascending slot order, so a later mini does not reshuffle
 * an earlier one).
 */

export type PlanetArtKind = "normal" | "mini";

export type PlanetArtCategory = "hot" | "lush" | "cold" | "mini";

export interface PlanetArtRef {
  artId: string;
  artUrl: string;
  artThumbUrl: string;
}

interface PlanetArtAsset {
  id: string;
  category: PlanetArtCategory;
  file: string;
  thumb: string;
}

const ASSETS: readonly PlanetArtAsset[] = manifest.assets.map((asset) => ({
  id: asset.id,
  category: categoryOf(asset.category),
  file: asset.file,
  thumb: asset.thumb,
}));

const BY_ID = new Map(ASSETS.map((asset) => [asset.id, asset]));

function idsFor(category: PlanetArtCategory): readonly string[] {
  return ASSETS.filter((asset) => asset.category === category).map(
    (asset) => asset.id,
  );
}

export const HOT_ART_IDS: readonly string[] = idsFor("hot");
export const LUSH_ART_IDS: readonly string[] = idsFor("lush");
export const COLD_ART_IDS: readonly string[] = idsFor("cold");
export const MINI_ART_IDS: readonly string[] = idsFor("mini");

function categoryOf(value: string): PlanetArtCategory {
  switch (value) {
    case "hot":
    case "lush":
    case "cold":
    case "mini":
      return value;
    default: {
      throw new Error(`Unknown planet art category: ${value}`);
    }
  }
}

/** Pool for a normal colonizable slot, or null outside 1–15. */
export function poolForSlot(slot: number): readonly string[] | null {
  const n = Math.floor(slot);
  if (n >= 1 && n <= 5) return HOT_ART_IDS;
  if (n >= 6 && n <= 10) return LUSH_ART_IDS;
  if (n >= 11 && n <= 15) return COLD_ART_IDS;
  return null;
}

function poolFor(
  kind: PlanetArtKind,
  slot: number,
): readonly string[] | null {
  switch (kind) {
    case "mini":
      return MINI_ART_IDS;
    case "normal":
      return poolForSlot(slot);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function planetArtRef(artId: string): PlanetArtRef {
  const asset = BY_ID.get(artId);
  if (!asset) throw new Error(`Unknown planet art id: ${artId}`);
  return {
    artId,
    artUrl: `/planet-art/${asset.file}`,
    artThumbUrl: `/planet-art/${asset.thumb}`,
  };
}

/**
 * Hash index into `pool`, then walk forward while the id is blocked.
 * When the pool is exhausted, returns the original hash index (best effort).
 */
export function resolveArtIndex(
  start: number,
  pool: readonly string[],
  blocked: ReadonlySet<string>,
): number {
  if (pool.length === 0) return 0;
  const origin = ((start % pool.length) + pool.length) % pool.length;
  for (let step = 0; step < pool.length; step++) {
    const index = (origin + step) % pool.length;
    const id = pool[index];
    if (id && !blocked.has(id)) return index;
  }
  return origin;
}

/**
 * One slot's art id. `occupiedInSystem` should already contain ids chosen
 * for other slots in this system, including the adjacent slot when known.
 * Pass an empty set for the raw hash candidate.
 */
export function planetArtId(
  coords: Coordinates,
  kind: PlanetArtKind,
  occupiedInSystem: ReadonlySet<string> = new Set(),
): string {
  const galaxy = Math.floor(coords.galaxy);
  const system = Math.floor(coords.system);
  const slot = Math.floor(coords.slot);
  const pool = poolFor(kind, slot);
  if (!pool || pool.length === 0) {
    throw new Error(`No planet art pool for ${kind} slot ${slot}.`);
  }
  const key = `${galaxy}:${system}:${slot}`;
  const start = hashSeed(key) % pool.length;
  const index = resolveArtIndex(start, pool, occupiedInSystem);
  const id = pool[index];
  if (!id) throw new Error(`Empty planet art pool for ${kind}.`);
  return id;
}

const normalCache = new Map<string, readonly PlanetArtRef[]>();

/** Art for slots 1–15 in one system. Pure function of galaxy + system. */
export function normalArtForSystem(
  galaxy: number,
  system: number,
): readonly PlanetArtRef[] {
  const g = Math.floor(galaxy);
  const s = Math.floor(system);
  const cacheKey = `${g}:${s}`;
  const cached = normalCache.get(cacheKey);
  if (cached) return cached;
  const occupied = new Set<string>();
  const refs: PlanetArtRef[] = [];
  for (let slot = 1; slot <= 15; slot++) {
    const artId = planetArtId({ galaxy: g, system: s, slot }, "normal", occupied);
    occupied.add(artId);
    refs.push(planetArtRef(artId));
  }
  normalCache.set(cacheKey, refs);
  return refs;
}

export function normalArtAt(coords: Coordinates): PlanetArtRef {
  const slot = Math.floor(coords.slot);
  const row = normalArtForSystem(coords.galaxy, coords.system);
  const art = row[slot - 1];
  if (!art) {
    throw new Error(`No normal planet art for slot ${slot}.`);
  }
  return art;
}

/** Mini discs for the given slots in one system (ascending, unique). */
export function miniArtForSlots(
  galaxy: number,
  system: number,
  slots: readonly number[],
): ReadonlyMap<number, PlanetArtRef> {
  const g = Math.floor(galaxy);
  const s = Math.floor(system);
  const ordered = [...new Set(slots.map((slot) => Math.floor(slot)))].sort(
    (a, b) => a - b,
  );
  const occupied = new Set<string>();
  const out = new Map<number, PlanetArtRef>();
  for (const slot of ordered) {
    const artId = planetArtId({ galaxy: g, system: s, slot }, "mini", occupied);
    occupied.add(artId);
    out.set(slot, planetArtRef(artId));
  }
  return out;
}

const miniIdSets = new WeakMap<
  UniverseState,
  { length: number; tail: string; ids: Set<string> }
>();

function miniIdSet(universe: UniverseState): Set<string> {
  const list = universe.miniPlanetIds ?? [];
  const tail = list.length > 0 ? list[list.length - 1]! : "";
  const cached = miniIdSets.get(universe);
  if (cached && cached.length === list.length && cached.tail === tail) {
    return cached.ids;
  }
  const ids = new Set(list);
  miniIdSets.set(universe, { length: list.length, tail, ids });
  return ids;
}

export function isMiniBody(
  universe: UniverseState,
  planet: PlanetState,
): boolean {
  if (planet.kind === "moon") return false;
  if (planet.flags?.mini) return true;
  return miniIdSet(universe).has(planet.id);
}

export interface PlanetArtContext {
  miniSlots: ReadonlyMap<string, readonly number[]>;
}

let cachedArt: {
  universe: UniverseState;
  token: string;
  ctx: PlanetArtContext;
} | null = null;

function artToken(universe: UniverseState): string {
  const ids = universe.miniPlanetIds;
  if (!ids || ids.length === 0) return "0";
  return `${ids.length}:${ids[ids.length - 1]}`;
}

/** Drop the per-isolate art index. Call before a tick that can move minis. */
export function invalidateArtContext(universe?: UniverseState): void {
  if (!universe || cachedArt?.universe === universe) cachedArt = null;
}

export function createPlanetArtContext(
  universe: UniverseState,
): PlanetArtContext {
  const token = artToken(universe);
  if (cachedArt?.universe === universe && cachedArt.token === token) {
    return cachedArt.ctx;
  }
  const lists = new Map<string, number[]>();
  const add = (planet: PlanetState) => {
    if (!isMiniBody(universe, planet)) return;
    const key = `${Math.floor(planet.coords.galaxy)}:${Math.floor(planet.coords.system)}`;
    const list = lists.get(key) ?? [];
    list.push(Math.floor(planet.coords.slot));
    lists.set(key, list);
  };
  for (const id of universe.miniPlanetIds ?? []) {
    const planet = universe.planets[id];
    if (planet) add(planet);
  }
  for (const planet of Object.values(universe.planets)) {
    if (planet.flags?.mini) add(planet);
  }
  const ctx = { miniSlots: lists };
  cachedArt = { universe, token, ctx };
  return ctx;
}

function miniArtAt(
  universe: UniverseState,
  coords: Coordinates,
  ctx: PlanetArtContext,
): PlanetArtRef {
  const galaxy = Math.floor(coords.galaxy);
  const system = Math.floor(coords.system);
  const slot = Math.floor(coords.slot);
  const key = `${galaxy}:${system}`;
  const slots = ctx.miniSlots.get(key) ?? [slot];
  const map = miniArtForSlots(galaxy, system, slots);
  const art = map.get(slot);
  if (!art) throw new Error(`No mini planet art for slot ${slot}.`);
  return art;
}

/** Art for a body. Moons copy the parent id. */
export function artForBody(
  universe: UniverseState,
  planet: PlanetState,
  ctx: PlanetArtContext = createPlanetArtContext(universe),
): PlanetArtRef {
  if (planet.kind === "moon") {
    const parent = planet.parentPlanetId
      ? universe.planets[planet.parentPlanetId]
      : undefined;
    if (parent && parent.id !== planet.id && parent.kind !== "moon") {
      return artForBody(universe, parent, ctx);
    }
    if (poolForSlot(planet.coords.slot)) return normalArtAt(planet.coords);
    return miniArtAt(universe, planet.coords, ctx);
  }
  if (isMiniBody(universe, planet)) {
    return miniArtAt(universe, planet.coords, ctx);
  }
  if (poolForSlot(planet.coords.slot)) return normalArtAt(planet.coords);
  return miniArtAt(universe, planet.coords, ctx);
}
