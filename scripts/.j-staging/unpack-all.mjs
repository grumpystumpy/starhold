#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const staging = join(root, "scripts/.j-staging");
if (!existsSync(staging)) { console.log("no staging"); process.exit(0); }
const parts = readdirSync(staging).filter((n) => n.startsWith("contract.hex.")).sort();
if (!parts.length) { console.log("no contract hex"); process.exit(0); }
const hex = parts.map((n) => readFileSync(join(staging, n), "utf8").trim()).join("");
const buf = gunzipSync(Buffer.from(hex, "hex"));
const out = join(root, "docs/design/round2-contract.md");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log("unpacked docs/design/round2-contract.md", buf.length);
