#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "scripts/.j-staging/manifest.json");
if (!existsSync(manifestPath)) {
  console.log("no staging manifest; skip unpack");
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const entry of manifest) {
  const b64 = readFileSync(join(root, entry.staging), "utf8").trim();
  const buf = gunzipSync(Buffer.from(b64, "base64"));
  const out = join(root, entry.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log("unpacked", entry.path, buf.length);
}
