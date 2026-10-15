import type {
  BuildingId,
  DefenseId,
  ResearchId,
  ShipId,
} from "@starhold/game";
import {
  GESTURE_PAINT_GRACE_MS,
  armGestureGrace,
  closestActionEl,
  readDefenseCount,
  readShipCount,
  root,
  session,
} from "./session";
import {
  doBuild,
  doBuildDefense,
  doMarkEventsRead,
  doResearch,
  doUpgrade,
} from "./main-actions";
import { collapseTips, positionTip, toggleTip } from "./ui/render-tooltips";

function dispatchArmedUpgrade(buildingId: BuildingId): void {
  session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  void doUpgrade(buildingId);
}

function dispatchArmedShip(shipId: ShipId): void {
  session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  void doBuild(shipId, readShipCount(shipId));
}

function dispatchArmedDefense(defenseId: DefenseId): void {
  session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  void doBuildDefense(defenseId, readDefenseCount(defenseId));
}

function dispatchArmedResearch(researchId: ResearchId): void {
  session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  void doResearch(researchId);
}

function dispatchArmedEventRead(
  armed: { kind: "one"; id: string } | { kind: "all" },
): void {
  session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  switch (armed.kind) {
    case "one":
      void doMarkEventsRead([armed.id]);
      return;
    case "all":
      void doMarkEventsRead();
      return;
    default: {
      const _exhaustive: never = armed;
      return _exhaustive;
    }
  }
}

export function bindPointerHandlers(): void {
  root.addEventListener(
    "pointerdown",
    (ev) => {
      session.pointersDown += 1;

      // Tap toggles tooltips on phones (hover is unreliable on touch).
      const tipEl = closestActionEl(ev.target, "[data-tip]");
      if (tipEl) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleTip(root, tipEl);
        session.suppressClickUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
        session.armedUpgrade = null;
        session.armedShip = null;
        session.armedDefense = null;
        session.armedResearch = null;
        return;
      }
      collapseTips(root);

      const upgradeBtn = closestActionEl(ev.target, "[data-upgrade]");
      const shipBtn = closestActionEl(ev.target, "[data-ship]");
      const defenseBtn = closestActionEl(ev.target, "[data-defense]");
      const researchBtn = closestActionEl(ev.target, "[data-research]");
      const readAllBtn = closestActionEl(ev.target, "[data-event-read-all]");
      const readOneBtn = closestActionEl(ev.target, "[data-event-read]");
      if (
        upgradeBtn?.getAttribute("data-locked") === "1" ||
        upgradeBtn?.hasAttribute("disabled")
      ) {
        session.armedUpgrade = null;
      } else {
        session.armedUpgrade =
          (upgradeBtn?.getAttribute("data-upgrade") as BuildingId | null) ??
          null;
      }
      if (shipBtn?.getAttribute("data-locked") === "1") {
        session.armedShip = null;
      } else {
        session.armedShip =
          (shipBtn?.getAttribute("data-ship") as ShipId | null) ?? null;
      }
      if (defenseBtn?.getAttribute("data-locked") === "1") {
        session.armedDefense = null;
      } else {
        session.armedDefense =
          (defenseBtn?.getAttribute("data-defense") as DefenseId | null) ??
          null;
      }
      if (researchBtn?.getAttribute("data-locked") === "1") {
        session.armedResearch = null;
      } else {
        session.armedResearch =
          (researchBtn?.getAttribute("data-research") as ResearchId | null) ??
          null;
      }
      if (readAllBtn && !readAllBtn.hasAttribute("disabled")) {
        session.armedEventRead = { kind: "all" };
      } else {
        const readId = readOneBtn?.getAttribute("data-event-read");
        session.armedEventRead =
          readOneBtn && !readOneBtn.hasAttribute("disabled") && readId
            ? { kind: "one", id: readId }
            : null;
      }
    },
    true,
  );

  const endPointer = (ev: Event) => {
    if (
      session.pointersDown === 0 &&
      !session.armedUpgrade &&
      !session.armedShip &&
      !session.armedDefense &&
      !session.armedResearch &&
      !session.armedEventRead
    ) {
      return;
    }
    session.pointersDown = Math.max(0, session.pointersDown - 1);

    if (ev.type === "pointerup") {
      const upgradeId = session.armedUpgrade;
      const shipId = session.armedShip;
      const defenseId = session.armedDefense;
      const researchId = session.armedResearch;
      const eventRead = session.armedEventRead;
      session.armedUpgrade = null;
      session.armedShip = null;
      session.armedDefense = null;
      session.armedResearch = null;
      session.armedEventRead = null;
      if (upgradeId) {
        dispatchArmedUpgrade(upgradeId);
      } else if (shipId) {
        dispatchArmedShip(shipId);
      } else if (defenseId) {
        dispatchArmedDefense(defenseId);
      } else if (researchId) {
        dispatchArmedResearch(researchId);
      } else if (eventRead) {
        dispatchArmedEventRead(eventRead);
      }
    } else {
      session.armedUpgrade = null;
      session.armedShip = null;
      session.armedDefense = null;
      session.armedResearch = null;
      session.armedEventRead = null;
    }

    if (session.pointersDown === 0) {
      armGestureGrace();
    }
  };
  window.addEventListener("pointerup", endPointer, true);
  window.addEventListener("pointercancel", endPointer, true);
  window.addEventListener("blur", () => {
    session.pointersDown = 0;
    session.armedUpgrade = null;
    session.armedShip = null;
    session.armedDefense = null;
    session.armedResearch = null;
    session.armedEventRead = null;
    armGestureGrace();
  });

  // Desktop hover / keyboard focus — flip tip before CSS shows the bubble.
  // pointerover bubbles (pointerenter does not).
  root.addEventListener(
    "pointerover",
    (ev) => {
      const tipEl = closestActionEl(ev.target, "[data-tip]");
      if (!tipEl) return;
      const related = (ev as PointerEvent).relatedTarget;
      if (related instanceof Node && tipEl.contains(related)) return;
      positionTip(tipEl);
    },
    true,
  );
  root.addEventListener(
    "focusin",
    (ev) => {
      const tipEl = closestActionEl(ev.target, "[data-tip]");
      if (tipEl) positionTip(tipEl);
    },
    true,
  );
}
