import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HallOfFameEntry, HighscoreEntry, PlayerView } from "@starhold/game";
import { pageHtml } from "./render-pages";
import {
  closeCommanderDossier,
  commanderDossierHtml,
  commanderDossierOpenId,
  openCommanderDossier,
  publicFightsForCommander,
} from "./commander-dossier";

function row(partial: Partial<HighscoreEntry> & Pick<HighscoreEntry, "playerId" | "name">): HighscoreEntry {
  return {
    rank: 1,
    points: 1200,
    coords: { galaxy: 2, system: 4, slot: 8 },
    planetCount: 3,
    planetName: "Homeworld",
    homePlanetId: "pl-home",
    level: 4,
    xpTotal: 50,
    allianceTag: "ACE",
    artId: "normal-1",
    artUrl: "/art.webp",
    artThumbUrl: "/thumb.webp",
    ...partial,
  };
}

function fight(partial: Partial<HallOfFameEntry> & Pick<HallOfFameEntry, "attackerName" | "defenderName">): HallOfFameEntry {
  return {
    at: 1_700_000_000_000,
    targetCoords: { galaxy: 2, system: 4, slot: 8 },
    outcome: "attacker_win",
    destroyedValue: 12_345,
    shareCode: "sh_public",
    ...partial,
  };
}

describe("commander dossier", () => {
  it("matches Hall of Fame fights only when the highscore name uniquely identifies the player id", () => {
    const solo = row({ playerId: "p-solo", name: "Solo", rank: 2 });
    const twinA = row({ playerId: "p-a", name: "Twin", rank: 3 });
    const twinB = row({ playerId: "p-b", name: "Twin", rank: 4 });
    const rows = [solo, twinA, twinB];
    const hall = [
      fight({ attackerName: "Solo", defenderName: "Other", shareCode: "sh_solo" }),
      fight({ attackerName: "Twin", defenderName: "Other", shareCode: "sh_twin" }),
      fight({ attackerName: "Stranger", defenderName: "Nobody", shareCode: "sh_nope" }),
    ];

    assert.deepEqual(
      publicFightsForCommander(solo, rows, hall).map((entry) => entry.shareCode),
      ["sh_solo"],
    );
    assert.deepEqual(publicFightsForCommander(twinA, rows, hall), []);
    assert.deepEqual(publicFightsForCommander(twinB, rows, hall), []);
  });

  it("renders public stats and an escaped share link, and drops private view fields", () => {
    const nasty = row({
      playerId: "p-nasty",
      name: `<img src=x onerror=alert(1)>`,
      allianceTag: `<TAG>`,
      planetName: `World "One"`,
      rank: 7,
      points: 2500,
      level: 6,
      planetCount: 2,
    });
    const view = {
      player: { id: "p-viewer" },
      highscores: [nasty],
      hallOfFame: [
        fight({
          attackerName: nasty.name,
          defenderName: "Defender & Co",
          shareCode: "sh_a b",
        }),
      ],
      secretFleet: "SECRET-FLEET-TOKEN",
      resources: { metal: 777777 },
    } as unknown as PlayerView;

    const html = commanderDossierHtml(view, "p-nasty");
    assert.match(html, /data-testid="commander-dossier"/);
    assert.match(html, /data-commander-dossier-backdrop/);
    assert.match(html, /data-testid="commander-dossier-close"/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /data-testid="commander-dossier-rank">#7/);
    assert.match(html, /data-testid="commander-dossier-points">2\.5K/);
    assert.match(html, /data-testid="commander-dossier-level">6/);
    assert.match(html, /data-testid="commander-dossier-alliance">\[&lt;TAG&gt;\]/);
    assert.match(html, /data-testid="commander-dossier-planets">2/);
    assert.match(html, /World &quot;One&quot;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /Attack · &lt;img src=x onerror=alert\(1\)&gt; vs Defender &amp; Co/);
    assert.match(html, /href="\/\?report=sh_a%20b"/);
    assert.match(html, /data-testid="commander-dossier-fight-1"/);
    assert.doesNotMatch(html, /SECRET-FLEET-TOKEN/);
    assert.doesNotMatch(html, /777777/);
    assert.equal(commanderDossierHtml(view, null), "");
    assert.match(
      commanderDossierHtml(view, "missing"),
      /data-testid="commander-dossier-missing"/,
    );
  });

  it("hides fights when two commanders share a name", () => {
    const view = {
      player: { id: "p1" },
      highscores: [
        row({ playerId: "p1", name: "Twin" }),
        row({ playerId: "p2", name: "Twin", rank: 2 }),
      ],
      hallOfFame: [fight({ attackerName: "Twin", defenderName: "Other" })],
    } as unknown as PlayerView;
    const html = commanderDossierHtml(view, "p1");
    assert.match(html, /data-testid="commander-dossier-fights-hidden"/);
    assert.doesNotMatch(html, /sh_public/);
    assert.match(html, / \(you\)/);
  });

  it("opens and closes by player id without keeping a blank id", () => {
    closeCommanderDossier();
    openCommanderDossier("  ");
    assert.equal(commanderDossierOpenId(), null);
    openCommanderDossier("p9");
    assert.equal(commanderDossierOpenId(), "p9");
    closeCommanderDossier();
    assert.equal(commanderDossierOpenId(), null);
  });

  it("puts a dossier button on highscore names and keeps alliance tags escaped", () => {
    const view = {
      player: { id: "p1" },
      highscores: [
        row({
          playerId: "p1",
          name: "Alpha <script>",
          allianceTag: "A&B",
        }),
      ],
      roster: [],
      hallOfFame: [],
      hallOfShame: [],
    } as unknown as PlayerView;
    const html = pageHtml("highscore", view, false, null);
    assert.match(html, /data-open-commander="p1"/);
    assert.match(html, /data-testid="open-commander-p1"/);
    assert.match(html, />Alpha &lt;script&gt;</);
    assert.match(html, /\[A&amp;B\]/);
    assert.doesNotMatch(html, /<script>/);
  });

  it("opens a mini-planet commander only when the public name is unique", () => {
    const mini = {
      planetId: "mini-1",
      name: "Outpost",
      coords: { galaxy: 1, system: 5, slot: 17 },
      artId: "mini-art",
      artThumbUrl: "/mini.webp",
      playerName: "Scout",
      isOwn: false,
      debris: null,
    };
    const galaxy = {
      galaxy: 1,
      system: 5,
      slots: [],
      minis: [mini],
      asteroids: [],
    };
    const unique = pageHtml(
      "galaxy",
      {
        galaxy,
        highscores: [row({ playerId: "p-scout", name: "Scout" })],
      } as unknown as PlayerView,
      false,
      null,
    );
    assert.match(unique, /data-open-commander="p-scout"/);
    assert.match(unique, /data-testid="galaxy-mini-commander-mini-1"/);
    const shared = pageHtml(
      "galaxy",
      {
        galaxy,
        highscores: [
          row({ playerId: "p-scout", name: "Scout" }),
          row({ playerId: "p-other", name: "Scout", rank: 2 }),
        ],
      } as unknown as PlayerView,
      false,
      null,
    );
    assert.doesNotMatch(shared, /data-open-commander=/);
    assert.match(shared, /galaxy-slot-label">Mini Scout</);
  });
});
