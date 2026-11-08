import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  UNIVERSE_SCHEMA_VERSION,
  advanceUniverse,
  bindTickBudget,
} from "@starhold/game";
import type { UniverseState } from "@starhold/game";
import {
  authenticateEmailPassword,
  getAccountById,
  type AccountRecord,
} from "./accounts.js";
import { runWithScope } from "./request-context.js";
import { resetMemoryUniverse, withUniverseRead } from "./store.js";
import type { KvStore } from "./kv.js";

const FIXTURE_PEPPER = "fixture-pre-oauth-pepper";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(fixturePath(name), "utf8")) as T;
}

function memoryStore(seed: Map<string, unknown>): KvStore {
  const values = new Map(seed);
  return {
    async get<T>(requested: string) {
      return (values.get(requested) as T | undefined) ?? null;
    },
    async set(key: string, value: unknown) {
      values.set(key, value);
      return "OK";
    },
    async del(key: string) {
      values.delete(key);
    },
  };
}

describe("cross-version account and blob load", () => {
  it("loads pre-row and pre-boss blobs through the universe reader", async () => {
    const cases = [
      {
        file: "pre-row-save.json",
        id: "uni_fixture_pre_row",
        planetId: "plnt_fixture_row",
        playerId: "plyr_fixture_row",
        metal: 123456,
        metalMine: 7,
        energyTech: 3,
        fleetId: "flt_fixture_outbound",
        ship: "scout" as const,
        shipCount: 4,
        queueId: "q_fixture_metal",
      },
      {
        file: "pre-onboarding-boss-save.json",
        id: "uni_fixture_pre_boss",
        planetId: "plnt_fixture_boss",
        playerId: "plyr_fixture_boss",
        metal: 777001,
        metalMine: 3,
        energyTech: 1,
        fleetId: "flt_pre_boss",
        ship: "hauler" as const,
        shipCount: 9,
        queueId: "q_pre_boss_lab",
      },
    ];

    for (const item of cases) {
      const raw = readJson<UniverseState>(item.file);
      const key = `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
      const store = memoryStore(
        new Map<string, unknown>([
          [key, raw],
          [`${key}:ver`, `fixture-${item.id}`],
        ]),
      );
      resetMemoryUniverse();
      try {
        const loaded = await runWithScope(
          { kv: store, mode: "upstash", method: "GET", cpuMs: 0 },
          () =>
            withUniverseRead((universe) => {
              const planet = universe.planets[item.planetId];
              const player = universe.players[item.playerId];
              if (!planet || !player) throw new Error(`missing ${item.id}`);
              bindTickBudget(() => ({
                raids: 0,
                levelUps: 0,
                fleets: 0,
                driftSteps: 0,
                seedSystems: 0,
                seedMinis: 0,
                seedPirates: 0,
                lazyPlanets: true,
              }));
              try {
                advanceUniverse(universe, planet.lastTickAt + 1000);
              } finally {
                bindTickBudget(() => undefined);
              }
              return {
                id: universe.id,
                schemaVersion: universe.schemaVersion,
                metal: universe.planets[item.planetId]!.resources.metal,
                metalMine: universe.planets[item.planetId]!.buildings.metalMine,
                queueId: universe.planets[item.planetId]!.buildQueue[0]?.id,
                energyTech: universe.players[item.playerId]!.research.energyTech,
                onboarding: universe.players[item.playerId]!.onboarding,
                ships: universe.fleets[item.fleetId]?.ships[item.ship] ?? 0,
                phase: universe.fleets[item.fleetId]?.phase,
              };
            }),
        );
        assert.equal(loaded.id, item.id, item.file);
        assert.equal(loaded.schemaVersion, UNIVERSE_SCHEMA_VERSION);
        assert.ok(loaded.metal >= item.metal, item.file);
        assert.equal(loaded.metalMine, item.metalMine);
        assert.equal(loaded.queueId, item.queueId);
        assert.equal(loaded.energyTech, item.energyTech);
        assert.equal(loaded.onboarding, undefined);
        assert.equal(loaded.ships, item.shipCount);
        assert.equal(loaded.phase, "outbound");
      } finally {
        resetMemoryUniverse();
      }
    }
  });

  it("loads a pre-OAuth account and still accepts its password", async () => {
    const account = readJson<AccountRecord>("pre-oauth-account.json");
    assert.equal(account.sessionEpoch, undefined);
    assert.equal(account.recoveryCodeHashes, undefined);
    assert.equal("oauth" in account, false);
    const store = memoryStore(
      new Map<string, unknown>([
        [`starhold:account:${account.id}`, structuredClone(account)],
        [`starhold:email:${account.email}`, account.id],
      ]),
    );
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = FIXTURE_PEPPER;
    try {
      const result = await runWithScope(
        { kv: store, mode: "upstash", method: "POST", cpuMs: 0 },
        async () => {
          const loaded = await getAccountById(account.id);
          const good = await authenticateEmailPassword(
            account.email,
            "fixture-old-pass",
            account.lastLoginAt + 1000,
          );
          const bad = await authenticateEmailPassword(
            account.email,
            "wrong-password",
            account.lastLoginAt + 2000,
          );
          const after = await getAccountById(account.id);
          return { loaded, good, bad, after };
        },
      );
      assert.ok(result.loaded);
      assert.equal(result.loaded.email, "old.commander@example.test");
      assert.equal(result.loaded.playerId, "plyr_fixture_row");
      assert.equal(result.loaded.passwordHash, account.passwordHash);
      assert.equal(result.loaded.sessionEpoch, undefined);
      assert.equal(result.good.ok, true);
      assert.equal(result.bad.ok, false);
      assert.ok(result.after);
      assert.equal(result.after.passwordHash, account.passwordHash);
      assert.equal(result.after.playerId, account.playerId);
      assert.equal(result.after.email, account.email);
    } finally {
      if (previous == null) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });
});
