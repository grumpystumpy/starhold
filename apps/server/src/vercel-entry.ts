/**
 * Vercel Node serverless entry — bundled to api/[[...route]].js.
 * Explicit Node (req,res) bridge — avoids hono/vercel edge assumptions.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./app.js";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const host = req.headers.host ?? "localhost";
    const proto =
      (typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"]
        : null) ?? "https";
    const url = new URL(req.url ?? "/", `${proto}://${host}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    const method = req.method ?? "GET";
    const rawBody =
      method === "GET" || method === "HEAD" ? undefined : await readBody(req);
    const body =
      rawBody && rawBody.length > 0
        ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
        : undefined;

    const requestInit: RequestInit & { duplex?: "half" } = {
      method,
      headers,
      body: body as BodyInit | undefined,
    };
    if (body) requestInit.duplex = "half";
    const request = new Request(url, requestInit);

    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[starhold-api]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Server error",
        }),
      );
    }
  }
}
