#!/usr/bin/env python3
"""Import Thread I large sources from xp branch and patch smoke for G nav."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def main() -> None:
    subprocess.check_call(
        ["git", "fetch", "origin", "cursor/player-levels-xp-8713"]
    )
    subprocess.check_call(
        [
            "git",
            "checkout",
            "origin/cursor/player-levels-xp-8713",
            "--",
            "packages/game/src/world-pirates.ts",
            "packages/game/src/player-levels.test.ts",
            "scripts/smoke-ui.mjs",
        ]
    )
    p = Path("scripts/smoke-ui.mjs")
    t = p.read_text()
    t = t.replace(
        'await goNav(page, "facilities");',
        'await goNav(page, "buildings");',
    )
    old = (
        '  logs.push("ui-upgrade-shipyard-level-under-poll-hammer");\n'
        "\n"
        '  await goNav(page, "resources");\n'
        "  await page.click('[data-testid=\"upgrade-solarPlant\"]');\n"
    )
    new = (
        '  logs.push("ui-upgrade-shipyard-level-under-poll-hammer");\n'
        "\n"
        '  await goNav(page, "buildings");\n'
        "  // Deep-link URL should reflect the routed page.\n"
        '  if (!page.url().includes("/buildings")) {\n'
        "    throw new Error("
        "`expected /buildings in URL after nav, got: ${page.url()}`"
        ");\n"
        "  }\n"
        "  await page.click('[data-testid=\"upgrade-solarPlant\"]');\n"
    )
    if old not in t:
        raise SystemExit("smoke patch anchor1 missing")
    t = t.replace(old, new, 1)
    old2 = (
        '  if (rec < 1) throw new Error("recommended-next hint missing");\n'
        '  await goNav(page, "resources");\n'
        "  const thumb = await page.locator("
        "'[data-testid=\"building-metalMine\"] img.thumb'"
        ").count();\n"
        '  if (thumb < 1) throw new Error("building thumbnail missing");\n'
        '  await goNav(page, "fleet");\n'
    )
    new2 = (
        '  if (rec < 1) throw new Error("recommended-next hint missing");\n'
        '  await goNav(page, "buildings");\n'
        "  const thumb = await page.locator("
        "'[data-testid=\"building-metalMine\"] img.thumb'"
        ").count();\n"
        '  if (thumb < 1) throw new Error("building thumbnail missing");\n'
        "  // Dropdown mirrors side-nav and updates the URL.\n"
        "  await page.selectOption("
        "'[data-testid=\"nav-dropdown\"]', \"defenses\");\n"
        "  await page.waitForSelector("
        "'[data-testid=\"page-defenses\"]', { timeout: 10_000 });\n"
        '  if (!page.url().includes("/defenses")) {\n'
        "    throw new Error("
        "`dropdown nav missing /defenses URL: ${page.url()}`"
        ");\n"
        "  }\n"
        '  logs.push("ui-nav-dropdown-routes");\n'
        '  await goNav(page, "fleet");\n'
    )
    if old2 not in t:
        raise SystemExit("smoke patch anchor2 missing")
    t = t.replace(old2, new2, 1)
    p.write_text(t)
    print("smoke patched for G nav")

    shutil.rmtree(".cursor-staging", ignore_errors=True)
    Path("scripts/unpack-i-staging.py").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
