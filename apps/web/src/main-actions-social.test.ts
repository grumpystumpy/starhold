import "./test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";

const { doPostAllianceChat } = await import("./main-actions-alliances");
const { doSetSeasonTitle } = await import("./main-actions-seasons");
const { doMarkEventsRead } = await import("./main-actions-events");
const { session, setPaintImpl } = await import("./session");

function baseView(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      research: {},
      researchQueue: [],
      cosmetics: {
        titles: ["Novice"],
        activeTitle: null,
        planetSkinIds: [],
        activePlanetSkinId: null,
      },
      eventLog: [
        {
          id: "e1",
          kind: "buildComplete",
          createdAt: 1_700_000_000_000,
          readAt: null,
          title: "Build done",
          body: "Mine upgraded",
        },
      ],
    },
    planet: {
      id: "pl1",
      buildings: {},
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    galaxy: { galaxy: 1, system: 4 },
    fleets: [],
    reports: [],
    spyReports: [],
    expeditionReports: [],
    openAcsGroups: [],
    alliance: {
      id: "a1",
      name: "Alpha",
      tag: "ALP",
      joinMode: "open",
      createdAt: 1_700_000_000_000,
      founderPlayerId: "p1",
      myRole: "founder",
      members: [],
      pendingInvites: [],
      memberCount: 1,
      maxMembers: 10,
      chat: [],
      intel: [],
      markers: [],
    },
    seasonLeaderboard: {
      seasonId: "2025-01",
      scores: { combat: 0, economy: 0, pirateKills: 0 },
      economyRemainder: 0,
      ranks: { combat: null, economy: null, pirateKills: null },
      boards: { combat: [], economy: [], pirateKills: [] },
      claims: [],
    },
  } as unknown as PlayerView;
}

describe("social and season actions settleMutation recovery", () => {
  it("alliance action: 503 + applied → success with 1 POST", async () => {
    setPaintImpl(() => {});
    session.view = baseView();
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/alliance/chat")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        const view = baseView();
        view.alliance!.chat = [
          {
            id: "msg1",
            playerId: "p1",
            displayName: "Player 1",
            body: "Hello alliance!",
            createdAt: 1_700_000_000_000,
          },
        ];
        return new Response(JSON.stringify(view), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };

    try {
      await doPostAllianceChat("Hello alliance!");
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Message posted.");
  });

  it("season action: 503 + applied → success with 1 POST", async () => {
    setPaintImpl(() => {});
    session.view = baseView();
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/cosmetics/title")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        const view = baseView();
        view.player.cosmetics!.activeTitle = "Novice";
        return new Response(JSON.stringify(view), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };

    try {
      await doSetSeasonTitle("Novice");
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Title equipped.");
  });

  it("event action: 503 + applied → success with 1 POST", async () => {
    setPaintImpl(() => {});
    session.view = baseView();
    session.busy = false;
    session.error = null;
    session.notice = null;

    let posts = 0;
    let states = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/events/read")) {
        posts += 1;
        return new Response("<html>Error 503</html>", { status: 503 });
      }
      if (url.includes("/api/state")) {
        states += 1;
        const view = baseView();
        view.player.eventLog![0]!.readAt = 1_700_000_000_100;
        return new Response(JSON.stringify(view), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };

    try {
      await doMarkEventsRead(["e1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(posts, 1);
    assert.equal(states, 1);
    assert.equal(session.error, null);
    assert.equal(session.notice, "Alert marked read.");
  });
});
