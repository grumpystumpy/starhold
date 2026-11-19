import {
  HOME_SLOT_PREFERENCE,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
} from "./catalog.js";
import { planetAtCoords } from "./planet-index.js";
import type { Coordinates, PlanetState, UniverseState } from "./types.js";

/** Unambiguous alphabet: no 0/O/1/I. Not a player id and not an email. */
const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const INVITE_CODE_LENGTH = 8;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_SYSTEM_RADIUS = 12;
export const INVITE_MAX = 64;
/** New codes only. Copying a live code does not mint and does not wait. */
export const INVITE_MINT_INTERVAL_MS = 60_000;

export type InviteMintResult =
  | { ok: true; code: string; expiresAt: number; reused: boolean }
  | { ok: false; status: 400 | 429; error: string };

export function inviteSlotOpen(
  universe: UniverseState,
  coords: Coordinates | null | undefined,
): coords is Coordinates {
  if (!coords) return false;
  if (
    !Number.isInteger(coords.galaxy) ||
    !Number.isInteger(coords.system) ||
    !Number.isInteger(coords.slot)
  ) {
    return false;
  }
  if (coords.galaxy < 1 || coords.galaxy > MAP_GALAXIES) return false;
  if (coords.system < 1 || coords.system > MAP_SYSTEMS) return false;
  if (coords.slot < 1 || coords.slot > MAP_SLOTS) return false;
  return planetAtCoords(universe, coords) == null;
}

function normalizeInviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!INVITE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

function mintCode(random: () => number): string {
  let code = "";
  const span = INVITE_ALPHABET.length;
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    const n = Math.floor(random() * span);
    const idx = Math.min(span - 1, Math.max(0, n));
    code += INVITE_ALPHABET[idx];
  }
  return code;
}

function homePlanet(universe: UniverseState, playerId: string): PlanetState | null {
  const player = universe.players[playerId];
  if (!player) return null;
  const home = universe.planets[player.homePlanetId];
  if (home && home.kind !== "moon") return home;
  const parentId = home?.parentPlanetId;
  const parent = parentId ? universe.planets[parentId] : null;
  if (parent && parent.kind !== "moon") return parent;
  return null;
}

/**
 * Nearest open non-moon slot in the inviter's galaxy, within
 * `INVITE_SYSTEM_RADIUS` systems. Null when the neighborhood is full.
 */
export function nearestInviteSlot(
  universe: UniverseState,
  origin: Coordinates,
): Coordinates | null {
  for (let dist = 0; dist <= INVITE_SYSTEM_RADIUS; dist++) {
    const systems =
      dist === 0
        ? [origin.system]
        : [origin.system - dist, origin.system + dist];
    for (const system of systems) {
      if (system < 1 || system > MAP_SYSTEMS) continue;
      for (const slot of HOME_SLOT_PREFERENCE) {
        if (slot < 1 || slot > MAP_SLOTS) continue;
        const coords = { galaxy: origin.galaxy, system, slot };
        if (planetAtCoords(universe, coords) == null) return coords;
      }
    }
  }
  return null;
}

/**
 * Valid code → nearest open slot. Invalid, expired, missing inviter,
 * or a full neighborhood → null so join keeps today's placement.
 * Does not write the save and does not run on the state poll.
 */
export function resolveInviteCoords(
  universe: UniverseState,
  rawCode: string,
  now: number,
): Coordinates | null {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  const rec = universe.invites?.[code];
  if (!rec || rec.expiresAt <= now || rec.playerId.length === 0) return null;
  const home = homePlanet(universe, rec.playerId);
  if (!home) return null;
  return nearestInviteSlot(universe, home.coords);
}

/**
 * One live code per commander. A second call inside the TTL returns the
 * same code. Minting is refused until the interval after the last mint.
 * Prunes only here — never on page load.
 */
export function createInvite(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
  random: () => number = Math.random,
): InviteMintResult {
  if (!universe.players[playerId]) {
    return {
      ok: false,
      status: 400,
      error: "Pick a commander before inviting a friend.",
    };
  }
  const mine = Object.values(universe.invites ?? {}).filter(
    (rec) => rec.playerId === playerId,
  );
  const live = mine
    .filter((rec) => rec.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (live) {
    return { ok: true, code: live.code, expiresAt: live.expiresAt, reused: true };
  }
  const newest = mine.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (newest && now - newest.createdAt < INVITE_MINT_INTERVAL_MS) {
    return {
      ok: false,
      status: 429,
      error: "Invite links are limited. Try again shortly.",
    };
  }

  if (!universe.invites) universe.invites = {};
  for (const rec of mine) delete universe.invites[rec.code];
  for (const [code, rec] of Object.entries(universe.invites)) {
    if (rec.expiresAt <= now) delete universe.invites[code];
  }
  if (Object.keys(universe.invites).length >= INVITE_MAX) {
    return {
      ok: false,
      status: 429,
      error: "Invite links are limited. Try again shortly.",
    };
  }

  let code = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    code = mintCode(random);
    if (!universe.invites[code]) break;
  }
  if (!code || universe.invites[code]) {
    return {
      ok: false,
      status: 429,
      error: "Invite links are limited. Try again shortly.",
    };
  }
  const expiresAt = now + INVITE_TTL_MS;
  universe.invites[code] = { code, playerId, createdAt: now, expiresAt };
  return { ok: true, code, expiresAt, reused: false };
}
