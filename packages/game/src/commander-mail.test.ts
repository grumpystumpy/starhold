import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDER_MAIL_MAX_CHARS,
  COMMANDER_MAIL_MAX_PER_RECIPIENT,
  COMMANDER_MAIL_RATE_PER_MIN,
} from "./data/tuning.js";
import {
  commanderMailDropIds,
  commanderMailRateError,
  commanderMailSendAllowed,
  normalizeCommanderMailBody,
  resetCommanderMailRateLimit,
  visibleCommanderMail,
} from "./commander-mail.js";

describe("commander mail rules", () => {
  it("rejects empty and over-long bodies and strips controls", () => {
    assert.deepEqual(normalizeCommanderMailBody("  \n"), {
      ok: false,
      error: "Message is empty.",
    });
    assert.deepEqual(normalizeCommanderMailBody(`hi\u0000 there`), {
      ok: true,
      body: "hi there",
    });
    const tooLong = normalizeCommanderMailBody("x".repeat(COMMANDER_MAIL_MAX_CHARS + 1));
    assert.equal(tooLong.ok, false);
    assert.equal(
      normalizeCommanderMailBody("x".repeat(COMMANDER_MAIL_MAX_CHARS)).ok,
      true,
    );
  });

  it("limits sends per sender and drops the oldest inbox rows", () => {
    resetCommanderMailRateLimit();
    const now = 1_700_000_000_000;
    for (let i = 0; i < COMMANDER_MAIL_RATE_PER_MIN; i++) {
      assert.equal(commanderMailSendAllowed("ada", now + i), true);
    }
    assert.equal(commanderMailSendAllowed("ada", now + 10), false);
    assert.equal(commanderMailSendAllowed("bea", now + 10), true);
    assert.equal(
      commanderMailSendAllowed("ada", now + 60_001),
      true,
    );
    assert.match(commanderMailRateError(), /10 messages per minute/);

    const rows = Array.from({ length: COMMANDER_MAIL_MAX_PER_RECIPIENT }, (_, i) => ({
      id: `m${String(i).padStart(3, "0")}`,
      createdAt: now + i,
    }));
    assert.deepEqual(commanderMailDropIds(rows.slice(0, 99)), []);
    assert.deepEqual(commanderMailDropIds(rows), ["m000"]);
    const extra = [...rows, { id: "m100", createdAt: now + 100 }];
    assert.deepEqual(commanderMailDropIds(extra), ["m000", "m001"]);

    const visible = visibleCommanderMail(extra, now + 98);
    assert.equal(visible[0]?.id, "m099");
    assert.equal(visible.at(-1)?.id, "m100");
    assert.equal(visibleCommanderMail(extra).length, COMMANDER_MAIL_MAX_PER_RECIPIENT);
  });
});
