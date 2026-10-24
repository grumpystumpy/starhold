import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFENSE_ORDER, SHIP_ORDER, UNIVERSE_SCHEMA_VERSION } from "@starhold/game";
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
});
