import type { PlayerView } from "@starhold/game";
import { startCountdownTick } from "./countdown";
import type { NavPage } from "./nav";
import { renderJoin } from "./render-chrome";
import { salvageFleetForm } from "./render-fleets";
import { dashboardHtml } from "./render-dashboard";
import type { UiHandlers } from "./render-helpers";

/**
 * Render UI. Interactive actions are handled by event delegation in main.ts
 * so 1s poll re-renders do not drop click listeners mid-gesture.
 */
export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
    activePage: NavPage;
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    renderJoin(root, state);
    return;
  }

  const fleetDraft = salvageFleetForm(root);
  root.innerHTML = dashboardHtml(
    state.view,
    state,
    fleetDraft,
    state.activePage,
  );
  startCountdownTick();
}
