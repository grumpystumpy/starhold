import "./catalog-tip-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindPointerHandlers } from "../main-handlers-pointer";
import { root, session } from "../session";
import { toggleTip } from "./render-tooltips";
import { TipElement } from "./catalog-tip-dom";

function tipTree(): { button: TipElement; tip: TipElement } {
  const button = new TipElement("button");
  button.setAttribute("data-upgrade", "metalMine");
  const tip = new TipElement("span");
  tip.setAttribute("data-tip", "");
  tip.setAttribute("aria-expanded", "false");
  tip.setAttribute("role", "button");
  const bubble = new TipElement("span");
  bubble.classNames.add("tip-bubble");
  tip.append(bubble);
  button.append(tip);
  (root as unknown as TipElement).append(button);
  return { button, tip };
}

function firePointerDown(target: TipElement): { prevented: boolean; stopped: boolean } {
  const record = { prevented: false, stopped: false };
  const event = {
    target,
    preventDefault() {
      record.prevented = true;
    },
    stopPropagation() {
      record.stopped = true;
    },
  };
  const host = root as unknown as TipElement;
  for (const listener of host.listeners) {
    if (listener.type === "pointerdown") listener.fn(event as unknown as Event);
  }
  return record;
}

describe("catalog tooltip tap", () => {
  it("opens and closes aria-expanded without arming the row action", () => {
    bindPointerHandlers();
    const { button, tip } = tipTree();
    session.armedUpgrade = null;

    const opened = firePointerDown(tip);
    assert.equal(opened.prevented, true);
    assert.equal(opened.stopped, true);
    assert.equal(tip.getAttribute("aria-expanded"), "true");
    assert.equal(session.armedUpgrade, null);
    assert.equal(button.getAttribute("data-upgrade"), "metalMine");

    const closed = firePointerDown(tip);
    assert.equal(closed.prevented, true);
    assert.equal(tip.getAttribute("aria-expanded"), "false");
    assert.equal(session.armedUpgrade, null);
  });

  it("closes a sibling tip when another opens", () => {
    const first = new TipElement("span");
    first.setAttribute("data-tip", "");
    first.setAttribute("aria-expanded", "false");
    const firstBubble = new TipElement("span");
    firstBubble.classNames.add("tip-bubble");
    first.append(firstBubble);

    const second = new TipElement("span");
    second.setAttribute("data-tip", "");
    second.setAttribute("aria-expanded", "false");
    const secondBubble = new TipElement("span");
    secondBubble.classNames.add("tip-bubble");
    second.append(secondBubble);

    const host = root as unknown as TipElement;
    host.append(first);
    host.append(second);

    assert.equal(toggleTip(host as unknown as ParentNode, first as unknown as Element), true);
    assert.equal(first.getAttribute("aria-expanded"), "true");
    assert.equal(
      toggleTip(host as unknown as ParentNode, second as unknown as Element),
      true,
    );
    assert.equal(first.getAttribute("aria-expanded"), "false");
    assert.equal(second.getAttribute("aria-expanded"), "true");
    assert.equal(
      toggleTip(host as unknown as ParentNode, second as unknown as Element),
      true,
    );
    assert.equal(second.getAttribute("aria-expanded"), "false");
  });
});
