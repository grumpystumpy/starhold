import {
  midgameBriefingCards,
  midgameFactsFromView,
  type MidgameBriefingCard,
  type OnboardingNavPage,
  type PlayerView,
} from "@starhold/game";
import type { NavPage } from "./nav";
import { escapeAttr, escapeHtml } from "./render-escape";
import { hrefForPage } from "./router";

function navPageFor(target: OnboardingNavPage): NavPage {
  switch (target) {
    case "fleets":
      return "fleet";
    case "buildings":
    case "research":
    case "shipyard":
    case "galaxy":
      return target;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function cardHtml(view: PlayerView, card: MidgameBriefingCard): string {
  const page = navPageFor(card.targetNavPage);
  const href = hrefForPage(page, {
    playerId: view.player.id,
    planetId: view.planet.id,
  });
  const completion = card.completed === null
    ? ""
    : ` data-completed="${card.completed ? "true" : "false"}"`;
  const status = card.completed === null
    ? ""
    : `<span class="hint">${card.completed ? "Done" : "Not yet"}</span>`;
  return `<li class="onboarding-step" data-testid="midgame-card-${escapeAttr(card.id)}"${completion}>
      <div class="onboarding-step-copy">
        <strong>${escapeHtml(card.title)}</strong>
        <span class="hint">${escapeHtml(card.unlocks)}</span>
      </div>
      <div class="onboarding-step-actions">
        <a href="${escapeAttr(href)}" data-nav="${escapeAttr(page)}" data-testid="midgame-open-${escapeAttr(card.id)}">Open</a>
        ${status}
      </div>
    </li>`;
}

/** Overview milestone guide. Hidden while the commander briefing is still open. */
export function midgameBriefingHtml(view: PlayerView, busy: boolean): string {
  const cards = midgameBriefingCards(midgameFactsFromView(view));
  if (!cards) return "";
  return `<section class="panel onboarding-panel midgame-briefing" data-testid="midgame-briefing">
    <h2>Next milestones</h2>
    <p class="hint">No rewards. Hide this when you no longer need it.</p>
    <ul class="onboarding-steps">${cards.map((card) => cardHtml(view, card)).join("")}</ul>
    <button type="button" data-midgame-dismiss="true" data-testid="midgame-dismiss" ${busy ? "disabled" : ""}>Hide milestones</button>
  </section>`;
}
