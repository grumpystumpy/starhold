import type { PlayerView } from "@starhold/game";
import { session } from "../session";
import { startCountdownTick } from "./countdown";
import type { NavPage } from "./nav";
import { canPatchShell, patchLiveChrome } from "./patch-chrome";
import { renderJoin } from "./render-chrome";
import {
  fleetDraftWithAcsPrefill,
  salvageFleetForm,
  type FleetDraft,
} from "./render-fleets";
import { dashboardHtml } from "./render-dashboard";
import type { UiHandlers } from "./render-helpers";
import { pageHtml } from "./render-pages";

/**
 * Render UI. Interactive actions are handled by event delegation in main.ts
 * so 1s poll re-renders do not drop click listeners mid-gesture.
 * Poll refreshes patch the top bar / resource bar in place (no remount).
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
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    renderJoin(root, state);
    return;
  }

  const fleetDraft = fleetDraftForPage(root, state.activePage);

  if (canPatchShell(root, state.view, state.activePage)) {
    patchLiveChrome(root, state.view, state);
    const main = root.querySelector<HTMLElement>("#page-main");
    if (main) {
      main.innerHTML = pageHtml(
        state.activePage,
        state.view,
        state.busy,
        fleetDraft,
      );
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
