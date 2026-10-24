# Full tier CI

The `Full tier` workflow is a broader GitHub Actions check for PRs, manual runs, and `batch/**` branch pushes. It is separate from the normal unit CI and is intended to exercise the browser-heavy production path without touching deployment or Cloudflare credentials.

What it does:

- installs Node 22 and dependencies
- verifies the web test script still includes `apps/web/src/save-fixture.test.ts`
- runs the unit suite, typecheck, and production build
- installs Playwright Chromium
- generates and masks a throwaway `SESSION_SECRET` for the run; it does not use repository secrets
- starts the server in its own process group on a fresh universe (unique `STARHOLD_UNIVERSE_KEY` per run, on a fresh runner)
- runs the full browser and quality-gate matrix:
  - `npm run e2e`
  - `npm run e2e:layout`
  - `npm run e2e:gate`
  - `npm run e2e:gate:pirates`
  - `npm run e2e:gate:alliances`
  - `node scripts/workers-e2e.mjs`
  - `node scripts/playtest-bugfix-e2e.mjs`
  - `node scripts/quality-gate-alliance-intel.mjs`
- restarts the server on a new, unique universe before the pirates, alliances, worker smoke, playtest bugfix, and alliance intel scripts so their state is isolated
- uploads each server log and any UI review output directories as artifacts

Manual trigger:

- open the GitHub Actions tab for the repo
- select the `Full tier` workflow
- choose `Run workflow` and pick the branch or a PR ref

The initial server and each isolated run use a unique `STARHOLD_UNIVERSE_KEY` derived from the run ID, attempt, and script. `.github/scripts/full-tier-server.sh` starts and stops the server process group, falls back to stopping a listener on port 3001 if needed, and waits for the port to be free before starting a new server. Each server's output is written to its own `$RUNNER_TEMP/starhold-full-tier-*.log` file and uploaded with the artifacts.
