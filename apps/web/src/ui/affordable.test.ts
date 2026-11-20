import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAffordability, fmtAffordableDuration } from "./affordable";
import { startCountdownTick } from "./countdown";

const zero = { metal: 0, crystal: 0, deuterium: 0 };
const storage = { metal: 100_000, crystal: 100_000, deuterium: 100_000 };

describe("fmtAffordableDuration", () => {
  it("formats seconds, minutes, hours, and days", () => {
    assert.equal(fmtAffordableDuration(12), "12s");
    assert.equal(fmtAffordableDuration(45 * 60), "45m");
    assert.equal(fmtAffordableDuration(2 * 3600 + 14 * 60), "2h 14m");
    assert.equal(fmtAffordableDuration(86400 + 2 * 3600), "1d 2h");
  });
});

describe("computeAffordability", () => {
  it("returns affordable when nothing is missing", () => {
    const result = computeAffordability(
      { metal: 10, crystal: 10, deuterium: 0 },
      { metal: 500, crystal: 500, deuterium: 500 },
      { metal: 100, crystal: 50, deuterium: 10 },
      storage,
    );
    assert.deepEqual(result, { affordable: true });
  });

  it("lets the slowest missing resource set the countdown", () => {
    const result = computeAffordability(
      { metal: 200, crystal: 150, deuterium: 0 },
      { metal: 100, crystal: 50, deuterium: 0 },
      { metal: 100, crystal: 1000, deuterium: 1 },
      storage,
    );
    assert.equal(result.affordable, false);
    if (result.affordable) return;
    assert.equal(result.label, "Affordable in 1h 0m");
    assert.equal(result.reason, "Affordable in 1h 0m");
    assert.equal(result.secondsRemaining, 3600);
  });

  it("keeps Can't afford when a missing resource has zero production", () => {
    const result = computeAffordability(
      { metal: 10, crystal: 0, deuterium: 0 },
      zero,
      { metal: 0, crystal: 5, deuterium: 5 },
      storage,
    );
    assert.deepEqual(result, {
      affordable: false,
      label: "Can't afford",
      reason: "no production",
      secondsRemaining: null,
    });
  });

  it("keeps Can't afford when a missing resource has negative production", () => {
    const result = computeAffordability(
      { metal: 10, crystal: 0, deuterium: 0 },
      zero,
      { metal: -3, crystal: 5, deuterium: 5 },
      storage,
    );
    assert.deepEqual(result, {
      affordable: false,
      label: "Can't afford",
      reason: "no production",
      secondsRemaining: null,
    });
  });

  it("keeps Can't afford when the cost is larger than storage", () => {
    const result = computeAffordability(
      { metal: 500, crystal: 0, deuterium: 0 },
      zero,
      { metal: 100, crystal: 100, deuterium: 100 },
      { metal: 100, crystal: 100, deuterium: 100 },
    );
    assert.deepEqual(result, {
      affordable: false,
      label: "Can't afford",
      reason: "needs more storage",
      secondsRemaining: null,
    });
  });
});

describe("affordable countdown tick", () => {
  it("repaints data-afford-until and shows Affordable soon after the time passes", () => {
    const afford = {
      dataset: { affordUntil: "1700008040000" },
      textContent: "stale",
    };
    let tick: (() => void) | undefined;
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNow = Date.now;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setInterval: (callback: () => void) => {
          tick = callback;
          return 7;
        },
        clearInterval: () => {},
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: () => null,
        querySelectorAll: (sel: string) =>
          sel === "[data-afford-until]" ? [afford] : [],
      },
    });
    Date.now = () => 1_700_000_000_000;

    try {
      startCountdownTick();
      assert.ok(tick);
      tick();
      assert.equal(afford.textContent, "Affordable in 2h 14m");
      Date.now = () => 1_700_008_040_000;
      tick();
      assert.equal(afford.textContent, "Affordable soon");
      Date.now = () => 1_700_009_000_000;
      tick();
      assert.equal(afford.textContent, "Affordable soon");
    } finally {
      Date.now = originalNow;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
