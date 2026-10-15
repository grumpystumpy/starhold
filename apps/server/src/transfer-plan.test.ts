import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse } from "@starhold/game";
import { planImportRows, summarizeExport } from "./transfer-plan.js";

describe("KV to D1 transfer plan", () => {
  it("counts a universe and splits it into player rows without dropping hashes", () => {
    const universe = createUniverse("Transfer", 1, 1, { lazySeed: true });
    const { player } = joinUniverse(universe, "Ada");
    universe.planets[player.homePlanetId]!.resources.metal = 1234;
    universe.fleets.f1 = {
      id: "f1",
      ownerPlayerId: player.id,
      originPlanetId: player.homePlanetId,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { galaxy: 1, system: 1, slot: 2 },
      mission: "expedition",
      ships: universe.planets[player.homePlanetId]!.ships,
      cargo: { metal: 1, crystal: 0, deuterium: 0 },
      departedAt: 1,
      arrivesAt: 2,
      phase: "outbound",
      reportId: null,
    };
    player.eventLog = [
      {
        id: "e1",
        kind: "fleetReturn",
        createdAt: 1,
        readAt: null,
        title: "Home",
        body: "Back",
      },
    ];
    universe.alliances = {
      a1: {
        id: "a1",
        name: "Drift",
        tag: "DRF",
        joinMode: "open",
        createdAt: 1,
        founderPlayerId: player.id,
        members: {},
      },
    };
    const rows = [
      { key: "starhold:universe:v5", value: universe, ttlSec: null },
      {
        key: "starhold:account:acct_1",
        value: {
          id: "acct_1",
          email: "ada@starhold.test",
          passwordHash: "scrypt$salt$hash",
          playerId: player.id,
        },
        ttlSec: null,
      },
      {
        key: "starhold:email:ada@starhold.test",
        value: "acct_1",
        ttlSec: null,
      },
      {
        key: "starhold:session:abc",
        value: { id: "abc", accountId: "acct_1" },
        ttlSec: 100,
      },
      { key: "starhold:universe:v5:lock", value: "1", ttlSec: 8 },
    ];
    const counts = summarizeExport(rows);
    assert.equal(counts.accounts, 1);
    assert.equal(counts.players, 1);
    assert.equal(counts.planets, Object.keys(universe.planets).length);
    assert.equal(counts.fleets, 1);
    assert.equal(counts.messages, 1);
    assert.equal(counts.alliances, 1);
    assert.equal(counts.scryptHashes, 1);
    assert.equal(counts.pbkdf2Hashes, 0);
    assert.equal(counts.sessions, 1);

    const planned = planImportRows(rows, 1_000);
    const again = planImportRows(rows, 1_000);
    assert.deepEqual(
      planned.map((row) => row.key),
      again.map((row) => row.key),
    );
    const playerRow = planned.find((row) => row.key.endsWith(`:player:${player.id}`));
    assert.ok(playerRow);
    const slice = playerRow!.value as {
      player: { eventLog: unknown[] };
      planets: Record<string, { resources: { metal: number } }>;
      fleets: Record<string, unknown>;
    };
    assert.equal(slice.planets[player.homePlanetId]!.resources.metal, 1234);
    assert.equal(slice.player.eventLog.length, 1);
    assert.equal(Object.keys(slice.fleets).length, 1);
    const account = planned.find((row) => row.key === "starhold:account:acct_1");
    assert.equal(
      (account!.value as { passwordHash: string }).passwordHash,
      "scrypt$salt$hash",
    );
    assert.equal(
      planned.some((row) => row.key.endsWith(":lock")),
      false,
    );
    const session = planned.find((row) => row.key === "starhold:session:abc");
    assert.equal(session?.expiresAt, 1_000 + 100_000);
  });
});
