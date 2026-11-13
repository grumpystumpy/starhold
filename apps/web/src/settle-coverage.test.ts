import "./test-dom";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { OVERLOAD_MESSAGE } from "./api";

const sourceDir = fileURLToPath(new URL(".", import.meta.url));

// These exported actions only update local UI state or issue GET requests.
const nonPostActions = new Set([
  "doApplyFleetPreset", "doRefresh", "doGalaxyNav", "doGalaxyJump", "doGalaxyGalaxyNav", "doGalaxyFleetAction", "doGalaxyFleetPreset", "doDismissFleetSave", "doOpenFleetSave", "doGalaxyHarvest",
]);

// These call another covered POST action that settles.
const delegatingActions = new Map([["doGalaxySpy", "doLaunchFleet"]]);

// These POSTs create credentials or sessions; recovery is the user retrying.
const postRecoveryExemptActions = new Set([
  "doJoin",
  "doLogin",
  "doSignup",
  "doChangePassword",
  "doRevokeOtherSessions",
  "doGenerateRecoveryCodes",
  "doRecover",
  "doRequestEmailReset",
  "doConfirmEmailReset",
  "doCopyInvite",
]);

function exportedDoNames(source: string): string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(do\w+)\s*\(/g)].map(([, name]) => name!);
}

function playerView(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", name: "Commander", research: {}, researchQueue: [], skillsUnlocked: [], fleetPresets: [{ id: "custom-1", name: "Preset", intent: "custom", ships: {} }] },
    planet: { id: "pl1", name: "Home", coords: { galaxy: 1, system: 4, slot: 1 }, resources: { metal: 0, crystal: 0, deuterium: 0 }, buildings: {}, buildQueue: [], shipQueue: [], defenseQueue: [], ships: {}, defenses: {} },
    galaxy: { galaxy: 1, system: 4 }, fleets: [], openAcsGroups: [], alliances: [], reports: [], spyReports: [], expeditionReports: [], officers: [], skillsUnlocked: [], seasonLeaderboard: { seasonId: "season-1", claims: [] },
  } as unknown as PlayerView;
}

function reorderCoverageView(base: PlayerView): PlayerView {
  const view = structuredClone(base);
  view.planet.buildQueue = [
    { id: "q0", buildingId: "metalMine", targetLevel: 1, startedAt: 1, completesAt: 2, workSeconds: 1, paidCost: { metal: 1, crystal: 0, deuterium: 0 } },
    { id: "q1", buildingId: "crystalMine", targetLevel: 1, startedAt: null, completesAt: 3, workSeconds: 1, paidCost: { metal: 1, crystal: 0, deuterium: 0 } },
    { id: "q2", buildingId: "solarPlant", targetLevel: 1, startedAt: null, completesAt: 4, workSeconds: 1, paidCost: { metal: 1, crystal: 0, deuterium: 0 } },
  ] as PlayerView["planet"]["buildQueue"];
  return view;
}

