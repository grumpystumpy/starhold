/**
 * One Durable Object per in-flight scrypt login. The 16 MB SMix buffer
 * stays in memory (not D1). Each fetch does about 6 ms of CPU, under the
 * free-plan cap, and the account row is rewritten to PBKDF2 when it matches.
 */
import {
  finishScryptJob,
  startScryptJob,
  stepScryptJob,
  type ScryptJob,
} from "../apps/server/src/scrypt-step.js";

const STEP_MS = 6;

export class ScryptMigrate {
  #job: ScryptJob | null = null;

  constructor(_state: unknown, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      password?: string;
      encoded?: string;
    };
    const password = body.password ?? "";
    const encoded = body.encoded ?? "";
    if (
      !this.#job ||
      this.#job.password !== password ||
      this.#job.phase === "done"
    ) {
      this.#job = await startScryptJob(password, encoded);
    }
    const job = this.#job;
    if (!job) {
      return Response.json({ done: true, match: false });
    }
    const finished = stepScryptJob(job, STEP_MS);
    if (!finished) {
      return Response.json({ done: false, match: false });
    }
    const match = await finishScryptJob(job);
    this.#job = null;
    return Response.json({ done: true, match });
  }
}
