#!/usr/bin/env node
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

function padB64(s) {
  const t = s.replace(/\s+/g, "");
  const pad = (4 - (t.length % 4)) % 4;
  return t + "=".repeat(pad);
}

const root = ".cursor-staging/j2";
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, "utf8"));
for (const entry of manifest) {
  const b64 = padB64(entry.parts.map((p) => fs.readFileSync(p, "utf8")).join(""));
  const raw = zlib.gunzipSync(Buffer.from(b64, "base64"));
  const sha = crypto.createHash("sha256").update(raw).digest("hex");
  if (sha !== entry.sha256) {
    throw new Error(`sha256 mismatch for ${entry.path}: got ${sha} want ${entry.sha256}`);
  }
  fs.mkdirSync(path.dirname(entry.path), { recursive: true });
  fs.writeFileSync(entry.path, raw);
  console.log("unpacked", entry.path, raw.length);
}
