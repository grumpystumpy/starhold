import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACS_HOLD_MAX_MS,
  ACS_JOIN_WINDOW_MS,
  OCCUPATION_DURATION_MS,
  fuelCostOneWay,
  normalizeFleetShips,
  type PlayerView,
} from "@starhold/game";
import {
  buildFleetSendReview,
  fleetReviewTimeZone,
  formatFleetClock,
  renderFleetSendReview,
  type FleetSendReviewInput,
} from "./fleet-send-review";
import { napAttackDecision, napAttackWarning } from "./nap-attack";
import { fleetComposer } from "./render-fleets-composer";
import {
  blankFleetDraft,
  fleetDraftAfterPreset,
  type FleetDraft,
} from "./render-fleets-draft";

function input(partial: Partial<FleetSendReviewInput> = {}): FleetSendReviewInput {
  return {
    mission: "harvest",
    missionLabel: "Harvest debris",
    coords: { galaxy: 1, system: 1, slot: 4 },
    targetType: "debris",
    targetLabel: "Debris 1:1:4",
    ownTarget: false,
    nowMs: 1_700_000_000_000,
    timeZone: "UTC",
    cruiseSeconds: 120,
    cruiseFuel: 40,
    cargo: 100,
    speedPercent: 100,
    previewSeconds: 120,
    previewFuel: 40,
    openAcs: false,
    joiningAcs: false,
    ...partial,
  };
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
      ships: { scout: 5 },
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
    ownedPlanets: [
      {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 8 },
        isHome: true,
        isActive: true,
        isMoon: false,
      },
      {
        id: "pl9",
        name: "Far Holding",
        coords: { galaxy: 1, system: 1, slot: 3 },
        isHome: false,
        isActive: false,
        isMoon: false,
      },
    ],
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
    openAcsGroups: [
      {
        id: "acs_join_1",
        mission: "raid",
        fleetIds: ["flt_a", "flt_b"],
        joinClosesAt: 1_700_000_000_000 + 60_000,
      },
    ],
  } as unknown as PlayerView;
}

function draft(partial: Partial<FleetDraft>): FleetDraft {
  return {
    ...blankFleetDraft(),
    step: 2,
    counts: { scout: 1 },
    ...partial,
  };
}

