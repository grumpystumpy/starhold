import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  consumeMagicToken,
  createMagicLink,
  createSession,
  getAccountByEmail,
  getSession,
  isValidEmail,
  normalizeEmail,
  resetMemoryAccounts,
  setAccountPlayerId,
  upsertAccountForEmail,
} from "./accounts.js";

describe("accounts memory store", () => {
  beforeEach(() => {
    resetMemoryAccounts();
  });

  it("normalizes and validates email", () => {
    assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
    assert.equal(isValidEmail("ada@example.com"), true);
    assert.equal(isValidEmail("not-an-email"), false);
  });

  it("upserts account by email and links playerId", async () => {
    const a = await upsertAccountForEmail("pilot@starhold.test");
    assert.ok(a.id.startsWith("acct_"));
    assert.equal(a.email, "pilot@starhold.test");
    assert.equal(a.playerId, null);

    const again = await upsertAccountForEmail("Pilot@Starhold.test");
    assert.equal(again.id, a.id);

    const linked = await setAccountPlayerId(a.id, "plyr_test");
    assert.equal(linked?.playerId, "plyr_test");
    const byEmail = await getAccountByEmail("pilot@starhold.test");
    assert.equal(byEmail?.playerId, "plyr_test");
  });

  it("creates and consumes magic tokens once", async () => {
    const { token } = await createMagicLink({
      email: "m@test.dev",
      claimPlayerId: "plyr_1",
    });
    const first = await consumeMagicToken(token);
    assert.ok(first);
    assert.equal(first.email, "m@test.dev");
    assert.equal(first.claimPlayerId, "plyr_1");
    const second = await consumeMagicToken(token);
    assert.equal(second, null);
  });

  it("creates sessions that expire lookup after delete", async () => {
    const account = await upsertAccountForEmail("s@test.dev");
    const session = await createSession(account.id);
    const found = await getSession(session.id);
    assert.equal(found?.accountId, account.id);
  });
});
