#!/usr/bin/env node
const fs = require("fs");
const zlib = require("zlib");
const a = fs.readFileSync("scripts/.j-staging/part-a.b64", "utf8").trim();
const b = fs.readFileSync("scripts/.j-staging/part-b.b64", "utf8").trim();
const raw = zlib.gunzipSync(Buffer.from(a + b, "base64"));
fs.mkdirSync("docs/design", { recursive: true });
fs.writeFileSync("docs/design/round2-contract.md", raw);
console.log("unpacked contract", raw.length, "bytes");
