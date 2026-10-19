import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGalaxyCoords } from "./galaxy-coords";

describe("parseGalaxyCoords", () => {
  it("parses with colon separator", () => {
    assert.deepEqual(parseGalaxyCoords("9:143", 1), { galaxy: 9, system: 143 });
  });

  it("parses with space separator", () => {
    assert.deepEqual(parseGalaxyCoords("9 143", 1), { galaxy: 9, system: 143 });
  });

  it("parses with dot separator", () => {
    assert.deepEqual(parseGalaxyCoords("9.143", 1), { galaxy: 9, system: 143 });
  });

  it("parses with comma separator", () => {
    assert.deepEqual(parseGalaxyCoords("9,143", 1), { galaxy: 9, system: 143 });
  });

  it("uses current galaxy when only system is provided", () => {
    assert.deepEqual(parseGalaxyCoords("143", 9), { galaxy: 9, system: 143 });
  });

  it("returns error for 0:5", () => {
    const result = parseGalaxyCoords("0:5", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for 11:1", () => {
    const result = parseGalaxyCoords("11:1", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for 9:0", () => {
    const result = parseGalaxyCoords("9:0", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for 9:400", () => {
    const result = parseGalaxyCoords("9:400", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for abc", () => {
    const result = parseGalaxyCoords("abc", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for 9:", () => {
    const result = parseGalaxyCoords("9:", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });

  it("returns error for empty string", () => {
    const result = parseGalaxyCoords("", 1);
    assert.ok("error" in result);
    assert.equal(result.error, "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)");
  });
});
