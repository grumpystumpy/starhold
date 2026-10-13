/**
 * Vercel Node serverless entry (bundled to api/index.js by scripts/bundle-api.mjs).
 */
import { handle } from "hono/vercel";
import { app } from "./app.js";

export default handle(app);
