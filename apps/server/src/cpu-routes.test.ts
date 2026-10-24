import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "node:test";
import { NPC_RAID_CATCHUP_MAX } from "@starhold/game";
import { mountCpuRoutes } from "./cpu-routes.js";
import { runWithScope } from "./request-context.js";

describe("CPU profile cases", () => {
  it("runs each expanded case and reports finite timing and CPU values", async () => {
    const previous = process.env.STARHOLD_CPU_PROFILE;
    process.env.STARHOLD_CPU_PROFILE = "1";
    const app = new Hono();
    mountCpuRoutes(app);
    try {
      for (const name of ["combat", "combat-catalog", "combat-heavy", "pirate-raids"]) {
        const response = await runWithScope(
          { kv: null, cpuMs: 0 },
          () => app.request(`/api/profile/${name}`),
        );
        assert.equal(response.status, 200);
        const body = await response.json() as { case: string; ms: number; cpu: number; raids?: number };
        assert.equal(body.case, name);
        assert.ok(Number.isFinite(body.ms));
        assert.ok(Number.isFinite(body.cpu));
        if (name === "pirate-raids") assert.equal(body.raids, NPC_RAID_CATCHUP_MAX);
      }
    } finally {
      if (previous === undefined) delete process.env.STARHOLD_CPU_PROFILE;
      else process.env.STARHOLD_CPU_PROFILE = previous;
    }
  });
});
