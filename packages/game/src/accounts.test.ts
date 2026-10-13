import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimPlayerToAccount,
  createUniverse,
  joinUniverse,
  playerForAccount,
} from "./index.js";

describe("claimPlayerToAccount", () => {
  it("links anonymous player to account once", () => {
    const universe = createUniverse("Test", 8);
    const { player } = joinUniverse(universe, "Guest", 1_000);
    const ok = claimPlayerToAccount(universe, player.id, "acct_1");
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.player.accountId, "acct_1");
    assert.equal(playerForAccount(universe, "acct_1")?.id, player.id);

    const again = claimPlayerToAccount(universe, player.id, "acct_1");
    assert.equal(again.ok, true);

    const other = claimPlayerToAccount(universe, player.id, "acct_2");
    assert.equal(other.ok, false);
    if (other.ok) return;
    assert.equal(other.code, "already_claimed");
  });

  it("rejects second player for same account", () => {
    const universe = createUniverse("Test", 8);
    const a = joinUniverse(universe, "Alpha", 2_000);
    const b = joinUniverse(universe, "Bravo", 2_001);
    assert.equal(claimPlayerToAccount(universe, a.player.id, "acct_x").ok, true);
    const conflict = claimPlayerToAccount(universe, b.player.id, "acct_x");
    assert.equal(conflict.ok, false);
    if (conflict.ok) return;
    assert.equal(conflict.code, "conflict");
  });
});
