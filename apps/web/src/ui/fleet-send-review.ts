import {
  ACS_HOLD_MAX_MS,
  ACS_JOIN_WINDOW_MS,
  OCCUPATION_DURATION_MS,
  type Coordinates,
  type MissionType,
} from "@starhold/game";
import { fmt, fmtCoords, fmtEta } from "./format";
import { escapeHtml } from "./render-escape";

/** Shown on every review. The client formula is not the full server stack. */
export const FLEET_REVIEW_LIMIT =
  "These times use cruise speed and drive research on this screen. Officers, class, and route bonuses are applied on the server and are not included. This is an estimate, not a promise.";

export type FleetReturnMode = "stay" | "estimated" | "conditional" | "unavailable";

export interface FleetSendReviewInput {
  mission: MissionType;
  missionLabel: string;
  coords: Coordinates | null;
  targetType: string;
  targetLabel: string;
  ownTarget: boolean;
  nowMs: number;
  timeZone: string;
  /** Full-cruise one-way seconds from the existing flight formula. Null if unknown. */
  cruiseSeconds: number | null;
  /** Full-cruise one-way deuterium. Null if unknown. */
  cruiseFuel: number | null;
  cargo: number;
  speedPercent: number;
  /** Speed-control preview. Not sent. */
  previewSeconds: number | null;
  previewFuel: number | null;
  openAcs: boolean;
  joiningAcs: boolean;
}

export interface FleetSendReview {
  missionLabel: string;
  coordsText: string | null;
  targetType: string;
  targetLabel: string;
  outboundSeconds: number | null;
  arrivalClock: string | null;
  fuel: number | null;
  cargo: number;
  speedPercent: number;
  speedNote: string;
  returnMode: FleetReturnMode;
  returnSeconds: number | null;
  returnClock: string | null;
  returnText: string;
  holdText: string;
  limitText: string;
}

export function fleetReviewTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Clock time with an explicit zone name. Duration stays a separate field. */
export function formatFleetClock(epochMs: number, timeZone: string): string {
  const zone = timeZone || "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(epochMs));
    return `${formatted} (${zone})`;
  } catch {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(epochMs));
    return `${formatted} (UTC)`;
  }
}

function spanLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds > 0 && seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds > 0 && seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds > 0 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return fmtEta(Math.max(0, seconds));
}

function acsHoldText(): string {
  return `Joint Strike may hold fleets at the target. The join window is ${spanLabel(ACS_JOIN_WINDOW_MS)}. A join is refused if it would hold longer than ${spanLabel(ACS_HOLD_MAX_MS)}. The return starts after the strike, or sooner if the group is cancelled. An exact return clock is not available.`;
}

