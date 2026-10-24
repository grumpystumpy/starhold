import type { PlayerView } from "@starhold/game";
import { session } from "../session";
import { startCountdownTick } from "./countdown";
import type { NavPage } from "./nav";
import { morphHtml } from "./morph-dom";
import { canPatchShell, patchLiveChrome } from "./patch-chrome";
import { renderJoin, reconnectScreenHtml } from "./render-chrome";
import {
  fleetDraftWithAcsPrefill,
  salvageFleetForm,
  type FleetDraft,
} from "./render-fleets";
import { dashboardHtml } from "./render-dashboard";
import type { UiHandlers } from "./render-helpers";
import { pageHtml } from "./render-pages";
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
    activePage: NavPage;
    onEventsRefresh: () => void;
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    stopEventsCountdown();
    if (session.holdJoin) {
      root.innerHTML = reconnectScreenHtml(state);
      return;
    }
    renderJoin(root, state);
    return;
  }

  const fleetDraft = fleetDraftForPage(root, state.activePage);
  watchFleetLaunches(state.view, state.onEventsRefresh);
  startEventsCountdown(state.view, state.onEventsRefresh);

  if (canPatchShell(root, state.view, state.activePage)) {
    patchLiveChrome(root, state.view, state);
    const main = root.querySelector<HTMLElement>("#page-main");
    if (main) {
      const page =
        eventsBannerHtml(state.view) +
        pageHtml(state.activePage, state.view, state.busy, fleetDraft);
      // Galaxy navigation is activated by a focused button. The generic DOM
      // morpher preserves focused stale nodes when the subtree shape changes,
      // which can leave an old galaxy nav beside its newly rendered copy.
      if (state.activePage === "galaxy") main.innerHTML = page;
      else morphHtml(main, page);
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
  root
    .querySelector<HTMLElement>("#page-main")
    ?.insertAdjacentHTML("afterbegin", eventsBannerHtml(state.view));
  startCountdownTick();
}

function fleetDraftForPage(
  root: HTMLElement,
  activePage: NavPage,
): FleetDraft | null {
  const salvaged = salvageFleetForm(root);
  const prefill = session.pendingAcsPrefill;
  if (!prefill || activePage !== "fleet") return salvaged;
  return fleetDraftWithAcsPrefill(salvaged, prefill);
}
