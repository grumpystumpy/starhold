import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView, type PlayerView } from "@starhold/game";

const { root, session } = await import("../session.js");
const { patchMessagesBadge, syncPhoneMore } = await import("./patch-chrome.js");
const { dismissPhoneMore, onShellKeydown, togglePhoneMore } = await import(
  "../main-handlers-click.js"
);

function unreadView(extra = false, read = false): PlayerView {
  const now = 100_000_000;
  const universe = createUniverse("BadgePatch", 1);
  const { player, planet } = joinUniverse(universe, "Defender", now);
  player.eventLog = [
    {
      id: "evt_keep",
      kind: "fleetReturn",
      createdAt: now + 1,
      readAt: read ? now + 2 : null,
      title: "Fleet returned",
      body: "home",
    },
  ];
  if (extra) {
    player.eventLog.push({
      id: "evt_two",
      kind: "fleetReturn",
      createdAt: now + 2,
      readAt: null,
      title: "Second",
      body: "home",
    });
  }
  return playerView(universe, player.id, now + 3);
}

type BadgeNode = {
  className: string;
  textContent: string;
  dataset: { testid?: string };
  remove: () => void;
};

function badgeHost(testid: string) {
  const badges: BadgeNode[] = [];
  return {
    dataset: { testid },
    badges,
    querySelector(sel: string) {
      const id = /data-testid="([^"]+)"/.exec(sel)?.[1];
      return badges.find((badge) => badge.dataset.testid === id) ?? null;
    },
    append(node: { className: string; textContent: string; dataset: { testid?: string } }) {
      const badge: BadgeNode = {
        className: node.className,
        textContent: node.textContent,
        dataset: node.dataset,
        remove() {
          const index = badges.indexOf(badge);
          if (index >= 0) badges.splice(index, 1);
        },
      };
      badges.push(badge);
    },
  };
}

describe("phone More sheet state", () => {
  it("closes on navigate, backdrop, and Escape, and toggles open", () => {
    const sheetAttrs = new Map<string, string>([["hidden", ""]]);
    const buttonAttrs = new Map<string, string>([["aria-expanded", "false"]]);
    const sheet = {
      toggleAttribute(name: string, force?: boolean) {
        const on = force ?? !sheetAttrs.has(name);
        if (on) sheetAttrs.set(name, "");
        else sheetAttrs.delete(name);
        return on;
      },
      hasAttribute(name: string) {
        return sheetAttrs.has(name);
      },
    };
    const button = {
      setAttribute(name: string, value: string) {
        buttonAttrs.set(name, value);
      },
      getAttribute(name: string) {
        return buttonAttrs.get(name) ?? null;
      },
    };
    const previous = root.querySelector;
    root.querySelector = ((sel: string) => {
      if (sel === '[data-testid="phone-more"]') return sheet;
      if (sel === '[data-testid="phone-bottom-more"]') return button;
      return null;
    }) as typeof root.querySelector;

    try {
      session.phoneMoreOpen = false;
      togglePhoneMore();
      assert.equal(session.phoneMoreOpen, true);
      assert.equal(sheet.hasAttribute("hidden"), false);
      assert.equal(button.getAttribute("aria-expanded"), "true");
      assert.equal(dismissPhoneMore(), true);
      assert.equal(session.phoneMoreOpen, false);
      assert.equal(sheet.hasAttribute("hidden"), true);
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.equal(dismissPhoneMore(), false);

      session.phoneMoreOpen = true;
      sheet.toggleAttribute("hidden", true);
      button.setAttribute("aria-expanded", "false");
      syncPhoneMore(root);
      assert.equal(sheet.hasAttribute("hidden"), false);
      assert.equal(button.getAttribute("aria-expanded"), "true");

      let prevented = false;
      onShellKeydown({
        key: "Enter",
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(session.phoneMoreOpen, true);
      assert.equal(prevented, false);
      onShellKeydown({
        key: "Escape",
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(session.phoneMoreOpen, false);
      assert.equal(sheet.hasAttribute("hidden"), true);
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.equal(prevented, true);
    } finally {
      root.querySelector = previous;
      session.phoneMoreOpen = false;
    }
  });
});

describe("patchMessagesBadge", () => {
  it("adds, updates, and removes the bottom-bar unread badge", () => {
    const side = badgeHost("nav-messages");
    const phone = badgeHost("phone-nav-messages");
    const option = { textContent: "Messages" };
    const root = {
      querySelector(sel: string) {
        if (sel === '[data-testid="nav-messages"]') return side;
        if (sel === '[data-testid="phone-nav-messages"]') return phone;
        if (sel === '[data-testid="nav-dropdown"] option[value="messages"]') return option;
        return null;
      },
    };
    const previous = document.createElement;
    document.createElement = ((tag: string) => {
      assert.equal(tag, "span");
      return { className: "", textContent: "", dataset: {} };
    }) as typeof document.createElement;

    try {
      patchMessagesBadge(root as unknown as HTMLElement, unreadView(false, false));
      assert.equal(side.badges.length, 1);
      assert.equal(phone.badges.length, 1);
      assert.equal(side.badges[0]?.dataset.testid, "nav-messages-badge");
      assert.equal(phone.badges[0]?.dataset.testid, "phone-nav-messages-badge");
      assert.equal(side.badges[0]?.className, "nav-badge");
      assert.equal(side.badges[0]?.textContent, "1");
      assert.equal(phone.badges[0]?.textContent, "1");
      assert.equal(option.textContent, "Messages (1)");

      patchMessagesBadge(root as unknown as HTMLElement, unreadView(true, false));
      assert.equal(side.badges.length, 1);
      assert.equal(phone.badges.length, 1);
      assert.equal(side.badges[0]?.textContent, "2");
      assert.equal(phone.badges[0]?.textContent, "2");
      assert.equal(option.textContent, "Messages (2)");

      patchMessagesBadge(root as unknown as HTMLElement, unreadView(false, true));
      assert.equal(side.badges.length, 0);
      assert.equal(phone.badges.length, 0);
      assert.equal(option.textContent, "Messages");
    } finally {
      document.createElement = previous;
      session.phoneMoreOpen = false;
    }
  });
});
