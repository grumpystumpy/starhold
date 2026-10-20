import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmt, fmtCompact, fmtLabel } from "./format";

describe("fmt", () => {
  it("uses thousands separators", () => {
    assert.equal(fmt(2000), "2,000");
    assert.equal(fmt(1_500_050), "1,500,050");
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
    assert.equal(fmtCompact(1_250), "1.3K");
    assert.equal(fmtCompact(1_234_567), "1.2M");
    assert.equal(fmtCompact(3_400_000_000), "3.4B");
  });

  it("drops a trailing .0 and promotes rounded values", () => {
    assert.equal(fmtCompact(2_000), "2K");
    assert.equal(fmtCompact(999_999), "1M");
    assert.equal(fmtCompact(1_000_000_000_000), "1T");
  });

  it("keeps the sign for negatives", () => {
    assert.equal(fmtCompact(-999), "-999");
    assert.equal(fmtCompact(-1_250), "-1.3K");
  });

  it("renders non-finite values as a dash", () => {
    assert.equal(fmtCompact(Number.NaN), "—");
    assert.equal(fmtCompact(Number.POSITIVE_INFINITY), "—");
    assert.equal(fmtCompact(Number.NEGATIVE_INFINITY), "—");
  });
});

describe("fmtLabel", () => {
  it("replaces underscores with spaces for skill/id labels", () => {
    assert.equal(fmtLabel("eco_mines_1"), "eco mines 1");
    assert.equal(fmtLabel("Strip Mining I"), "Strip Mining I");
  });
});
