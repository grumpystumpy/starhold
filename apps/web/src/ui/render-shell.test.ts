import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, levelBonuses, playerView } from "@starhold/game";
import type { CombatReport } from "@starhold/game";

const { shellHtml, levelBonusLines, syncWhatsNewPopup, vacationBannerHtml } = await import("./render-shell.js");

describe("newbie bonus header badge", () => {
  it("shows remaining time while active and omits the badge when forfeited or expired", () => {
    const now = 100_000_000;
    const universe = createUniverse("Header", 1);
    const { player } = joinUniverse(universe, "Fresh", now);
    const html = (at: number) => shellHtml(playerView(universe, player.id, at), { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.equal(playerView(universe, player.id, now).newbieBonusEndsAt, now + 96 * 60 * 60 * 1000);
    assert.match(html(now), /data-testid="newbie-bonus-badge"/);
    assert.match(html(now), /96h left/);
    assert.doesNotMatch(html(now + 96 * 60 * 60 * 1000), /data-testid="newbie-bonus-badge"/);
    universe.players[player.id]!.newbieForfeitedAt = now + 1;
    assert.doesNotMatch(html(now + 2), /data-testid="newbie-bonus-badge"/);
  });
});

describe("vacation banner", () => {
  it("shows the banner only while vacation mode is on", () => {
    const now = 100_000_000;
    const universe = createUniverse("Vacation header", 1);
    const { player } = joinUniverse(universe, "Away", now);
    const html = () =>
      shellHtml(
        playerView(universe, player.id, now),
        { error: null, notice: null, busy: false },
        "overview",
        "<div>Main</div>",
      );
    assert.equal(player.vacationMode, undefined);
    assert.equal(vacationBannerHtml(playerView(universe, player.id, now)), "");
    assert.doesNotMatch(html(), /data-testid="vacation-banner"/);
    player.vacationMode = true;
    assert.match(html(), /data-testid="vacation-banner"/);
    assert.match(html(), /cannot send new fleets/);
    player.vacationMode = undefined;
    assert.doesNotMatch(html(), /data-testid="vacation-banner"/);
  });
});

describe("planet dropdown and coords link", () => {
  it("renders top-left colony dropdown and clickable coordinate link", () => {
    const now = 100_000_000;
    const universe = createUniverse("Header", 1);
    const { player } = joinUniverse(universe, "Commander", now);
    const view = playerView(universe, player.id, now);
    const html = shellHtml(view, { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.match(html, /data-testid="planet-dropdown-wrap"/);
    assert.match(html, /data-testid="planet-dropdown"/);
    assert.match(html, /class="coord-link"/);
    assert.match(html, /Claim daily \+15 \+res/);
    assert.match(html, /Daily login reward: \+15 Starshards, \+2k metal, \+1k crystal, \+500 deut/);
  });
});

describe("commander level help icon and bonuses", () => {
  it("renders help icon with data-testid='level-bonus-help' preserving level-tip and xp-bar", () => {
    const now = 100_000_000;
    const universe = createUniverse("LevelTest", 1);
    const { player } = joinUniverse(universe, "Cmdr1", now);
    const view = playerView(universe, player.id, now);
    const html = shellHtml(view, { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.match(html, /data-testid="level-bonus-help"/);
    assert.match(html, /data-testid="level-tip"/);
    assert.match(html, /data-testid="xp-bar"/);
  });

  it("formats level 1 bonuses as zero / none", () => {
    const l1Lines = levelBonusLines(1);
    assert.deepEqual(l1Lines, [
      "Production +0.0% (none)",
      "Building time -0.0% (none)",
      "Research time -0.0% (none)",
      "Fleet flight time -0.0% (none)",
      "Ship build time -0.0% (none)",
      "Weapons +0 levels (none)",
      "Shielding +0 levels (none)",
    ]);
  });

  it("formats level 26 bonuses matching levelBonuses", () => {
    const lb26 = levelBonuses(26);
    const l26Lines = levelBonusLines(26);
    assert.equal(lb26.production, 1.125);
    assert.equal(lb26.buildTime, 0.9);
    assert.equal(lb26.researchTime, 0.9);
    assert.equal(lb26.fleetTime, 0.925);
    assert.equal(lb26.shipBuild, 0.875);
    assert.equal(lb26.weaponsBonus, 5);
    assert.equal(lb26.shieldingBonus, 5);

    assert.deepEqual(l26Lines, [
      "Production +12.5%",
      "Building time -10.0%",
      "Research time -10.0%",
      "Fleet flight time -7.5%",
      "Ship build time -12.5%",
      "Weapons +5 levels",
      "Shielding +5 levels",
    ]);
  });

  it("shows caps/floors when reached at high levels", () => {
    const l100Lines = levelBonusLines(100);
    assert.deepEqual(l100Lines, [
      "Production +49.5%",
      "Building time -30.0% (cap 30%)",
      "Research time -30.0% (cap 30%)",
      "Fleet flight time -25.0% (cap 25%)",
      "Ship build time -35.0% (cap 35%)",
      "Weapons +19 levels",
      "Shielding +19 levels",
    ]);
  });
});

describe("messages badge", () => {
  it("counts an unrelated alert and skips a raid alert covered by the combat report", () => {
    const now = 100_000_000;
    const universe = createUniverse("Badge", 1);
    const { player, planet } = joinUniverse(universe, "Defender", now);
    const foe = joinUniverse(universe, "Raider", now + 1);
    const report = {
      id: "rpt_badge",
      at: now,
      missionId: "flt_badge",
      attackerPlayerId: foe.player.id,
      defenderPlayerId: player.id,
      attackerName: "Raider",
      defenderName: "Defender",
      targetCoords: { ...planet.coords },
      attackerBefore: {},
      attackerAfter: {},
      defenderBefore: {},
      defenderAfter: {},
      defensesBefore: {},
      defensesAfter: {},
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "draw",
      rounds: 1,
      summary: "Draw",
    } as CombatReport;
    universe.reports[report.id] = report;
    player.eventLog = [
      {
        id: "evt_dup",
        kind: "raidAlert",
        createdAt: now,
        readAt: null,
        title: "Hostile raid resolved",
        body: "Draw",
        meta: { reportId: report.id },
      },
      {
        id: "evt_keep",
        kind: "fleetReturn",
        createdAt: now + 1,
        readAt: null,
        title: "Fleet returned",
        body: "home",
      },
    ];
    const view = playerView(universe, player.id, now + 2);
    const html = shellHtml(view, { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.match(html, /data-testid="nav-messages-badge">1</);
    assert.doesNotMatch(html, /data-testid="nav-messages-badge">2</);
  });
});

describe("what's new popup", () => {
  function shellFor(dismissed: boolean) {
    const now = 100_000_000;
    const universe = createUniverse("Notes", 1, 1, { lazySeed: true });
    const { player } = joinUniverse(universe, "Hold", now);
    if (dismissed) {
      universe.players[player.id]!.whatsNewDismissedReleaseId = "271";
    }
    const view = playerView(universe, player.id, now);
    const html = shellHtml(
      view,
      { error: null, notice: null, busy: false },
      "overview",
      "<div>Main</div>",
    );
    return { view, html };
  }

  it("shows release 271 once and omits the popup after that key is dismissed", () => {
    const shown = shellFor(false);
    assert.equal(shown.view.whatsNew?.releaseId, "271");
    assert.match(shown.html, /data-testid="whats-new"/);
    assert.match(shown.html, /data-release-id="271"/);
    assert.match(shown.html, /data-testid="whats-new-dismiss"/);
    assert.match(shown.html, /home screen/);
    assert.match(shown.html, /review of the mission/);
    assert.match(shown.html, /loot and debris/);
    assert.match(shown.html, /still locked/);
    assert.match(shown.html, /shows the reason/);
    assert.match(shown.html, /role="dialog"/);

    const hidden = shellFor(true);
    assert.equal(hidden.view.whatsNew, null);
    assert.doesNotMatch(hidden.html, /data-testid="whats-new"/);
    assert.match(hidden.html, /data-testid="game-shell"/);
  });

  it("removes the popup from a patched shell and inserts it when notes are still unseen", () => {
    const shown = shellFor(false);
    const hidden = shellFor(true);
    const popup = fakeEl("whats-new");
    popup.attrs["data-release-id"] = "271";
    const shell = fakeEl("game-shell");
    shell.children.push(popup);
    popup.parent = shell;
    const root = fakeEl(null);
    root.children.push(shell);
    shell.parent = root;

    syncWhatsNewPopup(root as unknown as ParentNode, hidden.view, false);
    assert.equal(shell.querySelector('[data-testid="whats-new"]'), null);

    syncWhatsNewPopup(root as unknown as ParentNode, shown.view, false);
    const again = shell.querySelector('[data-testid="whats-new"]');
    assert.ok(again);
    assert.equal(again?.getAttribute("data-release-id"), "271");
  });
});

function fakeEl(testid: string | null) {
  const node: {
    testid: string | null;
    attrs: Record<string, string>;
    children: ReturnType<typeof fakeEl>[];
    parent: ReturnType<typeof fakeEl> | null;
    getAttribute: (name: string) => string | null;
    querySelector: (sel: string) => ReturnType<typeof fakeEl> | null;
    remove: () => void;
    insertAdjacentHTML: (where: string, html: string) => void;
  } = {
    testid,
    attrs: {},
    children: [],
    parent: null,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    querySelector(sel: string) {
      const id = /data-testid="([^"]+)"/.exec(sel)?.[1];
      if (!id) return null;
      if (this.testid === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(sel);
        if (found) return found;
      }
      return null;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
    },
    insertAdjacentHTML(_where: string, html: string) {
      const child = fakeEl("whats-new");
      const release = /data-release-id="([^"]+)"/.exec(html)?.[1];
      if (release) child.attrs["data-release-id"] = release;
      child.parent = this;
      this.children.push(child);
    },
  };
  return node;
}
