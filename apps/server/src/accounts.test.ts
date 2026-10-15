import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  AUTH_RATE_MAX,
  authenticateEmailPassword,
  checkAuthRateLimit,
  createAccountWithPassword,
  createSession,
  getAccountByEmail,
  getSession,
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  resetMemoryAccounts,
  setAccountPlayerId,
  verifyPassword,
} from "./accounts.js";

describe("accounts memory store", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.STARHOLD_PASSWORD_KDF;
  });

  it("normalizes and validates email / password", () => {
    assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
    assert.equal(isValidEmail("ada@example.com"), true);
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidPassword("short"), false);
    assert.equal(isValidPassword("longenough"), true);
  });

  it("hashes and verifies passwords with scrypt", async () => {
    const hash = await hashPassword("correct-horse");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(await verifyPassword("correct-horse", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });

  it("creates account with password and authenticates", async () => {
    const created = await createAccountWithPassword(
      "pilot@starhold.test",
      "secretpass",
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.account.id.startsWith("acct_"));
    assert.equal(created.account.email, "pilot@starhold.test");
    assert.ok(created.account.passwordHash.startsWith("scrypt$"));

    const dup = await createAccountWithPassword(
      "Pilot@Starhold.test",
      "otherpass1",
    );
    assert.equal(dup.ok, false);

    const bad = await authenticateEmailPassword(
      "pilot@starhold.test",
      "wrongpass",
    );
    assert.equal(bad.ok, false);

    const good = await authenticateEmailPassword(
      "Pilot@Starhold.test",
      "secretpass",
    );
    assert.equal(good.ok, true);
    if (!good.ok) return;
    assert.equal(good.account.id, created.account.id);

    const linked = await setAccountPlayerId(created.account.id, "plyr_test");
    assert.equal(linked?.playerId, "plyr_test");
    const byEmail = await getAccountByEmail("pilot@starhold.test");
    assert.equal(byEmail?.playerId, "plyr_test");
  });

  it("creates sessions that look up by id", async () => {
    const created = await createAccountWithPassword("s@test.dev", "secretpass");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const session = await createSession(created.account.id);
    const found = await getSession(session.id);
    assert.equal(found?.accountId, created.account.id);
  });

  it("round-trips a PBKDF2 hash", async () => {
    process.env.STARHOLD_PASSWORD_KDF = "pbkdf2";
    const hash = await hashPassword("correct-horse");
    assert.ok(hash.startsWith("pbkdf2$"));
    assert.equal(await verifyPassword("correct-horse", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });

  it("rehashes an imported scrypt password to PBKDF2 on first Workers login", async () => {
    const created = await createAccountWithPassword(
      "legacy@starhold.test",
      "secretpass",
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.account.passwordHash.startsWith("scrypt$"));

    process.env.STARHOLD_RUNTIME = "workers";
    const first = await authenticateEmailPassword(
      "legacy@starhold.test",
      "secretpass",
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.ok(first.account.passwordHash.startsWith("pbkdf2$"));
    assert.equal(first.account.passwordHashPbkdf2, first.account.passwordHash);

    const second = await authenticateEmailPassword(
      "legacy@starhold.test",
      "secretpass",
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.account.passwordHash, first.account.passwordHash);

    const wrong = await authenticateEmailPassword(
      "legacy@starhold.test",
      "wrongpass",
    );
    assert.equal(wrong.ok, false);
  });

  it("rate-limits repeated auth attempts", async () => {
    for (let i = 0; i < AUTH_RATE_MAX; i++) {
      const r = await checkAuthRateLimit("login", "rate@test.dev", "1.2.3.4");
      assert.equal(r.limited, false);
    }
    const blocked = await checkAuthRateLimit(
      "login",
      "rate@test.dev",
      "1.2.3.4",
    );
    assert.equal(blocked.limited, true);
    assert.ok(blocked.retryAfterSec >= 1);
  });
});
