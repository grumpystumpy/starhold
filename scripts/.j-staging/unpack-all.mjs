#!/usr/bin/env node
import fs from "fs";
import zlib from "zlib";
import path from "path";

const manifest = JSON.parse(fs.readFileSync("scripts/.j-staging/manifest.json", "utf8"));
for (const { path: dest, staging } of manifest) {
  const b64 = fs.readFileSync(staging, "utf8").trim();
  const raw = zlib.gunzipSync(Buffer.from(b64, "base64"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, raw);
  console.log("unpacked", dest, raw.length);
}
