import type {
  BuildingId,
  DefenseId,
  OfficerId,
  ResearchId,
  ShipId,
} from "@starhold/game";
import {
  clearFlash,
  closestActionEl,
  readDefenseCount,
  readShipCount,
  root,
  schedulePaint,
  session,
  setFlash,
} from "./session";
import {
  doActivateOfficer,
  doBuild,
  doBuildDefense,
  doClaimDaily,
  doGalaxyNav,
  doJoin,
  doLaunchFleet,
  doRefresh,
  doResearch,
  doSelectPlanet,
  doUnlockSkill,
  doUpgrade,
} from "./main-actions";
import { readFleetForm } from "./main-fleet-form";
import { isNavPage } from "./ui/nav";

export function bindClickHandlers(): void {
  root.addEventListener(
    "click",
    (ev) => {
      if (Date.now() < session.suppressClickUntil) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const target = ev.target;
      if (!(target instanceof Element)) return;

      if (closestActionEl(target, "[data-dismiss-flash]")) {
        clearFlash();
        schedulePaint();
        return;
      }

      const navBtn = closestActionEl(target, "[data-nav]");
      if (navBtn) {
        ev.preventDefault();
        const page = navBtn.getAttribute("data-nav");
        if (isNavPage(page) && session.activePage !== page) {
          session.activePage = page;
          schedulePaint();
        }
        return;
      }

      const galaxyNav = closestActionEl(target, "[data-galaxy-nav]");
      if (galaxyNav) {
        ev.preventDefault();
        const dir = galaxyNav.getAttribute("data-galaxy-nav");
        if (dir === "prev" || dir === "next") void doGalaxyNav(dir);
        return;
      }

      const planetBtn = closestActionEl(target, "[data-select-planet]");
      if (planetBtn) {
        ev.preventDefault();
        const id = planetBtn.getAttribute("data-select-planet");
        if (id) void doSelectPlanet(id);
        return;
      }

      const upgradeBtn = closestActionEl(target, "[data-upgrade]");
      const upgradeId = upgradeBtn?.getAttribute("data-upgrade");
      if (upgradeId) {
        ev.preventDefault();
        ev.stopPropagation();
        void doUpgrade(upgradeId as BuildingId);
        return;
      }

      const shipBtn = closestActionEl(target, "[data-ship]");
      if (shipBtn) {
        if (shipBtn.getAttribute("data-locked") === "1") {
          ev.preventDefault();
          setFlash(
            "error",
            shipBtn.getAttribute("title") || "Shipyard level too low.",
          );
          schedulePaint();
          return;
        }
        const shipId = shipBtn.getAttribute("data-ship") as ShipId | null;
        if (shipId) {
          ev.preventDefault();
          ev.stopPropagation();
          void doBuild(shipId, readShipCount(shipId));
          return;
        }
      }

      const defenseBtn = closestActionEl(target, "[data-defense]");
      if (defenseBtn) {
        if (defenseBtn.getAttribute("data-locked") === "1") {
          ev.preventDefault();
          setFlash(
            "error",
            defenseBtn.getAttribute("title") || "Shipyard level too low.",
          );
          schedulePaint();
          return;
        }
        const defenseId = defenseBtn.getAttribute(
          "data-defense",
        ) as DefenseId | null;
        if (defenseId) {
          ev.preventDefault();
          ev.stopPropagation();
          void doBuildDefense(defenseId, readDefenseCount(defenseId));
          return;
        }
      }

      const researchBtn = closestActionEl(target, "[data-research]");
      if (researchBtn) {
        const researchId = researchBtn.getAttribute(
          "data-research",
        ) as ResearchId | null;
        if (researchId) {
          ev.preventDefault();
          ev.stopPropagation();
          void doResearch(researchId);
          return;
        }
      }

      if (closestActionEl(target, "[data-claim-daily]")) {
        ev.preventDefault();
        void doClaimDaily();
        return;
      }

      const officerBtn = closestActionEl(target, "[data-activate-officer]");
      if (officerBtn) {
        ev.preventDefault();
        const officerId = officerBtn.getAttribute(
          "data-activate-officer",
        ) as OfficerId | null;
        if (officerId) void doActivateOfficer(officerId);
        return;
      }

      const skillBtn = closestActionEl(target, "[data-unlock-skill]");
      if (skillBtn) {
        ev.preventDefault();
        const skillId = skillBtn.getAttribute("data-unlock-skill");
        if (skillId) void doUnlockSkill(skillId);
        return;
      }

      if (closestActionEl(target, "#refresh-btn")) {
        ev.preventDefault();
        void doRefresh();
      }
    },
    true,
  );

  root.addEventListener("change", (ev) => {
    const el = ev.target;
    if (
      el instanceof HTMLInputElement &&
      el.name === "fleet-mission" &&
      el.type === "radio"
    ) {
      schedulePaint();
    }
  });

  root.addEventListener("submit", (ev) => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "join-form") {
      ev.preventDefault();
      const input = form.querySelector<HTMLInputElement>("#commander");
      const value = input?.value ?? session.joinDraft;
      session.joinDraft = value;
      void doJoin(value);
      return;
    }

    if (form.id === "fleet-form") {
      ev.preventDefault();
      const draft = readFleetForm();
      if (!draft) {
        setFlash("error", "Pick a target and ships.");
        schedulePaint();
        return;
      }
      void doLaunchFleet(draft);
    }
  });

  root.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el instanceof HTMLInputElement && el.id === "commander") {
      session.joinDraft = el.value;
    }
  });
}
