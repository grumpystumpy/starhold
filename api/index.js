/**
 * Placeholder so Vercel discovers `/api`.
 * Overwritten by `npm run build:vercel` → `node scripts/bundle-api.mjs`.
 */
module.exports = async function starholdApiMissingBundle(req, res) {
  res.statusCode = 503;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: false,
      error: "API bundle missing — build:vercel did not run scripts/bundle-api.mjs",
    }),
  );
};
