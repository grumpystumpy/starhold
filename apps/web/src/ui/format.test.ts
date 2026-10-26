import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmt, fmtCompact, fmtCoordsLink, fmtLabel } from "./format";

describe("fmt", () => {
  it("uses compact notation for numbers >= 1000 with floored rounding", () => {
    assert.equal(fmt(2000), "2k");
    assert.equal(fmt(1_500_050), "1.5M");
    assert.equal(fmt(1000), "1k");
    assert.equal(fmt(1234), "1.2k");
    assert.equal(fmt(1299), "1.2k");
    assert.equal(fmt(1_000_000), "1M");
    assert.equal(fmt(1_234_567), "1.2M");
  });

  it("floors fractional display values", () => {
    assert.equal(fmt(12.9), "12");
  });
});

describe("fmtCompact", () => {
  it("leaves small values plain", () => {
    assert.equal(fmtCompact(0), "0");
    assert.equal(fmtCompact(999), "999");
    assert.equal(fmtCompact(999.9), "999");
  });

  it("abbreviates thousands, millions and billions", () => {
    assert.equal(fmtCompact(1_250), "1.2k");
    assert.equal(fmtCompact(1_234_567), "1.2M");
    assert.equal(fmtCompact(3_400_000_000), "3.4B");
  });

  it("drops a trailing .0 and promotes rounded values", () => {
    assert.equal(fmtCompact(2_000), "2k");
    assert.equal(fmtCompact(999_999), "999.9k");
    assert.equal(fmtCompact(1_000_000_000_000), "1T");
  });

  it("keeps the sign for negatives", () => {
    assert.equal(fmtCompact(-999), "-999");
    assert.equal(fmtCompact(-1_250), "-1.2k");
  });

  it("renders non-finite values as a dash", () => {
    assert.equal(fmtCompact(Number.NaN), "—");
    assert.equal(fmtCompact(Number.POSITIVE_INFINITY), "—");
    assert.equal(fmtCompact(Number.NEGATIVE_INFINITY), "—");
  });
});

describe("fmtCoordsLink", () => {
  it("formats coordinate link HTML string", () => {
    const coords = { galaxy: 1, system: 2, slot: 3 };
    assert.equal(
      fmtCoordsLink(coords),
      '<a href="/galaxy?galaxy=1&amp;system=2" class="coord-link" data-galaxy-coords="1:2:3" data-testid="coord-link-1-2-3">1:2:3</a>',
    );
  });
});

describe("fmtLabel", () => {
  it("replaces underscores with spaces for skill/id labels", () => {
    assert.equal(fmtLabel("eco_mines_1"), "eco mines 1");
    assert.equal(fmtLabel("Strip Mining I"), "Strip Mining I");
  });
});
