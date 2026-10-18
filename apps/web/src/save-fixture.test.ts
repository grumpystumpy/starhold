import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("save fixture", () => {
  it("loads the commander snapshot and does not rewrite it", async () => {
    const path = fileURLToPath(new URL("./fixtures/commander-save.json", import.meta.url));
    const before = readFileSync(path, "utf8");
    await import("./api");
    const loaded = JSON.parse(before) as { id: string; buildings: { metalMine: number } };
    assert.equal(loaded.id, "fixture-commander");
    assert.equal(loaded.buildings.metalMine, 4);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), loaded);
  });
});
