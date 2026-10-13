/**
 * Vercel serverless entry — all `/api/*` routes (see vercel.json rewrites).
 * Imports the compiled Hono app from apps/server/dist (built by `npm run build:vercel`).
 */
import { handle } from "hono/vercel";
import { app } from "../apps/server/dist/app.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

export default handle(app);
