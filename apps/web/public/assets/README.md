# Starhold UI assets

Original vector plates plus a CC0 / CC BY art pass. **Not** scraped or copied from OGame, Gameforge, or other proprietary games. Full source URLs, authors, and licenses are in `docs/ART_CREDITS.md` and the in-game Credits page.

## License / source

| Field | Value |
|-------|--------|
| Original plates | Starhold prototype (this repository). Same license as the repo. |
| Ships, planets, galaxy sky | Kenney, CC0. Recolored and cropped. |
| Buildings and turret defenses | Wenrexa, CC0 (OpenGameArt page). Recolored and cropped. |
| Research icons | game-icons.net authors, CC BY 3.0. Recolored. Credit required. |
| Join backdrop | NASA Apollo 11 photograph AS11-44-6552. Acknowledge NASA. No NASA logo. |
| Style | Flat plates on the dark UI palette |
| Formats | SVG, WebP |

## Layout

| Folder | Contents |
|--------|----------|
| `buildings/` | Mines, stores, yard, lab, and lunar/sensor plates. Jump Gate, Chrono Lathe, Mantle Loom, and Rig Foundry stay original SVG. |
| `ships/` | Kenney hulls for the early and mid ladder. Capital, World Eater, and mothership plates stay original SVG. |
| `planets/` | Kenney discs for the join screen and `PLANET_ART`. Galaxy slots still use `/planet-art/`. |
| `defenses/` | Wenrexa turrets where the pack has a gun. Shield and dome plates stay original SVG. |
| `research/` | game-icons.net glyphs for every research row. |
| `backgrounds/` | Kenney sky band and the NASA join backdrop. Full-bleed only. |
| `resources/` | Metal, crystal, deuterium, and energy chips. Deuterium stays the original glyph. |
| `ui/` | Empty hangar placeholder |

Filenames are kebab-case and mapped in `apps/web/src/ui/assets.ts`.
