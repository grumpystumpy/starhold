/**
 * Vercel Node serverless entry — bundled to api/[[...route]].js.
 */
import { handle } from "hono/vercel";
import { app } from "./app.js";

export default handle(app);
