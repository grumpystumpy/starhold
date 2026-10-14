import {
  formatCombatShareCard,
  type BuildingId,
  type DefenseId,
  type OfficerId,
  type ResearchId,
  type ShipId,
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
  doApplyFleetPreset,
  doBuild,
  doBuildDefense,
  doCancelQueue,
  doClaimDaily,
  doDeleteFleetPreset,
  doGalaxyNav,
  doClaimAnonymous,
  doJoin,
  doLaunchFleet,
  doLaunchMaxExpeditions,
  doRefresh,
  doRenamePlanet,
  doLogin,
  doSignup,
  doResearch,
  doSaveFleetPreset,
  doScanSystem,
  doSelectPlanet,
  doUnlockSkill,
  doUpgrade,
} from "./main-actions";
import { readFleetForm } from "./main-fleet-form";
import { resolveNavPage } from "./ui/nav";
import { navigateTo } from "./ui/router";

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

      if (closestActionEl(target, "[data-claim-anonymous]")) {
        ev.preventDefault();
        void doClaimAnonymous();
        return;
      }

      const navBtn = closestActionEl(target, "[data-nav]");
      if (navBtn) {
        ev.preventDefault();
        const page = resolveNavPage(navBtn.getAttribute("data-nav"));
        if (page) navigateTo(page);
        return;
      }

      const galaxyNav = closestActionEl(target, "[data-galaxy-nav]");
      if (galaxyNav) {
        ev.preventDefault();
        const dir = galaxyNav.getAttribute("data-galaxy-nav");
        if (dir === "prev" || dir === "next") void doGalaxyNav(dir);
        return;
      }

      if (closestActionEl(target, "[data-galaxy-max-expeditions]")) {
        ev.preventDefault();
        void doLaunchMaxExpeditions();
        return;
      }

      if (closestActionEl(target, "[data-galaxy-scan-system]")) {
        ev.preventDefault();
        void doScanSystem();
        return;
      }

      if (closestActionEl(target, "[data-fleet-preset-apply]")) {
        ev.preventDefault();
        doApplyFleetPreset();
        return;
      }

      if (closestActionEl(target, "[data-fleet-preset-save]")) {
        ev.preventDefault();
        void doSaveFleetPreset();
        return;
      }

      if (closestActionEl(target, "[data-fleet-preset-delete]")) {
        ev.preventDefault();
        void doDeleteFleetPreset();
        return;
      }

      const planetBtn = closestActionEl(target, "[data-select-planet]");
      if (planetBtn) {
        ev.preventDefault();
        const id = planetBtn.getAttribute("data-select-planet");
        if (id) void doSelectPlanet(id);
        return;
      }

      const cancelBtn = closestActionEl(target, "[data-queue-cancel]");
      if (cancelBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const kind = cancelBtn.getAttribute("data-queue-cancel") as
          | "building"
          | "ship"
          | "defense"
          | "research"
          | null;
        const itemId = cancelBtn.getAttribute("data-queue-item");
        if (kind && itemId) void doCancelQueue(kind, itemId);
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

      const copyShare = closestActionEl(target, "[data-copy-battle-share]");
      if (copyShare) {
        ev.preventDefault();
        const reportId = copyShare.getAttribute("data-copy-battle-share");
        const report = session.view?.reports?.find((r) => r.id === reportId);
        if (!report) {
          setFlash("error", "Battle report not found.");
          schedulePaint();
          return;
        }
        const text = formatCombatShareCard(report, session.view?.player.id);
        void navigator.clipboard.writeText(text).then(
          () => {
            setFlash("notice", "Battle share copied.");
            schedulePaint();
          },
          () => {
            setFlash("error", "Could not copy share text.");
            schedulePaint();
          },
        );
        return;
      }

      const roundTab = closestActionEl(target, "[data-battle-round-tab]");
      if (roundTab) {
        ev.preventDefault();
        const round = roundTab.getAttribute("data-battle-round-tab");
        const details = roundTab.closest("details");
        if (!round || !details) return;
        for (const tab of details.querySelectorAll("[data-battle-round-tab]")) {
          tab.classList.toggle(
            "is-active",
            tab.getAttribute("data-battle-round-tab") === round,
          );
        }
        for (const pane of details.querySelectorAll("[data-battle-round]")) {
          const match = pane.getAttribute("data-battle-round") === round;
          if (match) pane.removeAttribute("hidden");
          else pane.setAttribute("hidden", "");
        }
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
    if (el instanceof HTMLSelectElement && el.matches("[data-nav-select]")) {
      const page = resolveNavPage(el.value);
      if (page) navigateTo(page);
      return;
    }
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

    if (form.id === "auth-form") {
      ev.preventDefault();
      const emailInput = form.querySelector<HTMLInputElement>("#auth-email");
      const passwordInput =
        form.querySelector<HTMLInputElement>("#auth-password");
      const email = emailInput?.value ?? session.emailDraft;
      const password = passwordInput?.value ?? session.passwordDraft;
      session.emailDraft = email;
      session.passwordDraft = password;
      const submitter = (ev as SubmitEvent).submitter;
      const action =
        submitter instanceof HTMLButtonElement
          ? submitter.dataset.authAction
          : "login";
      if (action === "signup") {
        void doSignup(email, password);
      } else {
        void doLogin(email, password);
      }
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
      return;
    }

    if (form.id === "planet-rename-form") {
      ev.preventDefault();
      const input = form.querySelector<HTMLInputElement>(
        "#planet-rename-input",
      );
      void doRenamePlanet(input?.value ?? "");
    }
  });

  root.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el instanceof HTMLInputElement && el.id === "commander") {
      session.joinDraft = el.value;
    }
    if (el instanceof HTMLInputElement && el.id === "auth-email") {
      session.emailDraft = el.value;
    }
    if (el instanceof HTMLInputElement && el.id === "auth-password") {
      session.passwordDraft = el.value;
    }
  });
}
