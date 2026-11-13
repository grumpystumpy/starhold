import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { alliancesPageHtml } from "./render-alliances";
import { pageHtml } from "./render-pages";
import { setHighscoreTab } from "./render-pages";

function baseView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", name: "Alpha" } as PlayerView["player"],
    planet: { id: "pl1" } as PlayerView["planet"],
    alliance: null,
    allianceDirectory: [],
    ...overrides,
  } as PlayerView;
}

describe("alliances panel", () => {
  it("renders create form when unaffiliated", () => {
    const html = alliancesPageHtml(baseView(), false);
    assert.match(html, /data-testid="alliances-panel"/);
    assert.match(html, /data-testid="alliance-create-form"/);
    assert.match(html, /data-testid="alliance-directory-empty"/);
  });

  it("renders roster when in alliance", () => {
    const html = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_1",
          name: "Solar Guard",
          tag: "SOL",
          joinMode: "open",
          createdAt: 1,
          founderPlayerId: "p1",
          myRole: "founder",
          members: [
            {
              playerId: "p1",
              name: "Alpha",
              role: "founder",
              joinedAt: 1,
              pointsHint: 100,
            },
          ],
          pendingInvites: [],
          memberCount: 1,
          maxMembers: 16,
          chat: [
            {
              id: "chat_1",
              playerId: "p1",
              displayName: "Alpha",
              body: "Hold the lane",
              createdAt: 1,
            },
          ],
          intel: [],
          markers: [],
        },
        allianceDirectory: [
          {
            id: "ally_1",
            name: "Solar Guard",
            tag: "SOL",
            joinMode: "open",
            memberCount: 1,
            maxMembers: 16,
          },
        ],
      }),
      false,
    );
    assert.match(html, /data-testid="alliance-tag-badge"/);
    assert.match(html, /\[SOL\]/);
    assert.match(html, /data-testid="alliance-roster"/);
    assert.match(html, /data-testid="alliance-leave-btn"/);
    assert.match(html, /data-testid="alliance-disband-btn"/);
    assert.match(html, /data-testid="alliance-relations-empty"/);
    assert.match(html, /data-testid="alliance-diplomacy-none"/);
    assert.match(html, /data-testid="alliance-chat-form"/);
    assert.match(html, /Hold the lane/);
    assert.match(html, /data-testid="alliance-intel-empty"/);
    assert.match(html, /data-testid="alliance-markers-empty"/);
    assert.match(html, /data-testid="alliance-class-select"/);
    assert.match(html, /data-testid="alliance-class-label"/);
    assert.match(html, /No alliance class/);
  });

  it("shows NAP and war rows, and leader controls to offer, accept, or cancel", () => {
    const relation = {
      allianceId: "ally_foe",
      name: "Foes",
      tag: "FOE",
      kind: "nap" as const,
      status: "pending" as const,
      initiatedBy: "ally_foe",
      since: 1,
      canAccept: true,
      canCancel: true,
    };
    const directory = [
      {
        id: "ally_1",
        name: "Solar Guard",
        tag: "SOL",
        joinMode: "open" as const,
        memberCount: 1,
        maxMembers: 16,
      },
      {
        id: "ally_foe",
        name: "Foes",
        tag: "FOE",
        joinMode: "open" as const,
        memberCount: 2,
        maxMembers: 16,
      },
    ];
    const founder = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_1",
          name: "Solar Guard",
          tag: "SOL",
          joinMode: "open",
          createdAt: 1,
          founderPlayerId: "p1",
          myRole: "founder",
          members: [],
          pendingInvites: [],
          memberCount: 1,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
          relations: [relation],
        },
        allianceDirectory: directory,
      }),
      false,
    );
    assert.match(founder, /data-testid="alliance-relations"/);
    assert.match(founder, /\[FOE\] Foes · NAP · pending/);
    assert.match(founder, /data-testid="alliance-diplomacy-accept-ally_foe"/);
    assert.match(founder, /data-testid="alliance-diplomacy-cancel-ally_foe"/);
    assert.match(founder, /data-testid="alliance-diplomacy-form"/);
    assert.match(founder, /data-testid="alliance-diplomacy-nap"/);
    assert.match(founder, /data-testid="alliance-diplomacy-war"/);
    assert.doesNotMatch(founder, /value="ally_1"/);

    const member = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_1",
          name: "Solar Guard",
          tag: "SOL",
          joinMode: "open",
          createdAt: 1,
          founderPlayerId: "p9",
          myRole: "member",
          members: [],
          pendingInvites: [],
          memberCount: 1,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
          relations: [{ ...relation, canAccept: false, canCancel: false, kind: "war", status: "active" }],
        },
        allianceDirectory: directory,
      }),
      false,
    );
    assert.match(member, /\[FOE\] Foes · War/);
    assert.doesNotMatch(member, /data-testid="alliance-diplomacy-form"/);
    assert.doesNotMatch(member, /alliance-diplomacy-accept/);
    assert.doesNotMatch(member, /alliance-diplomacy-cancel/);
  });

  it("shows alliance class bonuses and hides the selector from members", () => {
    const alliance = {
      id: "ally_1",
      name: "Solar Guard",
      tag: "SOL",
      joinMode: "open" as const,
      createdAt: 1,
      founderPlayerId: "p9",
      myRole: "member" as const,
      members: [],
      pendingInvites: [],
      memberCount: 2,
      maxMembers: 16,
      chat: [],
      intel: [],
      markers: [],
      allianceClass: "destroyer" as const,
    };
    const html = alliancesPageHtml(baseView({ alliance }), false);
    assert.match(html, /Class: Destroyer's/);
    assert.match(html, /fleet speed ×1\.05/);
    assert.match(html, /loot ×1\.10/);
    assert.doesNotMatch(html, /data-testid="alliance-class-select"/);
  });

  it("shows Request, Leader, and approve controls", () => {
    const open = alliancesPageHtml(
      baseView({
        allianceDirectory: [
          {
            id: "ally_r",
            name: "Request Gate",
            tag: "REQ",
            joinMode: "request",
            memberCount: 1,
            maxMembers: 16,
          },
        ],
      }),
      false,
    );
    assert.match(open, /data-testid="alliance-request-ally_r"/);
    assert.match(open, /value="request"/);

    const leader = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_r",
          name: "Request Gate",
          tag: "REQ",
          joinMode: "request",
          createdAt: 1,
          founderPlayerId: "p1",
          myRole: "founder",
          members: [
            {
              playerId: "p1",
              name: "Alpha",
              role: "founder",
              joinedAt: 1,
              pointsHint: 10,
            },
            {
              playerId: "p2",
              name: "Bravo",
              role: "officer",
              joinedAt: 2,
              pointsHint: 5,
            },
          ],
          pendingInvites: [],
          pendingRequests: [
            { playerId: "p3", name: "Cara", requestedAt: 3 },
          ],
          memberCount: 2,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
        },
      }),
      false,
    );
    assert.match(leader, /you are Leader/);
    assert.match(leader, /data-testid="alliance-approve-p3"/);
    assert.match(leader, /data-testid="alliance-reject-p3"/);
    assert.match(leader, /data-testid="alliance-demote-p2"/);
    assert.match(leader, /Transfer Leader/);
    assert.doesNotMatch(leader, /Transfer Founder/);
  });

  it("renders the alliance highscore tab", () => {
    const view = baseView({
      highscores: [],
      allianceHighscores: [
        {
          rank: 1,
          allianceId: "ally_r",
          name: "Request Gate",
          tag: "REQ",
          memberCount: 2,
          points: 400,
          averagePoints: 200,
        },
      ],
      roster: [],
    });
    setHighscoreTab("alliances");
    try {
      const html = pageHtml("highscore", view, false, null);
      assert.match(html, /data-testid="highscore-tab-alliances"/);
      assert.match(html, /data-testid="alliance-highscores"/);
      assert.match(html, /\[REQ\] Request Gate/);
      assert.match(html, /2 members/);
    } finally {
      setHighscoreTab("players");
    }
    const players = pageHtml("highscore", view, false, null);
    assert.match(players, /data-testid="highscores-list"/);
    assert.doesNotMatch(players, /data-testid="alliance-highscore-1"/);
  });

  it("renders escaped recruiting text and hides edit controls from other roles", () => {
    const blurb = `<img src=x onerror=alert(1)>`;
    const note = `<script>alert("x")</script>`;
    const directory = [
      {
        id: "ally_r",
        name: `Request <Gate>`,
        tag: "REQ",
        joinMode: "request" as const,
        memberCount: 2,
        maxMembers: 16,
        recruitmentBlurb: blurb,
        recruiting: true,
        applicationNote: note,
      },
    ];
    const open = alliancesPageHtml(
      baseView({
        allianceDirectory: [
          {
            id: "ally_r",
            name: "Request Gate",
            tag: "REQ",
            joinMode: "request",
            memberCount: 2,
            maxMembers: 16,
          },
        ],
      }),
      false,
      { directory, requestAllianceId: "ally_r" },
    );
    assert.match(open, /data-testid="alliance-recruiting-ally_r"/);
    assert.match(open, /data-recruiting="1"/);
    assert.match(open, /Recruiting/);
    assert.match(open, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(open, /data-testid="alliance-request-confirm-ally_r"/);
    assert.match(open, /data-testid="alliance-application-note"/);
    assert.match(open, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.match(open, /Request &lt;Gate&gt;/);
    assert.doesNotMatch(open, /<img/);
    assert.doesNotMatch(open, /<script/);
    assert.doesNotMatch(open, /data-testid="alliance-recruiting-form"/);

    const leader = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_r",
          name: "Request Gate",
          tag: "REQ",
          joinMode: "request",
          createdAt: 1,
          founderPlayerId: "p1",
          myRole: "founder",
          members: [],
          pendingInvites: [],
          memberCount: 2,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
        },
      }),
      false,
      { directory },
    );
    assert.match(leader, /data-testid="alliance-recruiting-form"/);
    assert.match(leader, /data-testid="alliance-recruiting-save"/);
    assert.match(leader, /data-testid="alliance-recruitment-summary"/);
    assert.match(leader, /data-testid="alliance-recruiting-flag"/);
    assert.match(leader, /value="&lt;img src=x onerror=alert\(1\)&gt;"/);
    assert.doesNotMatch(leader, /<img/);
    assert.doesNotMatch(leader, /<script/);

    const officer = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_r",
          name: "Request Gate",
          tag: "REQ",
          joinMode: "request",
          createdAt: 1,
          founderPlayerId: "p9",
          myRole: "officer",
          members: [],
          pendingInvites: [],
          memberCount: 2,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
        },
      }),
      false,
      { directory },
    );
    assert.match(officer, /data-testid="alliance-recruitment-summary"/);
    assert.doesNotMatch(officer, /data-testid="alliance-recruiting-form"/);
    assert.doesNotMatch(officer, /data-testid="alliance-recruiting-save"/);
    assert.doesNotMatch(officer, /data-testid="alliance-recruitment-blurb-input"/);

    const member = alliancesPageHtml(
      baseView({
        alliance: {
          id: "ally_r",
          name: "Request Gate",
          tag: "REQ",
          joinMode: "request",
          createdAt: 1,
          founderPlayerId: "p9",
          myRole: "member",
          members: [],
          pendingInvites: [],
          memberCount: 2,
          maxMembers: 16,
          chat: [],
          intel: [],
          markers: [],
          allianceClass: null,
        },
      }),
      false,
      { directory },
    );
    assert.doesNotMatch(member, /data-testid="alliance-recruiting-form"/);
    assert.doesNotMatch(member, /alliance-recruiting-save/);
  });
});
