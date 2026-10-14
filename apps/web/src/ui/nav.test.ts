import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAV_PAGES,
  pageFromPath,
  pathForPage,
  resolveNavPage,
} from "./nav";

describe("nav routes", () => {
  it("maps contract paths to pages", () => {
    assert.equal(pageFromPath("/"), "overview");
    assert.equal(pageFromPath("/overview"), "overview");
    assert.equal(pageFromPath("/buildings"), "buildings");
    assert.equal(pageFromPath("/defenses"), "defenses");
    assert.equal(pageFromPath("/shipyard"), "shipyard");
    assert.equal(pageFromPath("/research"), "research");
    assert.equal(pageFromPath("/fleet"), "fleet");
    assert.equal(pageFromPath("/galaxy"), "galaxy");
    assert.equal(pageFromPath("/officers"), "officers");
    assert.equal(pageFromPath("/skills"), "skills");
    assert.equal(pageFromPath("/highscore"), "highscore");
    assert.equal(pageFromPath("/seasons"), "seasons");
    assert.equal(pageFromPath("/messages"), "messages");
  });

  it("aliases Round 1 panel paths", () => {
    assert.equal(pageFromPath("/resources"), "buildings");
    assert.equal(pageFromPath("/facilities"), "buildings");
    assert.equal(pageFromPath("/defense"), "defenses");
    assert.equal(resolveNavPage("resources"), "buildings");
    assert.equal(resolveNavPage("defense"), "defenses");
  });

  it("emits canonical paths for every nav page", () => {
    for (const page of NAV_PAGES) {
      assert.equal(pageFromPath(pathForPage(page)), page);
    }
  });
});