describe("fleet send review", () => {
  it("estimates a return for harvest and labels duration apart from the clock", () => {
    const review = buildFleetSendReview(input());
    assert.equal(review.returnMode, "estimated");
    assert.equal(review.outboundSeconds, 120);
    assert.equal(review.returnSeconds, 240);
    assert.equal(review.fuel, 40);
    assert.match(review.returnText, /Estimated return/);
    assert.match(review.returnText, /Not guaranteed/);
    assert.doesNotMatch(review.returnText, /Guaranteed return/);
    assert.match(review.holdText, /No hold/);
    assert.equal(
      review.arrivalClock,
      formatFleetClock(1_700_000_000_000 + 120_000, "UTC"),
    );
    assert.match(review.arrivalClock ?? "", /UTC/);
    const html = renderFleetSendReview(review);
    assert.match(html, /data-testid="fleet-review-outbound"/);
    assert.match(html, /Duration /);
    assert.match(html, /data-testid="fleet-review-arrival"/);
    assert.match(html, /Clock /);
    assert.match(html, /<dl>/);
    assert.doesNotMatch(html, /title=/);
  });

  it("does not promise a return for station, transport, or Moon Bridge", () => {
    const station = buildFleetSendReview(
      input({ mission: "deploy", missionLabel: "Station / Deploy (one-way)", ownTarget: true }),
    );
    assert.equal(station.returnMode, "stay");
    assert.equal(station.returnClock, null);
    assert.match(station.returnText, /No return flight/);

    const haul = buildFleetSendReview(
      input({ mission: "transport", missionLabel: "Transport cargo (own worlds)" }),
    );
    assert.equal(haul.returnMode, "stay");
    assert.equal(haul.returnClock, null);

    const jump = buildFleetSendReview(
      input({
        mission: "jump",
        missionLabel: "Moon Bridge (moon → moon)",
        cruiseSeconds: 900,
        ownTarget: true,
      }),
    );
    assert.equal(jump.outboundSeconds, 1);
    assert.equal(jump.returnMode, "stay");
    assert.equal(jump.returnClock, null);
    assert.match(jump.speedNote, /Moon Bridge does not use the speed control/);
    assert.match(jump.holdText, /1 second/);
  });

  it("refuses a return clock for colonize, expedition, occupy, and combat", () => {
    const colonize = buildFleetSendReview(
      input({ mission: "colonize", missionLabel: "Colonize empty slot" }),
    );
    assert.equal(colonize.returnMode, "conditional");
    assert.equal(colonize.returnClock, null);
    assert.match(colonize.returnText, /No guaranteed return/);

    const expedition = buildFleetSendReview(
      input({ mission: "expedition", missionLabel: "Expedition (deep space)" }),
    );
    assert.equal(expedition.returnClock, null);
    assert.match(expedition.holdText, /No separate hold/);
    assert.match(expedition.returnText, /black hole/);

    const occupy = buildFleetSendReview(
      input({ mission: "occupy", missionLabel: "Occupation (Mothership)" }),
    );
    assert.equal(occupy.returnClock, null);
    assert.match(occupy.returnText, /2 days/);
    assert.equal(OCCUPATION_DURATION_MS, 2 * 24 * 60 * 60 * 1000);

    const raid = buildFleetSendReview(
      input({ mission: "raid", missionLabel: "Raid / attack" }),
    );
    assert.equal(raid.returnClock, null);
    assert.match(raid.holdText, /No Joint Strike/);
    assert.match(raid.returnText, /will not promise/);

    const strike = buildFleetSendReview(
      input({ mission: "raid", missionLabel: "Raid / attack", openAcs: true }),
    );
    assert.equal(strike.returnClock, null);
    assert.match(strike.holdText, /15 minutes/);
    assert.match(strike.holdText, /30 minutes/);
    assert.equal(ACS_JOIN_WINDOW_MS, 15 * 60 * 1000);
    assert.equal(ACS_HOLD_MAX_MS, 30 * 60 * 1000);
  });

  it("does not invent a flight when the destination is missing", () => {
    const review = buildFleetSendReview(
      input({ coords: null, cruiseSeconds: null, cruiseFuel: null, previewSeconds: null, previewFuel: null }),
    );
    assert.equal(review.outboundSeconds, null);
    assert.equal(review.arrivalClock, null);
    assert.equal(review.fuel, null);
    assert.equal(review.returnClock, null);
    assert.match(review.returnText, /will not invent/);
    const html = renderFleetSendReview(review);
    assert.match(html, /Not available/);
  });

  it("recalculates when speed, ships, or target change and keeps launch fuel at full cruise", () => {
    const full = buildFleetSendReview(input({ mission: "raid", missionLabel: "Raid / attack" }));
    const slow = buildFleetSendReview(
      input({
        mission: "raid",
        missionLabel: "Raid / attack",
        speedPercent: 40,
        previewSeconds: 300,
        previewFuel: 16,
      }),
    );
    assert.equal(full.fuel, slow.fuel);
    assert.equal(full.outboundSeconds, slow.outboundSeconds);
    assert.match(slow.speedNote, /not sent/);
    assert.match(slow.speedNote, /fuel ~16 deut/);
    assert.doesNotMatch(full.speedNote, /not sent: flight/);

    const nearer = buildFleetSendReview(
      input({ mission: "raid", missionLabel: "Raid / attack", cruiseSeconds: 30, cruiseFuel: 8 }),
    );
    assert.notEqual(nearer.outboundSeconds, full.outboundSeconds);
    assert.notEqual(nearer.fuel, full.fuel);

    const other = buildFleetSendReview(
      input({
        mission: "raid",
        missionLabel: "Raid / attack",
        coords: { galaxy: 2, system: 3, slot: 4 },
        targetLabel: "Attack Veteran",
      }),
    );
    assert.match(renderFleetSendReview(other), /2:3:4/);
    assert.doesNotMatch(renderFleetSendReview(full), /2:3:4/);
  });

  it("shows the review on the composer and clamps preset and max counts to orbit", () => {
    const preset = fleetDraftAfterPreset(blankFleetDraft(), "raid", { scout: 2 });
    const html = fleetComposer(view(), false, preset);
    assert.match(html, /data-testid="fleet-send-review"/);
    assert.match(html, /data-testid="fleet-review-mission"[^>]*>Raid \/ attack/);
    assert.match(html, /value="2"/);
    assert.match(html, /2× Recon Drone/);
    assert.doesNotMatch(html, /99×/);
    assert.match(html, new RegExp(fleetReviewTimeZone().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const maxed = fleetComposer(
      view(),
      false,
      draft({ mission: "raid", targetPlanetId: "pl2", counts: { scout: 99 } }),
    );
    assert.match(maxed, /value="5"/);
    assert.match(maxed, /5× Recon Drone/);
    assert.doesNotMatch(maxed, /99×/);
    const fuel = fuelCostOneWay(
      { galaxy: 1, system: 1, slot: 8 },
      { galaxy: 1, system: 1, slot: 1 },
      normalizeFleetShips({ scout: 5 }),
    );
    assert.match(maxed, new RegExp(`${fuel} deuterium, one way`));

    const own = fleetComposer(
      view(),
      false,
      draft({ mission: "deploy", targetPlanetId: "pl9", counts: { scout: 1 } }),
    );
    assert.match(own, /No return flight/);
    assert.match(own, /Far Holding/);

    const foreign = fleetComposer(
      view(),
      false,
      draft({ mission: "deploy", targetPlanetId: "pl2", counts: { scout: 1 } }),
    );
    assert.match(foreign, /Estimated return, not a combat result/);

    const joined = fleetComposer(
      view(),
      false,
      draft({
        mission: "raid",
        targetPlanetId: "pl2",
        counts: { scout: 1 },
        acsGroupId: "acs_join_1",
        openAcs: true,
      }),
    );
    assert.match(joined, /value="acs_join_1" selected/);
    assert.match(joined, /15 minutes/);
    assert.match(joined, /No guaranteed return/);
  });

  it("warns on a NAP attack and still leaves Send enabled", () => {
    const base = view();
    const pact = {
      ...base,
      roster: [{ ...base.roster[0], allianceTag: "FOE" }],
      alliance: {
        id: "ally_1",
        tag: "SOL",
        relations: [
          {
            allianceId: "ally_foe",
            name: "Foes",
            tag: "FOE",
            kind: "nap",
            status: "active",
            initiatedBy: "ally_1",
            since: 1,
            canAccept: false,
            canCancel: true,
          },
        ],
      },
    } as unknown as PlayerView;
    const warning = napAttackWarning(pact, { mission: "raid", planetId: "pl2" });
    assert.match(warning ?? "", /Non-aggression pact with \[FOE\]/);
    assert.match(warning ?? "", /This attack is allowed/);
    assert.equal(napAttackDecision(warning, () => false), "stop");
    assert.equal(napAttackDecision(warning, () => true), "send");
    assert.equal(napAttackDecision(null, () => false), "send");
    assert.equal(napAttackDecision(warning, undefined), "send");
    assert.equal(napAttackWarning(pact, { mission: "espionage", planetId: "pl2" }), null);
    assert.equal(
      napAttackWarning(
        {
          ...pact,
          alliance: {
            ...pact.alliance!,
            relations: [{ ...pact.alliance!.relations![0]!, kind: "war", status: "active" }],
          },
        } as PlayerView,
        { mission: "raid", planetId: "pl2" },
      ),
      null,
    );
    const html = fleetComposer(
      pact,
      false,
      draft({ mission: "raid", targetPlanetId: "pl2", counts: { scout: 1 } }),
    );
    assert.match(html, /data-testid="fleet-nap-warning"/);
    assert.match(html, /This attack is allowed/);
    const button = html.match(/<button[^>]*data-testid="launch-fleet"[^>]*>/)?.[0] ?? "";
    assert.doesNotMatch(button, /disabled/);
  });

  it("stacks the review on a phone width without a hover-only fact", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./styles-base.css", import.meta.url)),
      "utf8",
    );
    const block = css.slice(css.indexOf(".fleet-review {"));
    assert.match(block, /@media \(max-width: 640px\)/);
    assert.match(block, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.doesNotMatch(block.slice(0, block.indexOf(".fleet-speed")), /:hover/);
  });
});
