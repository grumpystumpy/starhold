#!/usr/bin/env node
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const root = path.resolve(__dirname, "..");
const b64 = fs.readFileSync(path.join(root, ".package-lock.json.b64gz"), "utf8").trim();
const buf = zlib.gunzipSync(Buffer.from(b64, "base64"));
fs.writeFileSync(path.join(root, "package-lock.json"), buf);
console.log("assembled package-lock.json", buf.length, "bytes");
