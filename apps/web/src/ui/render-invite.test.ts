import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";
import { session } from "../session";
import { joinScreenHtml } from "./render-chrome-join";
import { shellHtml } from "./render-shell";

describe("invite link UI", () => {
  it("shows a calm join hint only when an invite code is present", () => {
    const base = {
      error: null,
      notice: null,
      busy: false,
      joinDraft: "",
    };
    const plain = joinScreenHtml(base);
    assert.doesNotMatch(plain, /data-testid="invite-join-hint"/);
    const invited = joinScreenHtml({ ...base, inviteCode: "ABCDEFGH" });
    assert.match(invited, /data-testid="invite-join-hint"/);
    assert.match(invited, /starts near theirs/);
    assert.doesNotMatch(invited, /invalid/i);
    assert.doesNotMatch(invited, /ABCDEFGH/);
  });

  it("gives signed-in players a copy button and a readonly fallback", () => {
    const now = 100_000_000;
    const universe = createUniverse("InviteUI", 1, 1, { lazySeed: true });
    const { player } = joinUniverse(universe, "Host", now);
    const view = playerView(universe, player.id, now);
    const guest = shellHtml(
      view,
      { error: null, notice: null, busy: false },
      "overview",
      "<div>Main</div>",
    );
    assert.doesNotMatch(guest, /data-testid="copy-invite"/);

    session.account = {
      id: "acct_host",
      email: "host@example.com",
      playerId: player.id,
    };
    session.inviteShareUrl = "https://starhold.example/?invite=ABCDEFGH";
    try {
      const signedIn = shellHtml(
        view,
        { error: null, notice: null, busy: false },
        "overview",
        "<div>Main</div>",
      );
      assert.match(signedIn, /data-testid="copy-invite"/);
      assert.match(signedIn, /type="button"/);
      assert.match(signedIn, /Copy invite link/);
      assert.match(signedIn, /data-testid="invite-link-fallback"/);
      assert.match(signedIn, /readonly/);
      assert.match(signedIn, /https:\/\/starhold\.example\/\?invite=ABCDEFGH/);
      assert.doesNotMatch(signedIn, /host@example\.com\?invite/);
      assert.doesNotMatch(
        signedIn,
        /data-testid="invite-link-fallback"[^>]*value="[^"]*plyr_/,
      );
    } finally {
      session.account = null;
      session.inviteShareUrl = null;
    }
  });
});
