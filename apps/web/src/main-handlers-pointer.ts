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
  doResearch,
  doUpgrade,
} from "./main-actions";
import { collapseTips, toggleTip } from "./ui/render-tooltips";

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
      session.armedUpgrade =
        (upgradeBtn?.getAttribute("data-upgrade") as BuildingId | null) ?? null;
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
    },
    true,
  );

  const endPointer = (ev: Event) => {
    if (
      session.pointersDown === 0 &&
      !session.armedUpgrade &&
      !session.armedShip &&
      !session.armedDefense &&
      !session.armedResearch
    ) {
      return;
    }
    session.pointersDown = Math.max(0, session.pointersDown - 1);

    if (ev.type === "pointerup") {
      const upgradeId = session.armedUpgrade;
      const shipId = session.armedShip;
      const defenseId = session.armedDefense;
      const researchId = session.armedResearch;
      session.armedUpgrade = null;
      session.armedShip = null;
      session.armedDefense = null;
      session.armedResearch = null;
      if (upgradeId) {
        dispatchArmedUpgrade(upgradeId);
      } else if (shipId) {
        dispatchArmedShip(shipId);
      } else if (defenseId) {
        dispatchArmedDefense(defenseId);
      } else if (researchId) {
        dispatchArmedResearch(researchId);
      }
    } else {
      session.armedUpgrade = null;
      session.armedShip = null;
      session.armedDefense = null;
      session.armedResearch = null;
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
    armGestureGrace();
  });
}
