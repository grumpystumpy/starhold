import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse } from "@starhold/game";
import {
  planImportRows,
  summarizeExport,
  upsertClaimCodeUnlessClaimed,
  upsertPreservingClaimedAccount,
} from "./transfer-plan.js";

describe("KV to D1 transfer plan", () => {
  it("counts a universe, drops imported password hashes, and skips sessions", () => {
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
          passwordHashPbkdf2: "pbkdf2$10000$salt$hash",
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
        key: "starhold:account:acct_2",
        value: {
          id: "acct_2",
          email: "bee@starhold.test",
          passwordHash: "pbkdf2$10000$salt$hash",
        },
        ttlSec: null,
      },
      {
        key: "starhold:session:abc",
        value: { id: "abc", accountId: "acct_1" },
        ttlSec: 100,
      },
      { key: "starhold:universe:v5:lock", value: "1", ttlSec: 8 },
    ];
    const counts = summarizeExport(rows, { claimCodeRows: true });
    assert.equal(counts.accounts, 2);
    assert.equal(counts.players, 1);
    assert.equal(counts.planets, Object.keys(universe.planets).length);
    assert.equal(counts.fleets, 1);
    assert.equal(counts.messages, 1);
    assert.equal(counts.alliances, 1);
    assert.equal(counts.scryptHashes, 1);
    assert.equal(counts.pbkdf2Hashes, 2);
    assert.equal(counts.needsPasswordReset, 2);
    assert.equal(counts.sessions, 1);
    assert.equal(
      counts.d1Rows,
      planImportRows(rows, 0).length + counts.needsPasswordReset,
    );

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
    const imported = account!.value as {
      passwordHash: string;
      needsPasswordReset?: boolean;
      passwordHashPbkdf2?: string;
      playerId: string;
    };
    assert.equal(imported.passwordHash, "");
    assert.equal(imported.needsPasswordReset, true);
    assert.equal(imported.passwordHashPbkdf2, undefined);
    assert.equal(imported.playerId, player.id);
    assert.equal(
      planned.some((row) => row.key.endsWith(":lock")),
      false,
    );
    assert.equal(
      planned.some((row) => row.key.startsWith("starhold:session:")),
      false,
    );
  });

  it("leaves a claimed Workers password in place and still refreshes a reset account", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
    );
    db.prepare("INSERT INTO kv (key, value, expires_at) VALUES (?, ?, NULL)").run(
      "starhold:account:claimed",
      JSON.stringify({
        id: "claimed",
        email: "claimed@starhold.test",
        passwordHash: "pbkdf2$kept",
        needsPasswordReset: false,
      }),
    );
    db.prepare("INSERT INTO kv (key, value, expires_at) VALUES (?, ?, NULL)").run(
      "starhold:account:waiting",
      JSON.stringify({
        id: "waiting",
        email: "waiting@starhold.test",
        passwordHash: "",
        needsPasswordReset: true,
      }),
    );
    const resetPayload = JSON.stringify({
      id: "claimed",
      email: "claimed@starhold.test",
      passwordHash: "",
      needsPasswordReset: true,
    });
    for (const sql of upsertPreservingClaimedAccount(
      "starhold:account:claimed",
      resetPayload,
      null,
    )) {
      db.exec(sql);
    }
    for (const sql of upsertClaimCodeUnlessClaimed(
      "starhold:account:claimed",
      "starhold:claim-code:claimed",
      JSON.stringify({ accountId: "claimed", codeHash: "abc", expiresAt: 1 }),
      1,
    )) {
      db.exec(sql);
    }
    const waitingPayload = JSON.stringify({
      id: "waiting",
      email: "waiting@starhold.test",
      passwordHash: "",
      needsPasswordReset: true,
      touched: true,
    });
    for (const sql of upsertPreservingClaimedAccount(
      "starhold:account:waiting",
      waitingPayload,
      null,
    )) {
      db.exec(sql);
    }
    for (const sql of upsertClaimCodeUnlessClaimed(
      "starhold:account:waiting",
      "starhold:claim-code:waiting",
      JSON.stringify({ accountId: "waiting", codeHash: "def", expiresAt: 2 }),
      2,
    )) {
      db.exec(sql);
    }
    const claimed = db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get("starhold:account:claimed") as { value: string };
    assert.equal(JSON.parse(claimed.value).passwordHash, "pbkdf2$kept");
    assert.equal(
      db.prepare("SELECT key FROM kv WHERE key = ?").get("starhold:claim-code:claimed"),
      undefined,
    );
    const waiting = db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get("starhold:account:waiting") as { value: string };
    assert.equal(JSON.parse(waiting.value).touched, true);
    const code = db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get("starhold:claim-code:waiting") as { value: string };
    assert.equal(JSON.parse(code.value).codeHash, "def");
    db.close();
  });
});
