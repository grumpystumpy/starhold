import { DatabaseSync } from "node:sqlite";
const phases = { load: 0, parse: 0, tick: 0, saveStringify: 0, highscores: 0 };
let phase: keyof typeof phases = "load";
const realNow = Date.now.bind(Date);
const originalParse = JSON.parse;
const originalStringify = JSON.stringify;
JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
  const started = performance.now();
  try { return originalParse.apply(this, args); }
  finally { phases.parse += performance.now() - started; }
} as typeof JSON.parse;
JSON.stringify = function (value: unknown, ...args: unknown[]) {
  const started = performance.now();
  try { return (originalStringify as (...values: unknown[]) => string | undefined).call(this, value, ...args); }
  finally {
    const elapsed = performance.now() - started;
    if (phase === "save" && value && typeof value === "object" && ("rows" in value || "hallOfFame" in value)) phases.highscores += elapsed;
    else if (phase === "save") phases.saveStringify += elapsed;
  }
} as typeof JSON.stringify;

const clockOverride = Number(process.env.STARHOLD_BENCH_NOW);
if (Number.isFinite(clockOverride) && clockOverride > 0) Date.now = () => clockOverride;

const game = await import("@starhold/game");
const { createD1Store } = await import("../apps/server/src/d1-store.js");
type D1Like = import("../apps/server/src/d1-store.js").D1Like;
type D1RunResult = import("../apps/server/src/d1-store.js").D1RunResult;
type D1Stmt = import("../apps/server/src/d1-store.js").D1Stmt;
const { runWithScope } = await import("../apps/server/src/request-context.js");
const { withUniverse } = await import("../apps/server/src/store.js");
const { createApp } = await import("../apps/server/src/app.js");

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
  for (const key of Object.keys(phases) as Array<keyof typeof phases>) phases[key] = 0;
  phase = "load";
  const started = performance.now();
  const scope = { kv: createD1Store(db), db, mode: "d1" as const, method: "POST", budget: npc ? game.npcJobBudget(started) : game.maintenanceTickBudget(started), cpuMs: 0 };
  let loadedAt = started;
  let tickMs = 0;
  let tickEnded = started;
  await runWithScope(scope, () => withUniverse((universe) => {
    loadedAt = performance.now();
    phase = "tick";
    const tickStarted = performance.now();
    if (npc) game.tickPirates(universe, Date.now());
    else game.advanceUniverse(universe, Date.now());
    tickMs = performance.now() - tickStarted;
    tickEnded = performance.now();
    phase = "save";
  }, npc ? { npc: true } : { maintenance: true }));
  const elapsed = performance.now() - started;
  const due = raw.prepare("SELECT COUNT(*) AS n FROM save_fleets WHERE json_extract(doc, '$.arrivesAt') <= ?").get(Date.now()) as { n: number };
  const loadMs = loadedAt - started;
  process.stdout.write(`${label} cpuMs=${scope.cpuMs.toFixed(2)} elapsedMs=${elapsed.toFixed(2)} dueFleets=${due.n} phasesMs=load:${loadMs.toFixed(2)},parse:${phases.parse.toFixed(2)},tick:${tickMs.toFixed(2)},save:${Math.max(0, performance.now() - tickEnded).toFixed(2)},saveStringify:${phases.saveStringify.toFixed(2)},highscores:${phases.highscores.toFixed(2)}\n`);
}

async function apiBench(): Promise<void> {
  const target = raw.prepare(
    "SELECT owner_id FROM save_planets WHERE owner_id != '' GROUP BY owner_id ORDER BY COUNT(*) DESC, owner_id LIMIT 1",
  ).get() as { owner_id: string } | undefined;
  if (!target) throw new Error("No player owns a planet in the snapshot.");
  process.stdout.write(`api-target playerId=${target.owner_id}\n`);
  const app = createApp();
  const stateScope = { kv: createD1Store(db), db, mode: "d1" as const, method: "GET", budget: game.requestTickBudget(), cpuMs: 0 };
  await runWithScope(stateScope, () => app.request(`/api/state?playerId=${encodeURIComponent(target.owner_id)}`));
  process.stdout.write(`api-state cpuMs=${stateScope.cpuMs.toFixed(2)}\n`);
  const deleteScope = { kv: createD1Store(db), db, mode: "d1" as const, method: "POST", budget: game.requestTickBudget(), cpuMs: 0 };
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
  const npcPhase = process.env.STARHOLD_BENCH_NPC_PHASE;
  if (npcPhase === "grow") Date.now = () => Math.floor(realNow() / (20 * 60 * 1000)) * (20 * 60 * 1000) + 1;
  if (npcPhase === "raid") Date.now = () => Math.floor(realNow() / (20 * 60 * 1000)) * (20 * 60 * 1000) + (10 * 60 * 1000) + 1;
  await pass("npc", true);
  for (let index = 1; index <= 3; index += 1) await pass(`maintenance-${index}`, false);
  raw.close();
}

void main();
