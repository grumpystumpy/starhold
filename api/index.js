/**
 * Committed stub so Vercel can match `functions["api/index.js"]` in the git
 * tree before the build. An unmatched pattern fails the deployment instantly.
 *
 * @vercel/node downloads this file, runs the root `vercel-build` script
 * (`node scripts/bundle-api.mjs`), then traces whatever is on disk. That
 * script overwrites this stub with the real bundle. `buildCommand` builds
 * the static app; it is not what packages the serverless function.
 *
 * Marker: STARHOLD_API_STUB
 */
module.exports = function handler(_req, res) {
  res.statusCode = 500;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      error:
        "STARHOLD_API_STUB: api/index.js was deployed without the build:vercel bundle",
    }),
  );
};
