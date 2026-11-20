import { DatabaseSync } from "node:sqlite";
import { advanceUniverse, maintenanceTickBudget, npcJobBudget, requestTickBudget, tickPirates } from "@starhold/game";
import { createD1Store } from "../apps/server/src/d1-store.js";
import type { D1Like, D1RunResult, D1Stmt } from "../apps/server/src/d1-store.js";
import { runWithScope } from "../apps/server/src/request-context.js";
import { withUniverse } from "../apps/server/src/store.js";
import { createApp } from "../apps/server/src/app.js";

const path = process.env.STARHOLD_SNAPSHOT;
if (!path) throw new Error("Set STARHOLD_SNAPSHOT to a temporary SQLite copy.");
const raw = new DatabaseSync(path);
const db: D1Like = {
  prepare(sql: string): D1Stmt {
    const values: unknown[] = [];
    const stmt = raw.prepare(sql);
    const api: D1Stmt = {
      bind(...next: unknown[]) { values.splice(0, values.length, ...next); return api; },
      async first<T>() { return (stmt.get(...values as never[]) as T | undefined) ?? null; },
      async all<T>() { return { results: stmt.all(...values as never[]) as T[] }; },
      async run(): Promise<D1RunResult> {
        if (/^\s*SELECT\b/i.test(sql)) return { results: stmt.all(...values as never[]) };
        const result = stmt.run(...values as never[]);
        return { meta: { changes: Number(result.changes ?? 0) } };
      },
    };
    return api;
  },
  async batch(statements) {
    raw.exec("BEGIN");
    try {
      const results = await Promise.all(statements.map((statement) => statement.run()));
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
};

async function pass(label: string, npc: boolean): Promise<void> {
  const scope = { kv: createD1Store(db), db, mode: "d1" as const, method: "POST", budget: npc ? npcJobBudget() : maintenanceTickBudget(), cpuMs: 0 };
  const started = performance.now();
  await runWithScope(scope, () => withUniverse((universe) => {
    if (npc) tickPirates(universe, Date.now());
    else advanceUniverse(universe, Date.now());
  }, npc ? { npc: true } : { maintenance: true }));
  const elapsed = performance.now() - started;
  const due = raw.prepare("SELECT COUNT(*) AS n FROM save_fleets WHERE json_extract(doc, '$.arrivesAt') <= ?").get(Date.now()) as { n: number };
  process.stdout.write(`${label} cpuMs=${scope.cpuMs.toFixed(2)} elapsedMs=${elapsed.toFixed(2)} dueFleets=${due.n}\n`);
}

async function apiBench(): Promise<void> {
  const target = raw.prepare(
    "SELECT owner_id FROM save_planets WHERE owner_id != '' GROUP BY owner_id ORDER BY COUNT(*) DESC, owner_id LIMIT 1",
  ).get() as { owner_id: string } | undefined;
  if (!target) throw new Error("No player owns a planet in the snapshot.");
  process.stdout.write(`api-target playerId=${target.owner_id}\n`);
  const app = createApp();
  const stateScope = { kv: createD1Store(db), db, mode: "d1" as const, method: "GET", budget: requestTickBudget(), cpuMs: 0 };
  await runWithScope(stateScope, () => app.request(`/api/state?playerId=${encodeURIComponent(target.owner_id)}`));
  process.stdout.write(`api-state cpuMs=${stateScope.cpuMs.toFixed(2)}\n`);
  const deleteScope = { kv: createD1Store(db), db, mode: "d1" as const, method: "POST", budget: requestTickBudget(), cpuMs: 0 };
  await runWithScope(deleteScope, () => app.request("/api/delete-messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: target.owner_id, category: "combat" }),
  }));
  process.stdout.write(`api-delete-messages cpuMs=${deleteScope.cpuMs.toFixed(2)}\n`);
}

async function main(): Promise<void> {
  if (process.env.STARHOLD_API_ONLY === "1") {
    await apiBench();
    raw.close();
    return;
  }
  await pass("npc", true);
  for (let index = 1; index <= 3; index += 1) await pass(`maintenance-${index}`, false);
  raw.close();
}

void main();
