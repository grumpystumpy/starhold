# UI review screenshot baselines

Seeded by the standing UI/UX reviewer (`scripts/ui-layout-check.mjs`).

CI runs bounding-box **overlap / overflow / truncation / forbidden-label / contrast**
checks that fail the job. It also compares masked full-page screenshots (desktop
1280×800, phone 390×844) against these PNGs when present. Volatile session text
(resources, names, flash, XP) is masked before capture so baselines stay stable.

Diff ratio above `UI_REVIEW_MAX_DIFF_RATIO` (default 5%) fails when
`UI_REVIEW_FAIL_ON` includes `screenshot-diff`.

Update intentionally after approved visual changes:
1. Run locally: `UI_REVIEW_OUT=/tmp/ui-out npm run e2e:layout` (server on :3001).
2. Copy `/tmp/ui-out/{desktop,phone}/*.png` over this directory.
3. Commit with the visual PR.
