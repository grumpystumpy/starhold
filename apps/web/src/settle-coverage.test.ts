import "./test-dom";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";

const sourceDir = fileURLToPath(new URL(".", import.meta.url));

// These exported actions only update local UI state or issue GET requests.
const nonPostActions = new Set([
  "doApplyFleetPreset", "doRefresh", "doGalaxyNav",
]);

// These POSTs create credentials or sessions; recovery is the user retrying.
const postRecoveryExemptActions = new Set(["doJoin", "doLogin", "doSignup"]);

function exportedDoNames(source: string): string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(do\w+)\s*\(/g)].map(([, name]) => name!);
}

function playerView(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", name: "Commander", research: {}, researchQueue: [], skillsUnlocked: [], fleetPresets: [{ id: "custom-1", name: "Preset", intent: "custom", ships: {} }] },
    planet: { id: "pl1", name: "Home", coords: { galaxy: 1, system: 4, slot: 1 }, buildings: {}, buildQueue: [], shipQueue: [], defenseQueue: [], ships: {}, defenses: {} },
    galaxy: { galaxy: 1, system: 4 }, fleets: [], openAcsGroups: [], alliances: [], reports: [], spyReports: [], expeditionReports: [], officers: [], skillsUnlocked: [], seasonLeaderboard: { seasonId: "season-1", claims: [] },
  } as unknown as PlayerView;
}

function argsFor(name: string): unknown[] {
  if (name === "doSelectPlanet") return ["pl1"];
  if (name === "doRequestClaimCode") return ["test@example.com"];
  if (name === "doClaimAnonymous" || name === "doDeleteFleetPreset") return [];
  if (name === "doClaimPassword") return ["test@example.com", "ABC123", "password123"];
  if (name === "doLaunchFleet") return [{ mission: "transport", target: { galaxy: 1, system: 4, slot: 2 }, ships: { smallCargo: 1 } }];
  if (name === "doCreateAlliance") return ["Test alliance"];
  if (name === "doDeleteMessages" || name === "doMarkEventsRead") return [["id-1"]];
  if (name === "doClaimSeason") return ["combat", "season-1"];
  if (name === "doRelocateFortress") return [2, 8];
  if (name === "doRenamePlanet") return ["New Home"];
  if (name === "doClaimGoal" || name === "doChooseClass" || name === "doChangeClass" || name === "doActivateOfficer" || name === "doRaiseOfficer" || name === "doUnlockSkill" || name === "doUpgrade" || name === "doBuild" || name === "doBuildDefense" || name === "doResearch" || name === "doCancelQueue") return ["test", 1];
  return ["test", "test", 1];
}

