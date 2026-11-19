import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MAP_SLOTS } from "./catalog.js";
import type { Coordinates, UniverseState } from "./types.js";
import { migrateOrResetUniverse } from "./world-migrate.js";
import { createUniverse, joinUniverse, playerView } from "./world.js";
import {
  INVITE_MAX,
  INVITE_MINT_INTERVAL_MS,
  INVITE_SYSTEM_RADIUS,
  createInvite,
  nearestInviteSlot,
  resolveInviteCoords,
} from "./world-invite.js";

const NOW = 1_700_000_000_000;
const ZERO = () => 0;

function universe() {
  return createUniverse("Invite", 1, 1, { lazySeed: true });
}

function block(universeState: UniverseState, coords: Coordinates): void {
  const template = Object.values(universeState.planets).find((p) => p.kind !== "moon");
  if (!template) throw new Error("no planet to copy");
  const id = `blk_${coords.galaxy}_${coords.system}_${coords.slot}`;
  universeState.planets[id] = {
    ...template,
    id,
    name: id,
    coords: { ...coords },
    kind: "planet",
    moonId: null,
    parentPlanetId: null,
  };
}

describe("invite a friend nearby", () => {
  it("places the friend on the nearest open slot in the same system", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    const minted = createInvite(uni, home.player.id, NOW, ZERO);
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const coords = resolveInviteCoords(uni, minted.code, NOW);
    assert.deepEqual(coords, { galaxy: 1, system: 1, slot: 5 });
    const friend = joinUniverse(uni, "Near", NOW, coords);
    assert.deepEqual(friend.planet.coords, { galaxy: 1, system: 1, slot: 5 });
    assert.equal(friend.planet.coords.galaxy, home.planet.coords.galaxy);
  });

  it("skips a full nearby system and stays inside the radius", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    for (let slot = 1; slot <= MAP_SLOTS; slot++) {
      if (slot === home.planet.coords.slot) continue;
      block(uni, { galaxy: 1, system: 1, slot });
    }
    const slot = nearestInviteSlot(uni, home.planet.coords);
    assert.deepEqual(slot, { galaxy: 1, system: 2, slot: 4 });
    assert.ok(slot);
    assert.ok(Math.abs(slot!.system - home.planet.coords.system) <= INVITE_SYSTEM_RADIUS);
  });

  it("falls back to nextCoords when the radius is full", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    const origin = home.planet.coords;
    for (let system = origin.system; system <= origin.system + INVITE_SYSTEM_RADIUS; system++) {
      for (let slot = 1; slot <= MAP_SLOTS; slot++) {
        if (system === origin.system && slot === origin.slot) continue;
        block(uni, { galaxy: origin.galaxy, system, slot });
      }
    }
    const minted = createInvite(uni, home.player.id, NOW, ZERO);
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    assert.equal(resolveInviteCoords(uni, minted.code, NOW), null);
    const friend = joinUniverse(uni, "Far", NOW, null);
    assert.equal(friend.planet.coords.system, origin.system + INVITE_SYSTEM_RADIUS + 1);
    assert.ok(
      Math.abs(friend.planet.coords.system - origin.system) > INVITE_SYSTEM_RADIUS,
    );
  });

  it("ignores invalid and expired codes without throwing", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    const minted = createInvite(uni, home.player.id, NOW, ZERO);
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    assert.equal(resolveInviteCoords(uni, "nope", NOW), null);
    assert.equal(resolveInviteCoords(uni, home.player.id, NOW), null);
    assert.equal(resolveInviteCoords(uni, "pilot@example.com", NOW), null);
    assert.equal(resolveInviteCoords(uni, "", NOW), null);
    uni.invites![minted.code]!.expiresAt = NOW - 1;
    assert.equal(resolveInviteCoords(uni, minted.code, NOW), null);
    const friend = joinUniverse(uni, "Quiet", NOW, resolveInviteCoords(uni, "nope", NOW));
    assert.deepEqual(friend.planet.coords, { galaxy: 1, system: 1, slot: 5 });
  });

  it("mints a short code that is not a player id or email and reuses it", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    home.player.accountId = "acct_pilot";
    const email = "pilot@example.com";
    const first = createInvite(uni, home.player.id, NOW, ZERO);
    const second = createInvite(uni, home.player.id, NOW + 5, ZERO);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.code, first.code);
    assert.equal(second.reused, true);
    assert.equal(Object.keys(uni.invites ?? {}).length, 1);
    assert.match(first.code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.equal(first.code.includes(home.player.id), false);
    assert.equal(first.code.includes(email), false);
    assert.equal(first.code.includes("@"), false);
    const link = `/?invite=${first.code}`;
    assert.equal(link.includes(home.player.id), false);
    assert.equal(link.includes(email), false);
    const view = JSON.stringify(playerView(uni, home.player.id, NOW));
    assert.equal(view.includes(first.code), false);
    assert.equal(view.includes('"invites"'), false);
  });

  it("rate-limits a new code and still allows one after the interval", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    const first = createInvite(uni, home.player.id, NOW, ZERO);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    uni.invites![first.code]!.expiresAt = NOW - 1;
    const limited = createInvite(uni, home.player.id, NOW + 1_000, () => 0.5);
    assert.equal(limited.ok, false);
    if (limited.ok) return;
    assert.equal(limited.status, 429);
    uni.invites![first.code]!.createdAt = NOW - INVITE_MINT_INTERVAL_MS - 1;
    const again = createInvite(uni, home.player.id, NOW + 1_000, () => 0.5);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.notEqual(again.code, first.code);
    assert.equal(again.reused, false);
  });

  it("refuses a mint when the invite map is full of live codes", () => {
    const uni = universe();
    const home = joinUniverse(uni, "Host", NOW);
    uni.invites = {};
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (let i = 0; i < INVITE_MAX; i++) {
      let n = i + 1;
      let code = "";
      for (let k = 0; k < 8; k++) {
        code += alphabet[n % alphabet.length];
        n = Math.floor(n / alphabet.length);
      }
      uni.invites[code] = {
        code,
        playerId: `other_${i}`,
        createdAt: NOW - 5_000,
        expiresAt: NOW + 60_000,
      };
    }
    const blocked = createInvite(uni, home.player.id, NOW, ZERO);
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.status, 429);
    assert.equal(Object.keys(uni.invites).length, INVITE_MAX);
  });

  it("honors a free preferred slot and ignores an occupied one", () => {
    const uni = universe();
    joinUniverse(uni, "Host", NOW);
    const preferred = { galaxy: 2, system: 9, slot: 7 };
    const placed = joinUniverse(uni, "Pinned", NOW, preferred);
    assert.deepEqual(placed.planet.coords, preferred);
    const fallback = joinUniverse(uni, "Bumped", NOW, preferred);
    assert.notDeepEqual(fallback.planet.coords, preferred);
    assert.deepEqual(fallback.planet.coords, { galaxy: 1, system: 1, slot: 5 });
  });

  it("loads a main-branch in-flight save without invites or a reset", () => {
    const path = fileURLToPath(
      new URL("./fixtures/in-flight-fleet-save.json", import.meta.url),
    );
    const before = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    assert.equal(before.invites, undefined);
    const fleetId = Object.keys(before.fleets)[0]!;
    const saved = before.fleets[fleetId]!;
    const loaded = migrateOrResetUniverse(structuredClone(before));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.invites, undefined);
    assert.equal(loaded.universe.fleets[fleetId]!.ships.scout, saved.ships.scout);
    assert.equal(loaded.universe.fleets[fleetId]!.phase, saved.phase);
    assert.equal(loaded.universe.fleets[fleetId]!.mission, saved.mission);
    const owner = loaded.universe.players[saved.ownerPlayerId]!;
    assert.equal(owner.name, "Hold");
    const home = loaded.universe.planets[owner.homePlanetId]!;
    assert.equal(home.buildings.metalMine, before.planets[owner.homePlanetId]!.buildings.metalMine);
    assert.equal(home.resources.metal, before.planets[owner.homePlanetId]!.resources.metal);
  });
});
