/**
 * Placeholder discovered by Vercel; overwritten by `npm run build:vercel` (scripts/bundle-api.mjs).
 */
module.exports = async function starholdApiStub(req, res) {
  res.statusCode = 503;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "API bundle missing — build:vercel did not run" }));
};
