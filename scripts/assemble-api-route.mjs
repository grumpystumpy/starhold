#!/usr/bin/env node
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = path.join(root, ".api-route-stage");
const parts = fs
  .readdirSync(stageDir)
  .filter((n) => n.startsWith("part") && n.endsWith(".b64"))
  .sort();
if (parts.length === 0) {
  throw new Error(`no parts in ${stageDir}`);
}
const b64 = parts.map((n) => fs.readFileSync(path.join(stageDir, n), "utf8").trim()).join("");
const buf = zlib.gunzipSync(Buffer.from(b64, "base64"));
const out = path.join(root, "api", "[[...route]].js");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log("assembled", path.relative(root, out), buf.length, "bytes");
