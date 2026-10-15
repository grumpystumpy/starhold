import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hashSeed } from "./formulas-position.js";
import {
  COLD_ART_IDS,
  HOT_ART_IDS,
  LUSH_ART_IDS,
  MINI_ART_IDS,
  normalArtAt,
  normalArtForSystem,
  planetArtId,
  poolForSlot,
} from "./planet-art.js";
import type { PlanetState } from "./types.js";
import {
  createUniverse,
  galaxyViewFor,
  joinUniverse,
  playerView,
  setActivePlanet,
} from "./world.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, "../../../apps/web/public/planet-art");

describe("planet art catalog", () => {
  it("loads 24/24/24/36 ids from the committed manifest", () => {
    assert.equal(HOT_ART_IDS.length, 24);
    assert.equal(LUSH_ART_IDS.length, 24);
    assert.equal(COLD_ART_IDS.length, 24);
    assert.equal(MINI_ART_IDS.length, 36);
    assert.equal(new Set([...HOT_ART_IDS, ...LUSH_ART_IDS, ...COLD_ART_IDS, ...MINI_ART_IDS]).size, 108);
  });

  it("serves the same manifest and every master/thumb", () => {
    const gameManifest = readFileSync(
      path.join(here, "data/planet-art-manifest.json"),
      "utf8",
    );
    const publicManifest = readFileSync(
      path.join(publicRoot, "manifest.json"),
      "utf8",
    );
    assert.equal(publicManifest, gameManifest);
    const parsed = JSON.parse(gameManifest) as {
      assets: Array<{ id: string; file: string; thumb: string }>;
    };
    assert.equal(parsed.assets.length, 108);
    for (const asset of parsed.assets) {
      assert.equal(existsSync(path.join(publicRoot, asset.file)), true, asset.file);
      assert.equal(existsSync(path.join(publicRoot, asset.thumb)), true, asset.thumb);
    }
  });
});

describe("planetArtId", () => {
  it("is stable for the same coordinates", () => {
    const coords = { galaxy: 3, system: 88, slot: 7 };
    assert.equal(planetArtId(coords, "normal"), planetArtId(coords, "normal"));
    assert.deepEqual(normalArtAt(coords), normalArtAt(coords));
    assert.equal(
      normalArtForSystem(3, 88)[6]?.artId,
      planetArtId(coords, "normal", new Set(
        normalArtForSystem(3, 88).slice(0, 6).map((art) => art.artId),
      )),
    );
  });

  it("maps slots onto hot, lush, and cold pools", () => {
    const arts = normalArtForSystem(1, 1);
    for (let slot = 1; slot <= 15; slot++) {
      const id = arts[slot - 1]?.artId ?? "";
      const pool = poolForSlot(slot);
      assert.ok(pool);
      assert.equal(pool.includes(id), true, `slot ${slot} -> ${id}`);
      if (slot <= 5) assert.match(id, /^planet-hot-/);
      else if (slot <= 10) assert.match(id, /^planet-lush-/);
      else assert.match(id, /^planet-cold-/);
    }
    const mini = planetArtId({ galaxy: 2, system: 2, slot: 16 }, "mini");
    assert.match(mini, /^mini-/);
    assert.equal(poolForSlot(16), null);
  });

  it("keeps ids unique in a system and on adjacent slots", () => {
    for (const [galaxy, system] of [
      [1, 1],
      [4, 50],
      [10, 399],
    ] as const) {
      const ids = normalArtForSystem(galaxy, system).map((art) => art.artId);
      assert.equal(new Set(ids).size, 15, `${galaxy}:${system}`);
      for (let i = 1; i < ids.length; i++) {
        assert.notEqual(ids[i - 1], ids[i], `${galaxy}:${system} slot ${i}`);
      }
    }
  });

  it("walks to the next id when the hash candidate is taken", () => {
    const coords = { galaxy: 4, system: 9, slot: 2 };
    const raw = planetArtId(coords, "normal");
    const walked = planetArtId(coords, "normal", new Set([raw]));
    assert.notEqual(walked, raw);
    assert.match(walked, /^planet-hot-/);
  });

  it("falls back to the hash index when the pool is exhausted", () => {
    // Best effort: uniqueness cannot be kept once every hot id is blocked,
    // so the original hash index is returned instead of throwing.
    const coords = { galaxy: 1, system: 2, slot: 1 };
    const id = planetArtId(coords, "normal", new Set(HOT_ART_IDS));
    const expected = HOT_ART_IDS[hashSeed("1:2:1") % HOT_ART_IDS.length];
    assert.equal(id, expected);
  });
});

