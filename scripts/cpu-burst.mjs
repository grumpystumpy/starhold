#!/usr/bin/env node
/**
 * Item 10 burst measurement. Joins one commander, then posts 10
 * build-ship and 10 build-defense calls back to back on one server.
 * CPU is the existing x-starhold-cpu-ms header (STARHOLD_CPU_PROFILE=1
 * or Workers). Wall time is the client clock around the request.
 * Does not change product behavior. A single build call over
 * FREE_PLAN_CPU_MS is reported and fails the process.
 *
 *   STARHOLD_CPU_PROFILE=1 STARHOLD_E2E=1 npm run perf:cpu-burst
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FREE_PLAN_CPU_MS = 10;
export const BURST_CALLS = 10;

function isBuild(sample) {
  return sample.kind === "build-ship" || sample.kind === "build-defense";
}

/** Build calls whose attributed CPU is over the free-plan limit. */
export function burstBudgetViolations(samples) {
  const violations = [];
  for (const sample of samples) {
    if (!isBuild(sample)) continue;
    if (sample.cpuMs == null || Number.isNaN(sample.cpuMs)) {
      violations.push(sample);
      continue;
    }
    if (sample.cpuMs > FREE_PLAN_CPU_MS) violations.push(sample);
  }
  return violations;
}

/** Throws when any single build-ship or build-defense call exceeds 10 ms. */
export function assertBuildBurstWithinBudget(samples) {
  const violations = burstBudgetViolations(samples);
  if (violations.length === 0) return;
  const first = violations[0];
  const cpu = first.cpuMs == null ? "missing" : first.cpuMs;
  throw new Error(
    `${first.kind} #${first.index} used ${cpu} ms CPU, over the ${FREE_PLAN_CPU_MS} ms free-plan budget`,
  );
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toFixed(2);
}

export function formatBurstReport(samples) {
  const lines = [
    `Free-plan limit: ${FREE_PLAN_CPU_MS} ms CPU per request (x-starhold-cpu-ms).`,
    "",
    "| Call | n | Status | CPU ms | Wall ms | Note |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const sample of samples) {
    lines.push(
      `| ${sample.kind} | ${sample.index} | ${sample.status} | ${fmt(sample.cpuMs)} | ${fmt(sample.wallMs)} | ${sample.note ?? ""} |`,
    );
  }
  lines.push("");
  for (const kind of ["build-ship", "build-defense"]) {
    const rows = samples.filter((sample) => sample.kind === kind);
    const cpus = rows.map((row) => row.cpuMs).filter((n) => n != null && !Number.isNaN(n));
    const walls = rows.map((row) => row.wallMs);
    const sum = (values) => values.reduce((total, n) => total + n, 0);
    const max = cpus.length ? Math.max(...cpus) : null;
    lines.push(
      `${kind}: calls ${rows.length}, cpu total ${fmt(sum(cpus))} ms, cpu max ${fmt(max)} ms, wall total ${fmt(sum(walls))} ms (limit ${FREE_PLAN_CPU_MS} ms per call)`,
    );
  }
  const violations = burstBudgetViolations(samples);
  if (violations.length) {
    lines.push("");
    lines.push(
      `OVER BUDGET: ${violations.length} build call(s) exceeded ${FREE_PLAN_CPU_MS} ms. Not changed — measurement only.`,
    );
    for (const sample of violations) {
      lines.push(`- ${sample.kind} #${sample.index}: ${fmt(sample.cpuMs)} ms CPU`);
    }
  } else {
    lines.push("");
    lines.push(`Every build call was within ${FREE_PLAN_CPU_MS} ms CPU.`);
  }
  return lines.join("\n");
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 180) };
  }
}

function sampleFrom(kind, index, res, body, wallMs) {
  const header = res.headers.get("x-starhold-cpu-ms");
  const cpuMs = header == null || header === "" ? null : Number(header);
  let note = "";
  if (body?.error) note = String(body.error);
  else if (header == null) note = "missing x-starhold-cpu-ms";
  return {
    kind,
    index,
    status: res.status,
    cpuMs,
    wallMs: Number(wallMs.toFixed(2)),
    note,
  };
}

/**
 * Drive join + 10 build-ship + 10 build-defense. `fetchImpl` is injectable
 * so the unit test does not need a live server.
 */
export async function measureBurst(fetchImpl, baseUrl) {
  const root = baseUrl.replace(/\/$/, "");
  const health = await fetchImpl(`${root}/api/health`);
  if (!health.ok) {
    throw new Error(`API health ${health.status} at ${root}`);
  }

  const name = `Cpu${Date.now().toString(36).slice(-6)}`;
  const joinStarted = performance.now();
  const joinRes = await fetchImpl(`${root}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const joinWall = performance.now() - joinStarted;
  const joinBody = await readJson(joinRes);
  const playerId = joinBody?.player?.id;
  if (!playerId) {
    throw new Error(`join failed: ${JSON.stringify(joinBody)}`);
  }

  const grantRes = await fetchImpl(`${root}/api/e2e/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      resources: { metal: 5_000_000, crystal: 5_000_000, deuterium: 5_000_000 },
      buildings: { shipyard: 1 },
    }),
  });
  if (!grantRes.ok) {
    const grantBody = await readJson(grantRes);
    console.error(
      `e2e grant ${grantRes.status} (set STARHOLD_E2E=1 so builds can succeed): ${grantBody.error ?? ""}`,
    );
  } else {
    await grantRes.text();
  }

  const samples = [sampleFrom("join", 1, joinRes, joinBody, joinWall)];

  async function postBuild(kind, path, body, index) {
    const started = performance.now();
    const res = await fetchImpl(`${root}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const wallMs = performance.now() - started;
    const payload = await readJson(res);
    samples.push(sampleFrom(kind, index, res, payload, wallMs));
  }

  for (let i = 1; i <= BURST_CALLS; i++) {
    await postBuild("build-ship", "/api/build-ship", {
      playerId,
      shipId: "scout",
      count: 1,
    }, i);
  }
  for (let i = 1; i <= BURST_CALLS; i++) {
    await postBuild("build-defense", "/api/build-defense", {
      playerId,
      defenseId: "laserBattery",
      count: 1,
    }, i);
  }
  return samples;
}

async function main() {
  const base = process.env.STARHOLD_API ?? "http://127.0.0.1:3001";
  const samples = await measureBurst(fetch, base);
  const report = formatBurstReport(samples);
  console.log(report);
  const violations = burstBudgetViolations(samples);
  if (violations.length) process.exitCode = 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