export function buildFleetSendReview(input: FleetSendReviewInput): FleetSendReview {
  const known = input.coords != null && input.cruiseSeconds != null && input.cruiseFuel != null;
  const jump = input.mission === "jump";
  const outboundSeconds = !known ? null : jump ? 1 : input.cruiseSeconds;
  const fuel = known ? input.cruiseFuel : null;
  const arrivalClock =
    outboundSeconds == null
      ? null
      : formatFleetClock(input.nowMs + outboundSeconds * 1000, input.timeZone);
  const acs =
    (input.mission === "raid" || input.mission === "pirateRaid") &&
    (input.openAcs || input.joiningAcs);
  const leg =
    outboundSeconds == null
      ? null
      : `Duration about ${fmtEta(outboundSeconds * 2)} (flight out plus the same flight back).`;

  let returnMode: FleetReturnMode = "unavailable";
  let returnSeconds: number | null = null;
  let returnText = "Return is not shown. This screen will not invent a flight without a target.";
  let holdText = "Hold is not shown until a target is chosen.";

  if (known && outboundSeconds != null && leg) {
    if (jump) {
      returnMode = "stay";
      returnText = "No return flight. Ships stay on the destination moon.";
      holdText = "No hold. Moon Bridge arrival is about 1 second. Cruise speed is not used.";
    } else if (input.mission === "transport") {
      returnMode = "stay";
      returnText = "No return flight. Ships and cargo stay on your world.";
      holdText = "No hold.";
    } else if (input.mission === "deploy" && input.ownTarget) {
      returnMode = "stay";
      returnText = "No return flight. Ships stay at your world.";
      holdText = "No hold.";
    } else if (input.mission === "deploy") {
      returnMode = "estimated";
      returnSeconds = outboundSeconds * 2;
      returnText = `Estimated return, not a combat result. Deploy does not station ships on a foreign world. ${leg}`;
      holdText = "No extra hold.";
    } else if (input.mission === "harvest" || input.mission === "harvestAsteroid") {
      returnMode = "estimated";
      returnSeconds = outboundSeconds * 2;
      returnText = `Estimated return if the ships are still intact. ${leg} Not guaranteed if the fleet is gone.`;
      holdText = "No hold. Collection happens on arrival, then the return starts.";
    } else if (input.mission === "espionage") {
      returnMode = "estimated";
      returnSeconds = outboundSeconds * 2;
      returnText = `Estimated return if the target is still there. ${leg} If the target is gone, the server removes the fleet and there is no return.`;
      holdText = "No hold. The scan happens on arrival.";
    } else if (input.mission === "colonize") {
      returnMode = "conditional";
      returnText =
        "No guaranteed return. If the colony is founded, the remaining ships stay. If the slot is taken or the colony cannot be founded, the fleet flies back. This screen cannot know which will happen.";
      holdText = "No hold.";
    } else if (input.mission === "expedition") {
      returnMode = "conditional";
      returnText =
        "No guaranteed return. The expedition resolves on arrival. Survivors then fly back. A black hole or a total loss means there is no return, so no return clock is shown.";
      holdText =
        "No separate hold time. The server does not wait at the expedition slot before resolving.";
    } else if (input.mission === "occupy") {
      returnMode = "conditional";
      returnText = `No guaranteed return. A won fight with a Mothership can start an occupation. The occupation cap is ${spanLabel(OCCUPATION_DURATION_MS)}, and it ends when this fleet is gone. Survivors fly back, but losses make a return clock wrong, so none is shown.`;
      holdText = "No extra flight hold. Occupation time is not a hold you set on this form.";
    } else {
      returnMode = "conditional";
      returnText = acs
        ? "No guaranteed return. Survivors fly home after the strike. A total loss does not return, so no return clock is shown."
        : "No guaranteed return. Survivors fly home after the fight. A total loss does not return. A full-strength flight back would match the flight out, but this screen will not promise that.";
      holdText = acs
        ? acsHoldText()
        : "No Joint Strike hold. The fight starts on arrival.";
    }
  }

  const returnClock =
    returnMode === "estimated" && returnSeconds != null
      ? formatFleetClock(input.nowMs + returnSeconds * 1000, input.timeZone)
      : null;

  let speedNote =
    "Speed changes this preview only. Send still flies at full cruise — the server has no speed field.";
  if (jump) {
    speedNote =
      "Moon Bridge does not use the speed control. Arrival stays about 1 second. Speed changes this preview only. Send still flies at full cruise — the server has no speed field.";
  } else if (
    input.speedPercent !== 100 &&
    input.previewSeconds != null &&
    input.previewFuel != null
  ) {
    speedNote = `${speedNote} Speed ${fmt(input.speedPercent)}% preview only, not sent: flight ~${fmtEta(input.previewSeconds)} · fuel ~${fmt(input.previewFuel)} deut.`;
  }

  return {
    missionLabel: input.missionLabel,
    coordsText: input.coords ? fmtCoords(input.coords) : null,
    targetType: input.targetType,
    targetLabel: input.targetLabel,
    outboundSeconds,
    arrivalClock,
    fuel,
    cargo: input.cargo,
    speedPercent: input.speedPercent,
    speedNote,
    returnMode,
    returnSeconds,
    returnClock,
    returnText,
    holdText,
    limitText: FLEET_REVIEW_LIMIT,
  };
}

function row(label: string, testId: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd data-testid="${testId}">${value}</dd></div>`;
}

export function renderFleetSendReview(review: FleetSendReview): string {
  const destination = review.coordsText
    ? `${escapeHtml(review.coordsText)} · ${escapeHtml(review.targetType)}${
        review.targetLabel ? ` · ${escapeHtml(review.targetLabel)}` : ""
      }`
    : "Not available. Pick a target. No flight estimate is shown without one.";
  const duration =
    review.outboundSeconds == null
      ? "Not available."
      : `Duration ${fmtEta(review.outboundSeconds)}`;
  const arrival =
    review.arrivalClock == null
      ? "Not available. No clock is shown without a flight duration."
      : `Clock ${escapeHtml(review.arrivalClock)}`;
  const fuel =
    review.fuel == null
      ? "Not available."
      : `${fmt(review.fuel)} deuterium, one way, at full cruise. cargo ${fmt(review.cargo)}`;
  const ret =
    review.returnClock == null
      ? escapeHtml(review.returnText)
      : `${escapeHtml(review.returnText)} Clock ${escapeHtml(review.returnClock)}.`;
  return `
    <section class="fleet-review" data-testid="fleet-send-review" aria-label="Review before send">
      <h3>Review before send</h3>
      <dl>
        ${row("Mission", "fleet-review-mission", escapeHtml(review.missionLabel))}
        ${row("Destination", "fleet-review-destination", destination)}
        ${row("Flight out", "fleet-review-outbound", `<span data-testid="fleet-flight">${duration}</span>`)}
        ${row("Arrival", "fleet-review-arrival", arrival)}
        ${row("Launch fuel", "fleet-review-fuel", fuel)}
        ${row("Return", "fleet-review-return", ret)}
        ${row("Hold", "fleet-review-hold", escapeHtml(review.holdText))}
      </dl>
      <p class="hint" data-testid="fleet-review-limit">${escapeHtml(review.limitText)}</p>
      <p class="hint" data-testid="fleet-speed-note">${escapeHtml(review.speedNote)}</p>
    </section>`;
}
