# Vercel API entry

`index.js` in git is a small **stub**. Vercel matches `vercel.json` `functions` keys against files in the git tree before the build. If `api/index.js` is missing, production fails immediately with an unmatched function pattern.

`npm run build:vercel` (`scripts/bundle-api.mjs`, from `apps/server/src/vercel-entry.ts`) **overwrites** that stub with the real bundle. On Vercel, `@vercel/node` does not run `buildCommand` for files under `api/`. It runs the root `vercel-build` script (`node scripts/bundle-api.mjs`) after downloading the stub and before tracing the function. That generated file is what gets served.

Do not gitignore `api/index.js`. Commit the stub only — not the generated bundle.
