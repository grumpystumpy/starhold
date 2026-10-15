import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  AUTH_RATE_MAX,
  authenticateEmailPassword,
  checkAuthRateLimit,
  claimNewPassword,
  createAccountWithPassword,
  createSession,
  getAccountByEmail,
  getSession,
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  preparePasswordClaim,
  requestClaimCode,
  resetMemoryAccounts,
  sessionSecret,
  setAccountPlayerId,
  verifyPassword,
} from "./accounts.js";
import {
  buildImportClaimCodes,
  formatClaimCodeFile,
  hashClaimCode,
} from "./claim-code.js";

describe("accounts memory store", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_RUNTIME;
    delete process.env.STARHOLD_PASSWORD_KDF;
    delete process.env.CLAIM_MAIL_URL;
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

  it("sets a PBKDF2 password from a one-time claim code", async () => {
    process.env.STARHOLD_RUNTIME = "workers";
    process.env.STARHOLD_PASSWORD_KDF = "pbkdf2";
    const created = await createAccountWithPassword(
      "legacy@starhold.test",
      "secretpass",
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const now = 1_700_000_000_000;
    const prepared = await preparePasswordClaim("legacy@starhold.test", now);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.code.length, 8);
    assert.notEqual(
      prepared.code,
      hashClaimCode(prepared.code, sessionSecret()),
    );

    await requestClaimCode("legacy@starhold.test", now);
    const blocked = await authenticateEmailPassword(
      "legacy@starhold.test",
      "secretpass",
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /claim code/);

    const wrong = await claimNewPassword(
      "legacy@starhold.test",
      "ZZZZZZZZ",
      "new-password",
      now,
    );
    assert.equal(wrong.ok, false);

    const claimed = await claimNewPassword(
      "Legacy@Starhold.test",
      prepared.code.toLowerCase(),
      "new-password",
      now + 1_000,
    );
    assert.equal(claimed.ok, true);
    if (!claimed.ok) return;
    assert.ok(claimed.account.passwordHash.startsWith("pbkdf2$"));
    assert.equal(claimed.account.needsPasswordReset, false);
    assert.equal(claimed.account.passwordHashPbkdf2, undefined);

    const again = await claimNewPassword(
      "legacy@starhold.test",
      prepared.code,
      "other-password",
      now + 2_000,
    );
    assert.equal(again.ok, false);

    const login = await authenticateEmailPassword(
      "legacy@starhold.test",
      "new-password",
      now + 3_000,
    );
    assert.equal(login.ok, true);
  });

  it("rejects an expired claim code", async () => {
    const created = await createAccountWithPassword(
      "late@starhold.test",
      "secretpass",
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const now = 1_700_000_000_000;
    const prepared = await preparePasswordClaim("late@starhold.test", now);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const expired = await claimNewPassword(
      "late@starhold.test",
      prepared.code,
      "new-password",
      now + 30 * 60 * 1000,
    );
    assert.equal(expired.ok, false);
  });

  it("keeps import claim codes out of the stored record", () => {
    const [row] = buildImportClaimCodes(
      [{ id: "acct_1", email: "ada@starhold.test" }],
      "workers-pepper",
      0,
    );
    assert.ok(row);
    assert.equal(row!.code.length, 8);
    assert.equal("code" in row!.record, false);
    assert.notEqual(row!.record.codeHash, row!.code);
    const file = formatClaimCodeFile([row!], 0);
    assert.match(file, /ada@starhold\.test/);
    assert.match(file, new RegExp(row!.code));
    assert.match(file, /Do not commit/);
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
