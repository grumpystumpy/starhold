#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const staging = join(root, "scripts/.j-staging");

// Assemble hex-split contract if present
{
  const parts = existsSync(staging)
    ? readdirSync(staging).filter((n) => n.startsWith("contract.hex.")).sort()
    : [];
  if (parts.length) {
    const hex = parts.map((n) => readFileSync(join(staging, n), "utf8").trim()).join("");
    const buf = gunzipSync(Buffer.from(hex, "hex"));
    const out = join(root, "docs/design/round2-contract.md");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log("unpacked docs/design/round2-contract.md", buf.length);
  }
}

const manifestPath = join(staging, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("no staging manifest; skip gzip unpack");
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
