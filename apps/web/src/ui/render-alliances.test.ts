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
  });
});
