import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmt, fmtLabel } from "./format";

describe("fmt", () => {
  it("uses thousands separators", () => {
    assert.equal(fmt(2000), "2,000");
    assert.equal(fmt(1_500_050), "1,500,050");
  });

  it("floors fractional display values", () => {
    assert.equal(fmt(12.9), "12");
  });
});

describe("fmtLabel", () => {
  it("replaces underscores with spaces for skill/id labels", () => {
    assert.equal(fmtLabel("eco_mines_1"), "eco mines 1");
    assert.equal(fmtLabel("Strip Mining I"), "Strip Mining I");
  });
});