function argsFor(name: string): unknown[] {
  if (name === "doSelectPlanet") return ["pl1"];
  if (name === "doClaimAnonymous" || name === "doDeleteFleetPreset") return [];
  if (name === "doLaunchFleet") return [{ mission: "transport", target: { galaxy: 1, system: 4, slot: 2 }, ships: { smallCargo: 1 } }];
  if (name === "doCreateAlliance") return ["Test alliance"];
  if (name === "doDeleteMessages" || name === "doMarkEventsRead") return [["id-1"]];
  if (name === "doClaimSeason") return ["combat", "season-1"];
  if (name === "doTradeResources") return ["buy"];
  if (name === "doRelocateFortress") return [2, 8];
  if (name === "doRenamePlanet") return ["New Home"];
  if (name === "doClaimGoal" || name === "doChooseClass" || name === "doChangeClass" || name === "doActivateOfficer" || name === "doRaiseOfficer" || name === "doUnlockSkill" || name === "doUpgrade" || name === "doBuild" || name === "doBuildDefense" || name === "doResearch" || name === "doCancelQueue") return ["test", 1];
  if (name === "doReorderQueue") return ["building", "q1", "down"];
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
          const delegatedAction = delegatingActions.get(name);
          if (delegatedAction) {
            assert.match(body, new RegExp(`${delegatedAction}\\s*\\(`));
            assert.ok(moduleNames.includes(delegatedAction) || exported.has(delegatedAction),
              `${name} must delegate to a discovered/covered action: ${delegatedAction}`);
            continue;
          }
          assert.match(body, /settleMutation\s*\(/, `${name} must re-check state after POST failure`);
          const events: string[] = [];
          session.view = name === "doReorderQueue" ? reorderCoverageView(initial) : initial;
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
          assert.deepEqual(events, name === "doClaimAnonymous"
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

  it("only reports guest-save claim success when refreshed auth/me owns the refreshed save", async () => {
    const { session, root, setPaintImpl } = await import("./session");
    const { doClaimAnonymous } = await import("./main-actions-session");
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
      for (const action of ["anonymous"] as const) {
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
          await doClaimAnonymous();
          if (claimed) {
            assert.match(session.notice ?? "", /Claimed/);
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

  it("exempt auth POSTs never show OVERLOAD_MESSAGE unless a state read follows", async () => {
    const { session, setPaintImpl } = await import("./session");
    const actions = await import("./main-actions-session");
    const calls: Record<string, () => Promise<void>> = {
      doJoin: () => actions.doJoin("Commander"),
      doLogin: () => actions.doLogin("a@example.com", "password1"),
      doSignup: () => actions.doSignup("a@example.com", "password1"),
      doChangePassword: () => actions.doChangePassword("oldpassword", "newpassword1"),
      doRevokeOtherSessions: () => actions.doRevokeOtherSessions(),
      doGenerateRecoveryCodes: () => actions.doGenerateRecoveryCodes("password1"),
      doRecover: () => actions.doRecover("a@example.com", "ABCD-EFGH", "password1"),
      doRequestEmailReset: () => actions.doRequestEmailReset("a@example.com"),
      doConfirmEmailReset: () => actions.doConfirmEmailReset("test-token", "password1"),
      doCopyInvite: () => {
        session.account = { id: "account-1", email: "a@example.com", playerId: "p1" };
        session.view = playerView();
        return actions.doCopyInvite();
      },
    };
    assert.deepEqual(
      Object.keys(calls).sort(),
      [...postRecoveryExemptActions].sort(),
    );
    const originalFetch = globalThis.fetch;
    const originalTimeout = window.setTimeout;
    const originalLocalStorage = globalThis.localStorage;
    window.setTimeout = (() => 0) as typeof window.setTimeout;
    globalThis.localStorage = {
      getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0,
    } as Storage;
    setPaintImpl(() => {});
    try {
      for (const name of postRecoveryExemptActions) {
        let posts = 0;
        let stateGets = 0;
        session.view = null;
        session.account = null;
        session.busy = false;
        session.error = null;
        session.notice = null;
        session.holdJoin = false;
        globalThis.fetch = async (input, init) => {
          const method = (init?.method ?? "GET").toUpperCase();
          const url = String(input);
          if (method === "GET" && url.includes("/api/state")) stateGets += 1;
          if (method !== "GET") posts += 1;
          return new Response("<html>Error 503</html>", {
            status: 503,
            headers: { "content-type": "text/html" },
          });
        };
        await calls[name]!();
        const flashed = [session.error, session.notice].filter(Boolean).join(" | ");
        assert.ok(posts >= 1, `${name} did not POST`);
        assert.ok(
          !(flashed.includes(OVERLOAD_MESSAGE) && stateGets === 0),
          `${name} showed OVERLOAD_MESSAGE without a state read (${flashed})`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.localStorage = originalLocalStorage;
      window.setTimeout = originalTimeout;
    }
  });
});
