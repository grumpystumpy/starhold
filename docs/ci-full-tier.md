# Full tier CI

The `Full tier` workflow is a broader GitHub Actions check for PRs, manual runs, and `batch/**` branch pushes. It is separate from the normal unit CI and is intended to exercise the browser-heavy production path without touching deployment or Cloudflare credentials.

What it does:

- installs Node 22 and dependencies
- verifies the web test script still includes `apps/web/src/save-fixture.test.ts`
- runs the unit suite, typecheck, and production build
- installs Playwright Chromium
- starts the server on a fresh universe (unique `STARHOLD_UNIVERSE_KEY` per run, on a fresh runner)
- runs the full browser and quality-gate matrix:
  - `npm run e2e`
  - `npm run e2e:layout`
  - `npm run e2e:gate`
  - `npm run e2e:gate:pirates`
  - `npm run e2e:gate:alliances`
  - `node scripts/workers-e2e.mjs`
  - `node scripts/playtest-bugfix-e2e.mjs`
  - `node scripts/quality-gate-alliance-intel.mjs`
- uploads the server log and any UI review output directories as artifacts

Manual trigger:

- open the GitHub Actions tab for the repo
- select the `Full tier` workflow
- choose `Run workflow` and pick the branch or a PR ref

The server start step sets a unique `STARHOLD_UNIVERSE_KEY` per run and attempt, so state never carries over between runs. Server output goes to `$RUNNER_TEMP/starhold-full-tier-server.log`, uploaded with the artifacts.