describe("player view art", () => {
  it("derives art from coords and reuses the parent id on moons", () => {
    const universe = createUniverse("Art Drift", 4);
    const joined = joinUniverse(universe, "Painter", 2_000_000);
    const parent = universe.planets[joined.planet.id]!;
    const moonId = "moon_art";
    const moon: PlanetState = {
      ...structuredClone(parent),
      id: moonId,
      name: "Painter Moon",
      kind: "moon",
      parentPlanetId: parent.id,
      moonId: null,
    };
    universe.planets[moonId] = moon;
    parent.moonId = moonId;
    universe.players[joined.player.id]!.planetIds.push(moonId);

    const before = playerView(universe, joined.player.id, 2_000_050);
    const homeArt = before.planetArt.artId;
    assert.match(before.planetArt.artUrl, /^\/planet-art\/.+\.webp$/);
    assert.match(before.planetArt.artThumbUrl, /\/thumbs\/.+\.webp$/);
    assert.equal(
      (universe.planets[parent.id] as PlanetState & { artId?: string }).artId,
      undefined,
    );

    setActivePlanet(universe, joined.player.id, moonId, 2_000_100);
    const asMoon = playerView(universe, joined.player.id, 2_000_100);
    assert.equal(asMoon.planetArt.artId, homeArt);
    const moonRow = asMoon.ownedPlanets.find((row) => row.id === moonId);
    const planetRow = asMoon.ownedPlanets.find((row) => row.id === parent.id);
    assert.ok(moonRow && planetRow);
    assert.equal(moonRow.artId, planetRow.artId);
    assert.equal(moonRow.isMoon, true);

    const again = playerView(universe, joined.player.id, 2_000_200);
    assert.equal(again.planetArt.artId, homeArt);

    const galaxy = galaxyViewFor(
      universe,
      joined.player.id,
      parent.coords.galaxy,
      parent.coords.system,
    );
    assert.equal(galaxy.minis.length, 0);
    const occupied = galaxy.slots.find((slot) => slot.planetId === parent.id);
    assert.ok(occupied);
    assert.equal(occupied.artId, homeArt);
    assert.equal(occupied.hasMoon, true);
    const ids = galaxy.slots.map((slot) => slot.artId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("uses the mini pool for mini bodies without reshuffling other slots", () => {
    const universe = createUniverse("Mini Art", 4);
    const joined = joinUniverse(universe, "Surveyor", 2_100_000);
    const planet = universe.planets[joined.planet.id]!;
    const before = galaxyViewFor(
      universe,
      joined.player.id,
      planet.coords.galaxy,
      planet.coords.system,
    );
    const neighbor = before.slots.find(
      (slot) => slot.coords.slot !== planet.coords.slot,
    )!;

    planet.flags = { mini: true };
    const after = playerView(universe, joined.player.id, 2_100_050);
    assert.match(after.planetArt.artId, /^mini-/);
    const row = after.galaxy.slots.find(
      (slot) => slot.coords.slot === planet.coords.slot,
    );
    assert.equal(row?.isMini, true);
    assert.match(row?.artId ?? "", /^mini-/);
    const neighborAfter = after.galaxy.slots.find(
      (slot) => slot.coords.slot === neighbor.coords.slot,
    );
    assert.equal(neighborAfter?.artId, neighbor.artId);

    const pocketId = "mini_pocket";
    universe.planets[pocketId] = {
      ...structuredClone(planet),
      id: pocketId,
      name: "Pocket",
      kind: "planet",
      flags: { mini: true },
      coords: {
        galaxy: planet.coords.galaxy,
        system: planet.coords.system,
        slot: 16,
      },
      moonId: null,
      parentPlanetId: null,
    };
    universe.miniPlanetIds = [pocketId];
    const galaxy = galaxyViewFor(
      universe,
      joined.player.id,
      planet.coords.galaxy,
      planet.coords.system,
    );
    assert.equal(galaxy.minis.length, 1);
    assert.equal(galaxy.minis[0]?.planetId, pocketId);
    assert.match(galaxy.minis[0]?.artId ?? "", /^mini-/);
    assert.notEqual(galaxy.minis[0]?.artId, row?.artId);
  });
});
