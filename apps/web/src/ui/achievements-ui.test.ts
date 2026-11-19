import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AchievementView, PlayerView } from "@starhold/game";
import { goalsPageHtml } from "./render-goals";
import { pageHtml } from "./render-pages";

function row(partial: Partial<AchievementView> & Pick<AchievementView, "id">): AchievementView {
  return {
    title: partial.id,
    detail: "Detail",
    progress: 0,
    target: 1,
    unlocked: false,
    starshards: 15,
    showProgress: true,
    ...partial,
  };
}

function view(achievements?: AchievementView[]): PlayerView {
  return {
    player: { id: "p1", name: "Commander" },
    goals: [],
    achievements,
  } as unknown as PlayerView;
}

describe("achievements board", () => {
  it("links from goals and greys locked rows that have progress", () => {
    const achievements = [
      row({
        id: "shipsDestroyed1000",
        title: "Thousand hulls",
        progress: 400,
        target: 1000,
        unlocked: false,
        starshards: 25,
      }),
      row({
        id: "firstMoon",
        title: "First moon",
        progress: 1,
        target: 1,
        unlocked: true,
        unlockedAt: 10,
        starshards: 15,
      }),
      row({
        id: "highscoreTop10",
        title: "Top 10",
        progress: 0,
        target: 1,
        unlocked: false,
        showProgress: false,
        note: "Current rank: 14",
        starshards: 20,
      }),
    ];
    const html = pageHtml("goals", view(achievements), false, null);
    assert.match(html, /data-testid="goals-achievements-link"/);
    assert.match(html, /href="#achievements"/);
    assert.match(html, /data-testid="achievements-board"/);
    assert.match(
      html,
      /class="goal-row achievement-locked" data-testid="achievement-shipsDestroyed1000"/,
    );
    assert.match(html, /data-testid="achievement-progress-shipsDestroyed1000"/);
    assert.match(html, /400 \/ 1k/);
    assert.match(
      html,
      /class="goal-row achievement-unlocked" data-testid="achievement-firstMoon"/,
    );
    assert.match(html, /data-testid="achievement-status-firstMoon">Unlocked/);
    assert.match(html, /data-testid="achievement-status-shipsDestroyed1000">Locked/);
    assert.doesNotMatch(html, /data-testid="achievement-progress-highscoreTop10"/);
    assert.match(html, /data-testid="achievement-note-highscoreTop10">Current rank: 14/);
  });

  it("still renders the goals link when the view has no board", () => {
    const html = goalsPageHtml(view(undefined), false);
    assert.match(html, /data-testid="goals-achievements-link"/);
    assert.match(html, /No achievements on this view/);
  });
});
