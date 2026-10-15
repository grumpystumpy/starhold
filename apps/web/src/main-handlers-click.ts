import {
  formatCombatShareCard,
  fortressRelocateDeutCost,
  fortressRelocateLandingWindow,
  MINI_FORTRESS_RELOCATE_ACCURACY,
  type BuildingId,
  type DefenseId,
  type OfficerId,
  type PlayerClassId,
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
  doChangeClass,
  doChooseClass,
  doClaimDaily,
  doClaimGoal,
  doCreateAlliance,
  doDeleteAllianceIntel,
  doDeleteAllianceMarker,
  doDeleteFleetPreset,
  doDisbandAlliance,
  doGalaxyNav,
  doClaimAnonymous,
  doInviteAlliance,
  doJoin,
  doJoinAlliance,
  doKickAllianceMember,
  doLaunchFleet,
  doLaunchMaxExpeditions,
  doLeaveAlliance,
  doPostAllianceChat,
  doProposeJointStrike,
  doRaiseOfficer,
  doRefresh,
  doRenamePlanet,
  doRelocateFortress,
  doLogin,
  doSignup,
  doResearch,
  doSaveFleetPreset,
  doScanSystem,
  doClaimSeason,
  doSelectPlanet,
  doDeleteMessages,
  doMarkEventsRead,
  doSetAllianceJoinMode,
  doSetAllianceRole,
  doSetSeasonSkin,
  doSetSeasonTitle,
  doShareAllianceIntel,
  doUpsertAllianceMarker,
  fleetStrikeTarget,
  doUnlockSkill,
  doUpgrade,
} from "./main-actions";
import {
  isInboxFilter,
  setConfirmDelete,
  setInboxFilter,
} from "./ui/render-messages";
import {
  setBattleReplayRound,
  toggleBattleReplay,
} from "./ui/render-fleets-panels";
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

      const filterBtn = closestActionEl(target, "button[data-inbox-filter]");
      if (filterBtn) {
        ev.preventDefault();
        const raw = filterBtn.getAttribute("data-inbox-filter");
        if (isInboxFilter(raw)) {
          setInboxFilter(raw);
          schedulePaint();
        }
        return;
      }

      const readOne = closestActionEl(target, "[data-event-read]");
      if (readOne) {
        ev.preventDefault();
        const id = readOne.getAttribute("data-event-read");
        if (id) void doMarkEventsRead([id]);
        return;
      }

      if (closestActionEl(target, "[data-event-read-all]")) {
        ev.preventDefault();
        void doMarkEventsRead();
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

      const seasonClaim = closestActionEl(target, "[data-season-claim]");
      if (seasonClaim) {
        ev.preventDefault();
        const board = seasonClaim.getAttribute("data-season-claim");
        const seasonId = seasonClaim.getAttribute("data-season-id");
        if (board) void doClaimSeason(board, seasonId);
        return;
      }

      const upgradeBtn = closestActionEl(target, "[data-upgrade]");
      const upgradeId = upgradeBtn?.getAttribute("data-upgrade");
      if (upgradeId && upgradeBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        if (
          upgradeBtn.getAttribute("data-locked") === "1" ||
          upgradeBtn.hasAttribute("disabled")
        ) {
          setFlash(
            "error",
            upgradeBtn.getAttribute("title") || "Cannot upgrade that structure.",
          );
          schedulePaint();
          return;
        }
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
          if (
            researchBtn.getAttribute("data-locked") === "1" ||
            researchBtn.hasAttribute("disabled")
          ) {
            setFlash(
              "error",
              researchBtn.getAttribute("title") || "Cannot start that research.",
            );
            schedulePaint();
            return;
          }
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

      const replaySummary = closestActionEl(
        target,
        "[data-battle-replay-summary]",
      );
      if (replaySummary) {
        ev.preventDefault();
        const id = replaySummary.getAttribute("data-battle-replay-summary");
        const first = Number(
          replaySummary.getAttribute("data-first-round") || "1",
        );
        if (id) toggleBattleReplay(id, Number.isFinite(first) ? first : 1);
        schedulePaint();
        return;
      }

      const roundTab = closestActionEl(target, "[data-battle-round-tab]");
      if (roundTab) {
        ev.preventDefault();
        const round = Number(roundTab.getAttribute("data-battle-round-tab"));
        const reportId = roundTab
          .closest("details")
          ?.getAttribute("data-battle-report");
        if (!reportId || !Number.isFinite(round)) return;
        setBattleReplayRound(reportId, round);
        schedulePaint();
        return;
      }

      const goalBtn = closestActionEl(target, "[data-claim-goal]");
      if (goalBtn) {
        ev.preventDefault();
        const goalId = goalBtn.getAttribute("data-claim-goal");
        if (goalId) void doClaimGoal(goalId);
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

      const raiseOfficerBtn = closestActionEl(target, "[data-raise-officer]");
      if (raiseOfficerBtn) {
        ev.preventDefault();
        const officerId = raiseOfficerBtn.getAttribute(
          "data-raise-officer",
        ) as OfficerId | null;
        if (officerId) void doRaiseOfficer(officerId);
        return;
      }

      const deleteMessages = closestActionEl(target, "[data-delete-messages]");
      if (deleteMessages) {
        ev.preventDefault();
        const category = deleteMessages.getAttribute("data-delete-messages");
        if (isInboxFilter(category)) {
          setConfirmDelete(category);
          schedulePaint();
        }
        return;
      }

      const confirmDelete = closestActionEl(
        target,
        "[data-delete-messages-confirm]",
      );
      if (confirmDelete) {
        ev.preventDefault();
        const category = confirmDelete.getAttribute(
          "data-delete-messages-confirm",
        );
        setConfirmDelete(null);
        if (isInboxFilter(category)) void doDeleteMessages(category);
        else schedulePaint();
        return;
      }

      if (closestActionEl(target, "[data-delete-messages-cancel]")) {
        ev.preventDefault();
        setConfirmDelete(null);
        schedulePaint();
        return;
      }

      const chooseClassBtn = closestActionEl(target, "[data-choose-class]");
      if (chooseClassBtn) {
        ev.preventDefault();
        const classId = chooseClassBtn.getAttribute(
          "data-choose-class",
        ) as PlayerClassId | null;
        if (classId) void doChooseClass(classId);
        return;
      }

      const changeClassBtn = closestActionEl(target, "[data-change-class]");
      if (changeClassBtn) {
        ev.preventDefault();
        const classId = changeClassBtn.getAttribute(
          "data-change-class",
        ) as PlayerClassId | null;
        if (classId) void doChangeClass(classId);
        return;
      }

      if (closestActionEl(target, "#refresh-btn")) {
        ev.preventDefault();
        void doRefresh();
      }

      const joinAlly = closestActionEl(target, "[data-alliance-join]");
      if (joinAlly) {
        ev.preventDefault();
        const id = joinAlly.getAttribute("data-alliance-join");
        if (id) void doJoinAlliance(id);
        return;
      }

      if (closestActionEl(target, "[data-alliance-leave]")) {
        ev.preventDefault();
        void doLeaveAlliance();
        return;
      }

      if (closestActionEl(target, "[data-alliance-disband]")) {
        ev.preventDefault();
        void doDisbandAlliance();
        return;
      }

      const kickBtn = closestActionEl(target, "[data-alliance-kick]");
      if (kickBtn) {
        ev.preventDefault();
        const id = kickBtn.getAttribute("data-alliance-kick");
        if (id) void doKickAllianceMember(id);
        return;
      }

      const promoteBtn = closestActionEl(target, "[data-alliance-promote]");
      if (promoteBtn) {
        ev.preventDefault();
        const id = promoteBtn.getAttribute("data-alliance-promote");
        if (id) void doSetAllianceRole(id, "officer");
        return;
      }

      const transferBtn = closestActionEl(target, "[data-alliance-transfer]");
      if (transferBtn) {
        ev.preventDefault();
        const id = transferBtn.getAttribute("data-alliance-transfer");
        if (id) void doSetAllianceRole(id, "founder");
        return;
      }

      const shareBtn = closestActionEl(target, "[data-share-intel]");
      if (shareBtn) {
        ev.preventDefault();
        const id = shareBtn.getAttribute("data-share-intel");
        if (id) void doShareAllianceIntel(id);
        return;
      }

      const intelDelete = closestActionEl(target, "[data-alliance-intel-delete]");
      if (intelDelete) {
        ev.preventDefault();
        const id = intelDelete.getAttribute("data-alliance-intel-delete");
        if (id) void doDeleteAllianceIntel(id);
        return;
      }

      const markerDelete = closestActionEl(
        target,
        "[data-alliance-marker-remove]",
      );
      if (markerDelete) {
        ev.preventDefault();
        const id = markerDelete.getAttribute("data-alliance-marker-remove");
        if (id) void doDeleteAllianceMarker(id);
        return;
      }

      const markBtn = closestActionEl(target, "[data-galaxy-mark]");
      if (markBtn) {
        ev.preventDefault();
        const slot = Number(markBtn.getAttribute("data-galaxy-mark"));
        const galaxy = session.view?.galaxy;
        if (galaxy && Number.isInteger(slot)) {
          const note =
            root.querySelector<HTMLInputElement>("#galaxy-marker-note")?.value ??
            "";
          void doUpsertAllianceMarker(
            { galaxy: galaxy.galaxy, system: galaxy.system, slot },
            note,
          );
        }
        return;
      }

      const proposeSlot = closestActionEl(target, "[data-galaxy-propose]");
      if (proposeSlot) {
        ev.preventDefault();
        const slot = Number(proposeSlot.getAttribute("data-galaxy-propose"));
        const galaxy = session.view?.galaxy;
        if (galaxy && Number.isInteger(slot)) {
          const note =
            root.querySelector<HTMLInputElement>("#galaxy-marker-note")?.value ??
            "";
          const pirate = galaxy.pirateBase;
          const mission =
            pirate &&
            pirate.coords.galaxy === galaxy.galaxy &&
            pirate.coords.system === galaxy.system &&
            pirate.coords.slot === slot
              ? "pirateRaid"
              : "raid";
          void doProposeJointStrike(
            { galaxy: galaxy.galaxy, system: galaxy.system, slot },
            note,
            mission,
          );
        }
        return;
      }

      if (closestActionEl(target, "[data-propose-strike]")) {
        ev.preventDefault();
        const picked = fleetStrikeTarget();
        if (!picked) {
          setFlash("error", "Pick a planet or coordinates for Joint Strike.");
          schedulePaint();
          return;
        }
        void doProposeJointStrike(picked.coords, undefined, picked.mission);
        return;
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
      el instanceof HTMLSelectElement &&
      el.matches("[data-alliance-join-mode-select]")
    ) {
      const mode = el.value === "invite" ? "invite" : "open";
      void doSetAllianceJoinMode(mode);
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
      return;
    }

    if (form.id === "fortress-relocate-form") {
      ev.preventDefault();
      const gEl = form.querySelector<HTMLInputElement>("#fortress-aim-galaxy");
      const sEl = form.querySelector<HTMLInputElement>("#fortress-aim-system");
      const g = Number(gEl?.value ?? 0);
      const s = Number(sEl?.value ?? 0);
      void doRelocateFortress(g, s);
      return;
    }

    if (form.id === "alliance-create-form") {
      ev.preventDefault();
      const nameInput = form.querySelector<HTMLInputElement>(
        '[name="alliance-name"]',
      );
      const tagInput = form.querySelector<HTMLInputElement>(
        '[name="alliance-tag"]',
      );
      const modeSelect = form.querySelector<HTMLSelectElement>(
        '[name="alliance-join-mode"]',
      );
      const joinMode = modeSelect?.value === "invite" ? "invite" : "open";
      void doCreateAlliance(
        nameInput?.value ?? "",
        tagInput?.value ?? "",
        joinMode,
      );
      return;
    }

    if (form.id === "alliance-invite-form") {
      ev.preventDefault();
      const input = form.querySelector<HTMLInputElement>(
        '[name="alliance-invite-id"]',
      );
      void doInviteAlliance(input?.value?.trim() ?? "");
      return;
    }

    if (form.id === "alliance-chat-form") {
      ev.preventDefault();
      const input = form.querySelector<HTMLInputElement>(
        '[name="alliance-chat-body"]',
      );
      void doPostAllianceChat(input?.value ?? "");
      return;
    }
  });

  root.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLSelectElement)) return;
    if (el.hasAttribute("data-season-title")) {
      void doSetSeasonTitle(el.value);
      return;
    }
    if (el.hasAttribute("data-season-skin")) {
      void doSetSeasonSkin(el.value);
    }
  });

  root.addEventListener("input", (ev) => {
    const el = ev.target;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      el.dataset.userEdited = "1";
    }
    if (el instanceof HTMLInputElement && el.id === "commander") {
      session.joinDraft = el.value;
    }
    if (el instanceof HTMLInputElement && el.id === "auth-email") {
      session.emailDraft = el.value;
    }
    if (el instanceof HTMLInputElement && el.id === "auth-password") {
      session.passwordDraft = el.value;
    }
    if (
      el instanceof HTMLInputElement &&
      (el.id === "fortress-aim-galaxy" || el.id === "fortress-aim-system")
    ) {
      const form = el.closest("#fortress-relocate-form");
      const hint = root.querySelector<HTMLElement>(
        "[data-testid='fortress-landing-window']",
      );
      if (!form || !hint || !session.view) return;
      const g = Number(
        form.querySelector<HTMLInputElement>("#fortress-aim-galaxy")?.value ??
          0,
      );
      const s = Number(
        form.querySelector<HTMLInputElement>("#fortress-aim-system")?.value ??
          0,
      );
      const win = fortressRelocateLandingWindow(g, s);
      const cost = fortressRelocateDeutCost(session.view.planet.coords, g, s);
      hint.innerHTML = `Aim a system in an allowed galaxy. Landing window for current aim: <strong>${win.galaxy}:${win.systemMin}–${win.galaxy}:${win.systemMax}</strong> (±${MINI_FORTRESS_RELOCATE_ACCURACY} systems). Free mini slot on landing. Est. cost at current aim: ${cost} deut.`;
    }
  });
}
