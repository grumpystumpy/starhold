import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFENSE_ORDER, SHIP_ORDER, UNIVERSE_SCHEMA_VERSION, playerView } from "@starhold/game";
import { fileURLToPath } from "node:url";
import { resetMemoryUniverse, withUniverseRead } from "./store.js";
import { runWithScope } from "./request-context.js";
import type { KvStore } from "./kv.js";

describe("catalog-complete old save fixture", () => {
  it("loads through the store path and preserves every catalog count", async () => {
    const path = fileURLToPath(new URL("./fixtures/catalog-complete-save.json", import.meta.url));
    const fixture = JSON.parse(readFileSync(path, "utf8")) as {
      universe: { id: string; schemaVersion: number; planets: Record<string, { defenses: Record<string, number> }>; fleets: Record<string, { ships: Record<string, number> }> };
      planetId: string;
    };
    const planet = fixture.universe.planets[fixture.planetId];
    const fleet = fixture.universe.fleets["fixture-fleet"];
    assert.ok(planet, "fixture planet exists");
    assert.ok(fleet, "fixture fleet exists");
    for (const id of SHIP_ORDER) {
      if (id === "fastCargo" || id === "bulkCargo") continue;
      assert.ok(Object.hasOwn(fleet.ships, id), `fixture missing fleet ship ${id}`);
    }
    for (const id of DEFENSE_ORDER) {
      if (id === "prismLaser") {
        assert.ok(!Object.hasOwn(planet.defenses, id), "raw fixture unexpectedly has prismLaser");
      } else {
        assert.ok(Object.hasOwn(planet.defenses, id), `fixture missing defense ${id}`);
      }
    }

    const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
    const values = new Map<string, unknown>([[key, fixture.universe], [`${key}:ver`, "fixture-v1"]]);
    const store: KvStore = {
      async get<T>(requested: string) { return (values.get(requested) as T | undefined) ?? null; },
      async set() { return "OK"; },
      async del() {},
    };
    resetMemoryUniverse();
    try {
      const counts = await runWithScope(
        { kv: store, mode: "upstash", method: "GET", cpuMs: 0 },
        () => withUniverseRead((universe) => {
          const loaded = universe.planets[fixture.planetId];
          return {
            ships: Object.fromEntries(SHIP_ORDER.map((id) => [id, universe.fleets["fixture-fleet"]?.ships[id] ?? 0])),
            defenses: Object.fromEntries(DEFENSE_ORDER.map((id) => [id, loaded.defenses[id]])),
          };
        }),
      );
      for (const id of SHIP_ORDER) {
        const expected = id === "fastCargo" || id === "bulkCargo" ? 0 : fleet.ships[id];
        assert.equal(counts.ships[id], expected, `fleet ship ${id} count preserved`);
      }
      for (const id of DEFENSE_ORDER) {
        if (id === "prismLaser") assert.equal(counts.defenses[id], 0, "missing prismLaser defaults to zero");
        else assert.equal(counts.defenses[id], fixture.universe.planets[fixture.planetId].defenses[id], `defense ${id} count preserved`);
      }
    } finally {
      resetMemoryUniverse();
    }
  });

  it("loads an old alliance with no pendingRequests and keeps the empire", async () => {
    const path = fileURLToPath(new URL("./fixtures/catalog-complete-save.json", import.meta.url));
    const fixture = JSON.parse(readFileSync(path, "utf8")) as {
      universe: {
        id: string;
        players: Record<string, {
          id: string;
          research: unknown;
          officers?: unknown;
          skillsUnlocked?: unknown;
          starshards?: number;
          allianceId?: string | null;
        }>;
        planets: Record<string, { id: string; defenses: Record<string, number> }>;
        fleets: Record<string, { ships: Record<string, number> }>;
        alliances?: Record<string, unknown>;
      };
      planetId: string;
    };
    const universe = structuredClone(fixture.universe);
    const player = Object.values(universe.players)[0]!;
    const research = player.research as Record<string, number>;
    research.weaponsTech = 4;
    player.starshards = 11;
    const before = {
      planetIds: Object.keys(universe.planets).sort(),
      ships: { ...universe.fleets["fixture-fleet"]!.ships },
      defenses: { ...universe.planets[fixture.planetId]!.defenses },
      research: structuredClone(player.research),
      officers: structuredClone(player.officers ?? []),
      skills: structuredClone(player.skillsUnlocked ?? []),
      starshards: player.starshards ?? 0,
    };
    universe.alliances = {
      ally_old: {
        id: "ally_old",
        name: "Old Guard",
        tag: "OLD",
        joinMode: "open",
        createdAt: 1,
        founderPlayerId: player.id,
        members: {
          [player.id]: { playerId: player.id, role: "founder", joinedAt: 1 },
        },
      },
    };
    player.allianceId = "ally_old";

    const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
    const values = new Map<string, unknown>([[key, universe], [`${key}:ver`, "fixture-ally"]]);
    const store: KvStore = {
      async get<T>(requested: string) { return (values.get(requested) as T | undefined) ?? null; },
      async set() { return "OK"; },
      async del() {},
    };
    resetMemoryUniverse();
    try {
      const loaded = await runWithScope(
        { kv: store, mode: "upstash", method: "GET", cpuMs: 0 },
        () => withUniverseRead((live) => {
          const view = playerView(live, player.id);
          const home = live.planets[fixture.planetId];
          return {
            planetIds: Object.keys(live.planets).sort(),
            ships: { ...live.fleets["fixture-fleet"]!.ships },
            defenses: { ...home.defenses },
            research: view.player.research,
            officers: view.player.officers ?? [],
            skills: view.player.skillsUnlocked ?? [],
            starshards: view.player.starshards ?? 0,
            allianceId: view.player.allianceId,
            tag: view.alliance?.tag ?? null,
            role: view.alliance?.myRole ?? null,
          };
        }),
      );
      assert.ok(loaded.planetIds.length >= before.planetIds.length);
      for (const id of before.planetIds) {
        assert.ok(loaded.planetIds.includes(id), `lost planet ${id}`);
      }
      for (const id of SHIP_ORDER) {
        assert.equal(loaded.ships[id] ?? 0, before.ships[id] ?? 0, `ship ${id}`);
      }
      for (const id of DEFENSE_ORDER) {
        assert.equal(loaded.defenses[id] ?? 0, before.defenses[id] ?? 0, `defense ${id}`);
      }
      const beforeResearch = before.research as Record<string, number>;
      const loadedResearch = loaded.research as Record<string, number>;
      for (const [id, level] of Object.entries(beforeResearch)) {
        assert.equal(loadedResearch[id], level, `lost research ${id}`);
      }
      assert.ok(
        Object.keys(loadedResearch).length >= Object.keys(beforeResearch).length,
        "research catalog shrank",
      );
      assert.deepEqual(loaded.officers, before.officers);
      assert.deepEqual(loaded.skills, before.skills);
      assert.equal(loaded.starshards, before.starshards);
      assert.equal(loaded.allianceId, "ally_old");
      assert.equal(loaded.tag, "OLD");
      assert.equal(loaded.role, "founder");
    } finally {
      resetMemoryUniverse();
    }
  });
});
