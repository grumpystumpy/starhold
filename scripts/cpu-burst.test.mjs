import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuildBurstWithinBudget,
  burstBudgetViolations,
  formatBurstReport,
  FREE_PLAN_CPU_MS,
  measureBurst,
} from "./cpu-burst.mjs";

function jsonResponse(body, { status = 200, cpu = "1.25" } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cpu != null) headers.set("x-starhold-cpu-ms", String(cpu));
  return new Response(JSON.stringify(body), { status, headers });
}

test("happy path records join and both 10-call bursts under the budget", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init?.method ?? "GET" });
    if (path === "/api/health") return jsonResponse({ ok: true }, { cpu: null });
    if (path === "/api/join") {
      return jsonResponse({ player: { id: "plyr_burst" } }, { cpu: "3.50" });
    }
    if (path === "/api/e2e/grant") return jsonResponse({ ok: true }, { cpu: "0.40" });
    if (path === "/api/build-ship") {
      return jsonResponse({ ok: true }, { cpu: "2.10" });
    }
    if (path === "/api/build-defense") {
      return jsonResponse({ ok: true }, { cpu: "2.40" });
    }
    throw new Error(`unexpected ${path}`);
  };

  const samples = await measureBurst(fetchImpl, "http://127.0.0.1:3001");
  const ships = samples.filter((row) => row.kind === "build-ship");
  const defenses = samples.filter((row) => row.kind === "build-defense");
  assert.equal(ships.length, 10);
  assert.equal(defenses.length, 10);
  assert.equal(calls.filter((call) => call.path === "/api/build-ship").length, 10);
  assert.equal(calls.filter((call) => call.path === "/api/build-defense").length, 10);
  assert.deepEqual(burstBudgetViolations(samples), []);
  assertBuildBurstWithinBudget(samples);
  const report = formatBurstReport(samples);
  assert.match(report, /build-ship: calls 10/);
  assert.match(report, /build-defense: calls 10/);
  assert.match(report, new RegExp(`within ${FREE_PLAN_CPU_MS} ms`));
  assert.equal(ships[0].cpuMs, 2.1);
  assert.equal(ships[0].status, 200);
  assert.ok(ships[0].wallMs >= 0);
});

test("fails a single build call that exceeds the 10 ms free-plan budget", () => {
  const over = {
    kind: "build-ship",
    index: 4,
    status: 200,
    cpuMs: 10.01,
    wallMs: 12,
    note: "",
  };
  const samples = [
    over,
    { kind: "build-defense", index: 1, status: 200, cpuMs: 9.99, wallMs: 10, note: "" },
    { kind: "join", index: 1, status: 200, cpuMs: 40, wallMs: 40, note: "" },
  ];
  const violations = burstBudgetViolations(samples);
  assert.equal(violations.length, 1);
  assert.equal(violations[0], over);
  assert.throws(
    () => assertBuildBurstWithinBudget(samples),
    /build-ship #4 used 10.01 ms CPU, over the 10 ms free-plan budget/,
  );
  assert.match(formatBurstReport(samples), /OVER BUDGET/);
});

test("fails a build call with no CPU header", () => {
  assert.throws(
    () =>
      assertBuildBurstWithinBudget([
        { kind: "build-defense", index: 1, status: 200, cpuMs: null, wallMs: 3, note: "" },
      ]),
    /build-defense #1 used missing ms CPU, over the 10 ms free-plan budget/,
  );
});
