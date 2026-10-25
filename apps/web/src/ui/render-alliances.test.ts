import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { alliancesPageHtml } from "./render-alliances";

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
    assert.match(html, /data-testid="alliance-chat-form"/);
    assert.match(html, /Hold the lane/);
    assert.match(html, /data-testid="alliance-intel-empty"/);
    assert.match(html, /data-testid="alliance-markers-empty"/);
    assert.match(html, /data-testid="alliance-class-select"/);
    assert.match(html, /data-testid="alliance-class-label"/);
    assert.match(html, /No alliance class/);
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
});
