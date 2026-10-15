import assert from "node:assert/strict";
import { randomBytes, scrypt } from "node:crypto";
import { describe, it } from "node:test";
import {
  finishScryptJob,
  startScryptJob,
  stepScryptJob,
} from "./scrypt-step.js";

describe("resumable scrypt", () => {
  it("matches Node scrypt and finishes in slices under 10 ms", async () => {
    const salt = randomBytes(16);
    const password = "pepper:secretpass";
    const derived = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const encoded = `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
    const job = await startScryptJob(password, encoded);
    assert.ok(job);
    if (!job) return;
    let steps = 0;
    let finished = false;
    while (!finished && steps < 80) {
      const started = performance.now();
      finished = stepScryptJob(job, 6);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 10, `slice took ${elapsed.toFixed(1)} ms`);
      steps += 1;
    }
    assert.equal(finished, true);
    assert.ok(steps > 1);
    assert.equal(await finishScryptJob(job), true);

    const wrong = await startScryptJob("other", encoded);
    assert.ok(wrong);
    if (!wrong) return;
    while (!stepScryptJob(wrong, 20)) {
      // drain
    }
    assert.equal(await finishScryptJob(wrong), false);
  });
});
