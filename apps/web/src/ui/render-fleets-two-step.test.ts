import "../test-dom";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  SHIP_ORDER,
  flightSecondsOneWay,
  fuelCostOneWay,
  normalizeFleetShips,
  fleetCargoCapacity,
  type PlayerView,
} from "@starhold/game";
import { fmtEta } from "./format";
import { syncChangedInputTypeValue } from "./morph-dom";
import { flashHtml } from "./render-chrome-join";
import { fleetComposer } from "./render-fleets-composer";
import { fleetDraftForPage } from "./render-app";
import { readFleetFormIn } from "../main-fleet-form";
import {
  doApplyFleetPreset,
  doGalaxyFleetAction,
  doGalaxySpy,
  doLaunchFleet,
  GALAXY_SPY_PROBES,
} from "../main-actions-fleet";
import { clearFlash, root, session, setPaintImpl } from "../session";
import {
  blankFleetDraft,
  fleetDraftAfterBack,
  fleetDraftAfterNext,
  fleetDraftAfterPreset,
  fleetDraftWithAcsPrefill,
  fleetShipTotal,
  rememberFleetDraft,
  rememberedFleetDraft,
  salvageFleetForm,
  type FleetDraft,
} from "./render-fleets-draft";

type Fake = {
  attrs: Record<string, string>;
  value: string;
  checked: boolean;
  max: string;
  children: Fake[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(sel: string): Fake | null;
  querySelectorAll(sel: string): Fake[];
};

function matches(el: Fake, sel: string): boolean {
  const checked = sel.endsWith(":checked");
  const base = checked ? sel.slice(0, -":checked".length) : sel;
  if (checked && !el.checked) return false;
  if (base.startsWith("#")) return el.attrs.id === base.slice(1);
  const parts = base.match(/^([a-z]+)?\[([^\]=]+)(?:="([^"]*)")?\]$/);
  if (!parts) return false;
  const [, tag, attr, val] = parts;
  if (tag && el.attrs.tag !== tag) return false;
  if (val == null) return Object.prototype.hasOwnProperty.call(el.attrs, attr!);
  return el.attrs[attr!] === val;
}

function make(attrs: Record<string, string>, children: Fake[] = []): Fake {
  const el: Fake = {
    attrs,
    value: attrs.value ?? "",
    checked: attrs.checked === "1",
    max: attrs.max ?? "",
    children,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name]! : null;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    querySelector(sel) {
      for (const child of el.children) {
        if (matches(child, sel)) return child;
        const nested = child.querySelector(sel);
        if (nested) return nested;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out: Fake[] = [];
      for (const child of el.children) {
        if (matches(child, sel)) out.push(child);
        out.push(...child.querySelectorAll(sel));
      }
      return out;
    },
  };
  return el;
}

function host(form: Fake): HTMLElement {
  return make({ tag: "div" }, [form]) as unknown as HTMLElement;
}

function view(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Alpha",
      research: {},
      fleetPresets: [
        {
          id: "preset-raid",
          name: "Raid pack",
          intent: "raid",
          builtIn: true,
          ships: { scout: 2 },
        },
      ],
    },
    planet: {
      id: "pl1",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 8 },
      ships: { scout: 5, helioBuoy: 3 },
      buildings: {},
    },
    roster: [
      {
        id: "p2",
        name: "Veteran",
        planetId: "pl2",
        pointsHint: 3000,
        coords: { galaxy: 1, system: 1, slot: 1 },
      },
    ],
    ownedPlanets: [],
    galaxy: {
      galaxy: 1,
      system: 1,
      slots: [],
      asteroids: [],
      pirateBase: null,
      alienBase: null,
    },
    fleets: [],
    fleetSlotCap: 5,
    expeditionSlotCap: 2,
    universe: { speed: 1, fleetSpeed: 1 },
    alliance: { id: "ally_1", tag: "SOL" },
    openAcsGroups: [],
  } as unknown as PlayerView;
}

function draft(partial: Partial<FleetDraft> = {}): FleetDraft {
  return {
    ...blankFleetDraft(),
    ...partial,
    counts: partial.counts ?? {},
    cargo: partial.cargo ?? {},
  };
}

