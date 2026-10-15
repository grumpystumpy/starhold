# Starhold — agent brief

Inspired OGame-like browser game. **Original** names/UI. Live: https://starhold-two.vercel.app (`main` → Vercel Hobby + Upstash `KV_REST_API_*`).

## Read first

| Doc | When |
|-----|------|
| [docs/vision.md](docs/vision.md) | North star / CHANGE queue |
| [docs/process.md](docs/process.md) | Git, deploys, testing |
| [docs/vercel-deploy.md](docs/vercel-deploy.md) | Env + Hobby limits |
| [docs/design/](docs/design/) | **Per-system** contracts only — open the one you touch |

Big addenda (`universe-contract`, `round2-contract`, `round3-contract`) are reference; prefer the matching `docs/design/<system>.md`.

## Quality gate (before merge-ready)

1. Rebase on latest `main` (or approved stack tip).
2. `npm test` · `npm run typecheck` · `npm run build:vercel` green.
3. Playwright vs **local** prod (`build:vercel` + `SESSION_SECRET` + `npm start`) — signup→login→persist + feature e2e. **No Vercel preview.**
4. UI reviewer desktop + phone when UI changes.
5. KV save-format additive (migrate; no wipes). Combines cleanly with other open PRs.
6. **Nothing merges without Micah approval.** No auto-merge. No solo prod deploy.

## Hard rules

- Branch `cursor/<name>-####` off `main`; small PR; never push `cursor/core-loop-prototype-1093`.
- Tuning numbers only in `packages/game/src/data/tuning.ts`.
- Commit the small `api/index.js` stub (do not gitignore it). `build:vercel` overwrites it; do not commit the generated bundle.
- Vercel deploys **`main` only** (`vercel.json` `git.deploymentEnabled` + `ignoreCommand`). Docs/tests/scripts-only commits skip the build. CI must not call Vercel.
- Real `git push` when available; do not invent credentials/accounts.
