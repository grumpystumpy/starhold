import type { PlayerView } from "@starhold/game";
import { forgetSoundBaseline, observeViewSounds } from "../settings";
import { session } from "../session";
import { startCountdownTick } from "./countdown";
import type { NavPage } from "./nav";
import { morphHtml } from "./morph-dom";
import { canPatchShell, patchLiveChrome } from "./patch-chrome";
import { syncVacationBanner, syncWhatsNewPopup } from "./render-shell";
import { renderJoin, reconnectScreenHtml } from "./render-chrome";
import { creditsPageHtml } from "./render-credits";
import {
  fleetDraftWithAcsPrefill,
  salvageFleetForm,
  type FleetDraft,
} from "./render-fleets";
import { dashboardHtml, mainColumnHtml } from "./render-dashboard";
import type { UiHandlers } from "./render-helpers";
import {
  eventsBannerHtml,
  startEventsCountdown,
  stopEventsCountdown,
  watchFleetLaunches,
} from "./render-events";

/**
 * Render UI. Interactive actions are handled by event delegation in main.ts
 * so background poll re-renders do not drop click listeners mid-gesture.
 * Poll refreshes patch the shell and the open page in place so focus,
 * scroll position, and typed field values survive.
 */
function syncBackdrop(signedInView: boolean, page: NavPage): void {
  if (typeof document === "undefined") return;
  const bg =
    !signedInView
      ? "join"
      : page === "galaxy" && !session.accountMenu
        ? "galaxy"
        : "";
  if (bg) document.body.dataset.starholdBg = bg;
  else delete document.body.dataset.starholdBg;
}

export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
    emailDraft?: string;
    passwordDraft?: string;
          accountEmail?: string | null;
    claimablePlayerId?: string | null;
    emailReset?: boolean;
    passwordResetToken?: string | null;
    activePage: NavPage;
    onEventsRefresh: () => void;
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    forgetSoundBaseline();
    stopEventsCountdown();
    syncBackdrop(false, state.activePage);
    if (session.accountMenu === "credits") {
      root.innerHTML = `<main class="join-sky" data-testid="credits-standalone">${creditsPageHtml()}</main>`;
      return;
    }
    if (session.holdJoin) {
      root.innerHTML = reconnectScreenHtml(state);
      return;
    }
    renderJoin(root, state);
    return;
  }

  syncBackdrop(true, state.activePage);

  const fleetDraft = fleetDraftForPage(root, state.activePage);
  watchFleetLaunches(state.view, state.onEventsRefresh);
  observeViewSounds(state.view);
  startEventsCountdown(state.view, state.onEventsRefresh);

  if (
    session.accountMenu === "security" &&
    session.account &&
    session.securityFor !== session.account.id
  ) {
    session.securityFor = session.account.id;
    void import("../main-actions-session").then((mod) => mod.loadSecurity());
  }

  const shell = root.querySelector<HTMLElement>('[data-testid="game-shell"]');
  const menu = session.accountMenu ?? "";
  const menuMatches = (shell?.dataset.accountMenu ?? "") === menu;
  const pageColumn = mainColumnHtml(
    state.view,
    state.busy,
    fleetDraft,
    state.activePage,
  );
  const column = session.accountMenu
    ? pageColumn
    : eventsBannerHtml(state.view) + pageColumn;

  if (menuMatches && canPatchShell(root, state.view, state.activePage)) {
    patchLiveChrome(root, state.view, state);
    syncVacationBanner(root, state.view);
    syncWhatsNewPopup(root, state.view, state.busy);
    const main = root.querySelector<HTMLElement>("#page-main");
    if (main) {
      // Galaxy navigation is activated by a focused button. The generic DOM
      // morpher preserves focused stale nodes when the subtree shape changes,
      // which can leave an old galaxy nav beside its newly rendered copy.
      if (state.activePage === "galaxy" || session.accountMenu) {
        main.innerHTML = column;
      } else morphHtml(main, column);
    }
    startCountdownTick();
    return;
  }

  root.innerHTML = dashboardHtml(
    state.view,
    state,
    fleetDraft,
    state.activePage,
  );
  if (!session.accountMenu) {
    root
      .querySelector<HTMLElement>("#page-main")
      ?.insertAdjacentHTML("afterbegin", eventsBannerHtml(state.view));
  }
  startCountdownTick();
}

export function fleetDraftForPage(
  root: HTMLElement,
  activePage: NavPage,
): FleetDraft | null {
  const salvaged = salvageFleetForm(root);
  const prefill = session.pendingAcsPrefill;
  if (activePage !== "fleet") return salvaged;
  const galaxyDraft = session.pendingGalaxyFleetDraft;
  if (galaxyDraft) {
    session.pendingGalaxyFleetDraft = null;
    return galaxyDraft;
  }
  if (!prefill) return salvaged;
  return fleetDraftWithAcsPrefill(salvaged, prefill);
}