describe("settleMutation coverage for exported POST actions", () => {
  it("runs every discovered POST action through a network failure and refreshed-state read", async () => {
    const files = (await readdir(sourceDir)).filter((file) => /^main-actions.*\.ts$/.test(file) && file !== "main-actions.ts" && !file.endsWith(".test.ts")).sort();
    const exported = new Set<string>();
    const covered: string[] = [];
    const { session, root, setPaintImpl } = await import("./session");
    const initial = playerView();
    const originalFetch = globalThis.fetch;
    const originalQuerySelector = root.querySelector;
    const originalTimeout = window.setTimeout;
    const originalLocalStorage = globalThis.localStorage;
    window.setTimeout = (() => 0) as typeof window.setTimeout;
    globalThis.localStorage = {
      getItem: () => "p1", setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0,
    } as Storage;
    root.querySelector = ((selector: string) => ({ value: selector === "#fleet-preset" ? "custom-1" : "test", checked: false, querySelector: () => null, querySelectorAll: () => [] })) as typeof root.querySelector;
    setPaintImpl(() => {});
    try {
      for (const file of files) {
        const source = await readFile(new URL(file, import.meta.url), "utf8");
        const module = await import(`./${file.replace(/\.ts$/, "")}`);
        const sourceNames = exportedDoNames(source);
        const moduleNames = Object.keys(module).filter((name) => name.startsWith("do"));
        assert.deepEqual(moduleNames.sort(), sourceNames.sort(), `${file} export discovery`);
        for (const name of moduleNames) {
          exported.add(name);
          const declaration = source.indexOf(`function ${name}(`);
          const nextExport = source.indexOf("export ", declaration + 1);
          const body = source.slice(declaration, nextExport < 0 ? source.length : nextExport);
          if (nonPostActions.has(name)) {
            assert.doesNotMatch(body, /method:\s*["']POST["']/);
            continue;
          }
          if (postRecoveryExemptActions.has(name)) {
            continue;
          }
          assert.match(body, /settleMutation\s*\(/, `${name} must re-check state after POST failure`);
          const events: string[] = [];
          session.view = initial;
          session.account = { id: "account-1", email: "test@example.com", playerId: null };
          session.claimablePlayerId = "p1";
          session.busy = false;
          session.error = null;
          session.notice = null;
          globalThis.fetch = async (input, init) => {
            const method = init?.method ?? "GET";
            if (method === "GET") {
              events.push("GET");
              return new Response(JSON.stringify(initial), { status: 200, headers: { "content-type": "application/json" } });
            }
            events.push("POST");
            throw new TypeError("Failed to fetch");
          };
          await (module[name] as (...args: unknown[]) => Promise<void>)(...argsFor(name));
          assert.deepEqual(events, name === "doClaimAnonymous" || name === "doClaimPassword"
            ? ["POST", "GET", "GET"]
            : ["POST", "GET"], `${name} must make exactly one POST followed by refreshed state reads`);
          covered.push(name);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.localStorage = originalLocalStorage;
      root.querySelector = originalQuerySelector;
      window.setTimeout = originalTimeout;
    }
    for (const name of [...nonPostActions, ...postRecoveryExemptActions]) assert.ok(exported.has(name), `stale exemption list: ${name}`);
    assert.ok(covered.length > 0);
  });

  it("only reports claim success when refreshed auth/me owns the refreshed save", async () => {
    const { session, root, setPaintImpl } = await import("./session");
    const { doClaimAnonymous, doClaimPassword } = await import("./main-actions-session");
    const initial = playerView();
    const originalFetch = globalThis.fetch;
    const originalQuerySelector = root.querySelector;
    const originalTimeout = window.setTimeout;
    const originalLocalStorage = globalThis.localStorage;
    window.setTimeout = (() => 0) as typeof window.setTimeout;
    globalThis.localStorage = {
      getItem: () => "p1", setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0,
    } as Storage;
    root.querySelector = (() => ({ value: "test", checked: false, querySelector: () => null, querySelectorAll: () => [] })) as typeof root.querySelector;
    setPaintImpl(() => {});
    try {
      for (const action of ["anonymous", "password"] as const) {
        for (const claimed of [false, true]) {
          session.view = initial;
          session.account = { id: "account-1", email: "test@example.com", playerId: null };
          session.claimablePlayerId = "p1";
          session.busy = false;
          session.error = null;
          session.notice = null;
          globalThis.fetch = async (input, init) => {
            const path = String(input);
            if (init?.method === "POST") throw new TypeError("Failed to fetch");
            if (path.includes("/api/auth/me")) {
              const account = claimed
                ? { id: "account-1", email: "test@example.com", playerId: "p1" }
                : { id: "account-1", email: "test@example.com", playerId: null };
              return new Response(JSON.stringify({ account, view: initial }), { status: 200, headers: { "content-type": "application/json" } });
            }
            return new Response(JSON.stringify(initial), { status: 200, headers: { "content-type": "application/json" } });
          };
          if (action === "anonymous") await doClaimAnonymous();
          else await doClaimPassword("test@example.com", "ABC123", "password123");
          if (claimed) {
            assert.match(session.notice ?? "", /Claimed|Password set/);
            assert.equal(session.error, null);
          } else {
            assert.equal(session.notice, null);
            assert.match(session.error ?? "", /could not|not applied|failed/i);
          }
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.localStorage = originalLocalStorage;
      root.querySelector = originalQuerySelector;
      window.setTimeout = originalTimeout;
    }
  });
});
