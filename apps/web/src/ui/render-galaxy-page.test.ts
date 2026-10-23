import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { pageHtml } from "./render-pages";

describe("galaxy page rendering", () => {
  it("keeps one next-system button on initial render and re-render", () => {
    const view = {
      galaxy: {
        galaxy: 2,
        system: 10,
        slots: [],
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const initial = pageHtml("galaxy", view, false, null);
    assert.equal((initial.match(/data-testid="galaxy-next"/g) ?? []).length, 1);

    // Galaxy navigation updates coordinates and paints the page again while
    // the clicked control is focused. Each render must still produce one.
    view.galaxy.system = 11;
    const rerendered = pageHtml("galaxy", view, true, null);
    assert.equal((rerendered.match(/data-testid="galaxy-next"/g) ?? []).length, 1);
  });
});