function buttonTag(html: string, testId: string): string {
  const match = html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`));
  assert.ok(match, `missing ${testId}`);
  return match[0];
}

describe("fleet send two-step", () => {
  it("keeps a typed ship count when the input changes to hidden", () => {
    const numberInput = { type: "number", value: "1" };
    const hiddenInput = { type: "hidden", value: "1" };
    syncChangedInputTypeValue(numberInput, hiddenInput);
    assert.equal(numberInput.value, "1");
  });

  it("step 1 renders ship inputs and no coords or mission inputs", () => {
    const empty = fleetComposer(view(), false, draft({ step: 1 }));
    assert.match(empty, /data-testid="fleet-count-scout"/);
    assert.match(empty, /in orbit 5/);
    assert.match(empty, /data-testid="fleet-slot-counters"/);
    assert.match(empty, /Fleets 0\/5 · Expeditions 0\/2/);
    assert.doesNotMatch(empty, /name="fleet-mission"/);
    assert.doesNotMatch(empty, /id="fleet-target"/);
    assert.doesNotMatch(empty, /data-testid="fleet-coords"/);
    assert.doesNotMatch(empty, /data-testid="fleet-speed"/);
    assert.doesNotMatch(empty, /data-fleet-count="helioBuoy"/);
    assert.match(buttonTag(empty, "fleet-next"), /disabled/);
    assert.match(buttonTag(empty, "fleet-next"), /type="submit"/);
    assert.match(buttonTag(empty, "fleet-next"), /data-fleet-action="next"/);

    const armed = fleetComposer(
      view(),
      false,
      draft({ step: 1, counts: { scout: 1 } }),
    );
    assert.doesNotMatch(buttonTag(armed, "fleet-next"), /disabled/);
    assert.match(armed, /data-fleet-count="scout"[^>]*value="1"|value="1"[^>]*data-fleet-count="scout"/);
  });

  it("Next shows the ship summary and Back keeps the amounts", () => {
    const start = draft({
      step: 1,
      counts: { scout: 3 },
      mission: "raid",
      targetPlanetId: "pl2",
      speedPercent: 50,
      cargo: { metal: 10, crystal: 0, deuterium: 0 },
    });
    const next = fleetDraftAfterNext(start);
    assert.ok(next);
    assert.equal(next.step, 2);
    assert.equal(next.counts.scout, 3);
    assert.equal(fleetDraftAfterNext(draft({ step: 1, counts: {} })), null);

    const step2 = fleetComposer(view(), false, next);
    assert.match(step2, /data-fleet-step="2"/);
    assert.match(step2, /data-testid="fleet-ship-summary"/);
    assert.match(step2, /3× Scout Skiff/);
    assert.match(step2, /data-testid="fleet-coords"/);
    assert.match(step2, /Coords .*1:1:1.* · planet/);
    assert.match(step2, /name="fleet-mission"/);
    assert.match(step2, /data-testid="mission-raid"[^>]*checked/);
    assert.match(buttonTag(step2, "fleet-back"), /type="button"/);
    assert.match(buttonTag(step2, "launch-fleet"), /type="submit"/);
    assert.match(buttonTag(step2, "launch-fleet"), /data-fleet-action="send"/);
    const ships = normalizeFleetShips({ scout: 3 });
    const eta = Math.max(
      1,
      Math.round(
        flightSecondsOneWay(
          { galaxy: 1, system: 1, slot: 8 },
          { galaxy: 1, system: 1, slot: 1 },
          ships,
          1,
          0,
        ) * (100 / 50),
      ),
    );
    assert.match(step2, new RegExp(fmtEta(eta).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(step2, new RegExp(`cargo ${fleetCargoCapacity(ships).toLocaleString("en-US")}`));
    assert.match(step2, /value="50" selected/);
    assert.match(step2, /data-testid="fleet-speed-note"/);

    const back = fleetDraftAfterBack(next);
    assert.equal(back.step, 1);
    assert.equal(back.counts.scout, 3);
    assert.equal(back.speedPercent, 50);
    assert.equal(back.targetPlanetId, "pl2");
    const step1 = fleetComposer(view(), false, back);
    assert.match(step1, /data-fleet-step="1"/);
    assert.match(step1, /value="3"/);
    assert.doesNotMatch(step1, /id="fleet-target"/);
    assert.doesNotMatch(step1, /name="fleet-mission"/);
  });

  it("send payload matches the one-page form and ignores speed", () => {
    const mission = make(
      { tag: "input", type: "radio", name: "fleet-mission", value: "raid", checked: "1" },
    );
    mission.value = "raid";
    const target = make({ tag: "select", id: "fleet-target" });
    target.value = "coords:1:2:4";
    const scout = make({ tag: "input", "data-fleet-count": "scout", value: "3" });
    scout.value = "3";
    const acs = make({ tag: "input", id: "fleet-open-acs", type: "checkbox" });
    const join = make({ tag: "select", id: "fleet-acs-join" });
    join.value = "";
    const oldForm = make(
      { tag: "form", id: "fleet-form" },
      [mission, target, scout, acs, join],
    );
    const speed = make({ tag: "select", "data-fleet-speed": "10", value: "10" });
    speed.value = "10";
    const step2 = make(
      { tag: "form", id: "fleet-form", "data-fleet-step": "2" },
      [mission, target, scout, acs, join, speed],
    );
    const oldPayload = readFleetFormIn(host(oldForm));
    const nextPayload = readFleetFormIn(host(step2));
    assert.deepEqual(nextPayload, oldPayload);
    assert.ok(oldPayload);
    assert.equal(oldPayload.mission, "raid");
    assert.deepEqual(oldPayload.targetCoords, { galaxy: 1, system: 2, slot: 4 });
    assert.equal(oldPayload.ships.scout, 3);
    assert.equal(oldPayload.ships.helioBuoy, 0);
    for (const id of SHIP_ORDER) {
      if (id !== "scout") assert.equal(oldPayload.ships[id], 0);
    }
    assert.equal("speed" in oldPayload, false);
    assert.equal("speedPercent" in oldPayload, false);
    assert.equal(JSON.stringify(nextPayload).includes("speed"), false);
  });

  it("a re-render on step 2 keeps the step and entered values", () => {
    const filled = draft({
      step: 2,
      mission: "raid",
      targetCoords: { galaxy: 1, system: 2, slot: 4 },
      counts: { scout: 4 },
      speedPercent: 40,
      openAcs: true,
      cargo: { metal: 8, crystal: 0, deuterium: 0 },
    });
    const form = make(
      { tag: "form", id: "fleet-form", "data-fleet-step": "2" },
      [
        (() => {
          const radio = make({
            tag: "input",
            name: "fleet-mission",
            value: "raid",
            checked: "1",
          });
          radio.value = "raid";
          return radio;
        })(),
        (() => {
          const select = make({ tag: "select", id: "fleet-target" });
          select.value = "coords:1:2:4";
          return select;
        })(),
        (() => {
          const input = make({ tag: "input", "data-fleet-count": "scout" });
          input.value = "4";
          return input;
        })(),
        (() => {
          const box = make({ tag: "input", id: "fleet-open-acs", checked: "1" });
          box.checked = true;
          return box;
        })(),
        (() => {
          const select = make({ tag: "select", "data-fleet-speed": "40" });
          select.value = "40";
          return select;
        })(),
      ],
    );
    rememberFleetDraft(null);
    const first = salvageFleetForm(host(form));
    assert.ok(first);
    const again = salvageFleetForm(host(form));
    assert.deepEqual(again, first);
    assert.equal(again?.step, 2);
    assert.equal(again?.counts.scout, 4);
    assert.equal(again?.speedPercent, 40);
    assert.equal(again?.mission, "raid");
    assert.equal(again?.openAcs, true);
    assert.deepEqual(again?.targetCoords, { galaxy: 1, system: 2, slot: 4 });

    const html = fleetComposer(view(), false, again);
    assert.match(html, /data-fleet-step="2"/);
    assert.match(html, /value="4"/);
    assert.match(html, /value="40" selected/);
    assert.match(html, /data-testid="fleet-open-acs"[^>]*checked/);
    assert.match(html, /4× Scout Skiff/);
    const fuel = Math.max(
      1,
      Math.ceil(
        fuelCostOneWay(
          { galaxy: 1, system: 1, slot: 8 },
          { galaxy: 1, system: 2, slot: 4 },
          normalizeFleetShips({ scout: 4 }),
        ) * (40 / 100),
      ),
    );
    assert.match(html, new RegExp(`fuel ~${fuel.toLocaleString("en-US")} deut`));
  });

  it("a galaxy or preset prefill with coords and ships opens step 2", () => {
    const base = draft({
      step: 1,
      counts: { scout: 2 },
      targetCoords: { galaxy: 9, system: 4, slot: 16 },
    });
    const galaxy = fleetDraftWithAcsPrefill(base, {
      coords: { galaxy: 9, system: 4, slot: 16 },
      mission: "raid",
      note: "",
      openAcs: true,
    });
    assert.equal(galaxy.step, 2);
    assert.equal(galaxy.counts.scout, 2);
    const html = fleetComposer(view(), false, galaxy);
    assert.match(html, /data-fleet-step="2"/);
    assert.match(html, /data-testid="mission-raid"[^>]*checked/);
    assert.match(html, /value="coords:9:4:16" selected/);
    assert.match(html, /2× Scout Skiff/);
    assert.match(html, /data-testid="fleet-open-acs"[^>]*checked/);

    const bare = fleetDraftWithAcsPrefill(null, {
      coords: { galaxy: 9, system: 4, slot: 16 },
      mission: "raid",
      note: "",
      openAcs: true,
    });
    assert.equal(bare.step, 1);
    assert.equal(fleetShipTotal(bare.counts), 0);
    assert.doesNotMatch(fleetComposer(view(), false, bare), /name="fleet-mission"/);

    const preset = fleetDraftAfterPreset(
      draft({ step: 1, targetCoords: { galaxy: 2, system: 3, slot: 4 } }),
      "raid",
      { scout: 2 },
    );
    assert.equal(preset.step, 2);
    assert.equal(preset.mission, "raid");
    assert.deepEqual(preset.targetCoords, { galaxy: 2, system: 3, slot: 4 });
    assert.match(fleetComposer(view(), false, preset), /data-fleet-step="2"/);
    assert.match(fleetComposer(view(), false, preset), /2× Scout Skiff/);
  });

  it("disables launch and shows error hint when swarm units are selected without a Mothership", () => {
    const customView: PlayerView = {
      ...view(),
      planet: {
        ...view().planet,
        ships: { swarmDrone: 10, swarmMothership: 1, scout: 5 },
      },
    };

    const step1WithoutMS = fleetComposer(
      customView,
      false,
      draft({ step: 1, counts: { swarmDrone: 5 } }),
    );
    assert.match(buttonTag(step1WithoutMS, "fleet-next"), /disabled/);
    assert.match(step1WithoutMS, /data-testid="fleet-need-mothership"/);
    assert.match(step1WithoutMS, /Swarm drones\/harvesters must ride a Mothership/);

    const step1WithMS = fleetComposer(
      customView,
      false,
      draft({ step: 1, counts: { swarmDrone: 5, swarmMothership: 1 } }),
    );
    assert.doesNotMatch(buttonTag(step1WithMS, "fleet-next"), /disabled/);
    assert.doesNotMatch(step1WithMS, /data-testid="fleet-need-mothership"/);

    const step2WithoutMS = fleetComposer(
      customView,
      false,
      draft({
        step: 2,
        counts: { swarmDrone: 5 },
        targetPlanetId: "pl2",
        mission: "raid",
      }),
    );
    assert.match(buttonTag(step2WithoutMS, "launch-fleet"), /disabled/);
    assert.match(step2WithoutMS, /data-testid="fleet-need-mothership"/);
    assert.match(step2WithoutMS, /Swarm drones\/harvesters must ride a Mothership/);

    const step2WithMS = fleetComposer(
      customView,
      false,
      draft({
        step: 2,
        counts: { swarmDrone: 5, swarmMothership: 1 },
        targetPlanetId: "pl2",
        mission: "raid",
      }),
    );
    assert.doesNotMatch(buttonTag(step2WithMS, "launch-fleet"), /disabled/);
    assert.doesNotMatch(step2WithMS, /data-testid="fleet-need-mothership"/);
  });
});

describe("fleet send result", () => {
  const originalQuery = root.querySelector;
  const originalFetch = globalThis.fetch;
  let posted = "";

  after(() => {
    root.querySelector = originalQuery;
    rememberFleetDraft(null);
    session.view = null;
    session.error = null;
    session.notice = null;
    session.busy = false;
    globalThis.fetch = originalFetch;
  });

  function install(form: Fake): void {
    const tree = host(form);
    root.querySelector = ((sel: string) =>
      tree.querySelector(sel)) as typeof root.querySelector;
  }

  it("successful send returns to step 1 cleared; a failed send stays and shows the error", async () => {
    const form = make(
      { tag: "form", id: "fleet-form", "data-fleet-step": "2" },
      [
        (() => {
          const input = make({ tag: "input", "data-fleet-count": "scout" });
          input.value = "3";
          return input;
        })(),
        (() => {
          const select = make({ tag: "select", id: "fleet-target" });
          select.value = "planet:pl2";
          return select;
        })(),
        (() => {
          const radio = make({
            tag: "input",
            name: "fleet-mission",
            value: "raid",
            checked: "1",
          });
          radio.value = "raid";
          return radio;
        })(),
      ],
    );
    install(form);
    const payload = readFleetFormIn(host(form));
    assert.ok(payload);
    assert.equal(payload.ships.helioBuoy, 0);
    session.view = view();
    session.busy = false;
    session.error = null;
    session.notice = null;
    let salvaged: FleetDraft | null = null;
    setPaintImpl(() => {
      salvaged = salvageFleetForm(root);
    });

    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      posted = String(init?.body ?? "");
      return new Response(JSON.stringify({ error: "Not enough deuterium" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      await doLaunchFleet(payload);
    } finally {
      globalThis.fetch = original;
    }
    assert.match(posted, /"mission":"raid"/);
    assert.match(posted, /"scout":3/);
    assert.equal(posted.includes("speed"), false);
    assert.equal(posted.includes("helioBuoy"), true);
    const body = JSON.parse(posted) as { ships: { helioBuoy: number; scout: number } };
    assert.equal(body.ships.helioBuoy, 0);
    assert.equal(body.ships.scout, 3);
    assert.equal(session.error, "Not enough deuterium");
    assert.match(flashHtml(session.error, session.notice), /Not enough deuterium/);
    assert.match(flashHtml(session.error, session.notice), /data-testid="flash-error"/);
    assert.equal(salvaged?.step, 2);
    assert.equal(salvaged?.counts.scout, 3);
    assert.equal(salvaged?.targetPlanetId, "pl2");

    globalThis.fetch = async () =>
      new Response(JSON.stringify(session.view), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      await doLaunchFleet(payload);
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(session.error, null);
    assert.match(session.notice ?? "", /launched/);
    assert.equal(salvaged?.step, 1);
    assert.equal(fleetShipTotal(salvaged?.counts), 0);
    assert.equal(salvaged?.targetPlanetId, null);
    assert.doesNotMatch(
      fleetComposer(view(), false, salvaged),
      /id="fleet-target"/,
    );
  });

  it("loads a preset with ships onto step 2", () => {
    const scout = make({ tag: "input", "data-fleet-count": "scout", max: "5" });
    scout.value = "0";
    scout.max = "5";
    const preset = make({ tag: "select", id: "fleet-preset" });
    preset.value = "preset-raid";
    const form = make(
      { tag: "form", id: "fleet-form", "data-fleet-step": "1" },
      [preset, scout],
    );
    install(form);
    rememberFleetDraft(
      draft({ step: 1, targetCoords: { galaxy: 3, system: 3, slot: 3 } }),
    );
    session.view = view();
    session.error = null;
    session.notice = null;
    setPaintImpl(() => {
      salvageFleetForm(root);
    });
    doApplyFleetPreset();
    const kept = salvageFleetForm(root);
    assert.equal(kept?.step, 2);
    assert.equal(kept?.mission, "raid");
    assert.equal(kept?.counts.scout, 2);
    assert.deepEqual(kept?.targetCoords, { galaxy: 3, system: 3, slot: 3 });
    assert.match(session.notice ?? "", /Loaded preset/);
  });
});

describe("galaxy fleet actions", () => {
  it("launches one espionage fleet with the configured probes at the clicked coordinates", async () => {
    const originalFetch = globalThis.fetch;
    const originalView = session.view;
    let posted = "";
    session.view = {
      ...view(),
      planet: { ...view().planet, ships: { probe: 2 } },
    };
    session.busy = false;
    setPaintImpl(() => {});
    globalThis.fetch = async (_input, init) => {
      posted = String(init?.body ?? "");
      return new Response(JSON.stringify({ fleets: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await doGalaxySpy({ galaxy: 2, system: 9, slot: 4 });
    } finally {
      globalThis.fetch = originalFetch;
      session.view = originalView;
      session.busy = false;
      clearFlash();
      salvageFleetForm(root);
      rememberFleetDraft(null);
    }

    const payload = JSON.parse(posted) as {
      mission: string;
      ships: { probe: number };
      targetCoords: { galaxy: number; system: number; slot: number };
    };
    assert.equal(GALAXY_SPY_PROBES, 1);
    assert.equal(payload.mission, "espionage");
    assert.equal(payload.ships.probe, GALAXY_SPY_PROBES);
    assert.deepEqual(payload.targetCoords, { galaxy: 2, system: 9, slot: 4 });
  });

  it("shows an error and sends nothing when the active planet has no probes", async () => {
    const originalFetch = globalThis.fetch;
    const originalView = session.view;
    let requests = 0;
    session.view = {
      ...view(),
      planet: { ...view().planet, ships: {} },
    };
    session.busy = false;
    setPaintImpl(() => {});
    globalThis.fetch = async () => {
      requests += 1;
      return new Response("{}", { status: 200 });
    };

    try {
      await doGalaxySpy({ galaxy: 2, system: 9, slot: 4 });
      assert.equal(session.error, "No Whisper Probes in orbit.");
      assert.equal(requests, 0);
    } finally {
      globalThis.fetch = originalFetch;
      session.view = originalView;
      session.busy = false;
      clearFlash();
    }
  });

  it("consumes a galaxy attack prefill once instead of restoring the remembered step-2 draft", () => {
    const originalPage = session.activePage;
    const remembered = {
      ...blankFleetDraft(),
      step: 2 as const,
      counts: { scout: 1 },
    };
    Object.assign(window, {
      location: {
        href: "http://starhold.local/galaxy",
        pathname: "/galaxy",
        search: "",
        hash: "",
      },
      history: { pushState() {}, replaceState() {} },
    });
    rememberFleetDraft(remembered);
    session.activePage = "galaxy";

    doGalaxyFleetAction({ galaxy: 3, system: 8, slot: 7 }, "raid");
    assert.equal(session.activePage, "fleet");
    const emptyRoot = make({ tag: "div" }) as unknown as HTMLElement;
    const galaxyDraft = fleetDraftForPage(emptyRoot, "fleet");
    assert.equal(galaxyDraft?.mission, "raid");
    assert.deepEqual(galaxyDraft?.targetCoords, {
      galaxy: 3,
      system: 8,
      slot: 7,
    });
    assert.equal(galaxyDraft?.step, 1);
    assert.equal(session.pendingGalaxyFleetDraft, null);

    const nextDraft = fleetDraftForPage(emptyRoot, "fleet");
    assert.notEqual(nextDraft?.step, 2);
    assert.equal(rememberedFleetDraft()?.step, 2);

    session.activePage = originalPage;
    session.pendingGalaxyFleetDraft = null;
    rememberFleetDraft(null);
  });
});
