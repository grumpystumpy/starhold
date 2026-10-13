#!/usr/bin/env node
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const b64 = fs.readFileSync(path.join(root, ".package-lock.json.b64gz"), "utf8").trim();
const buf = zlib.gunzipSync(Buffer.from(b64, "base64"));
fs.writeFileSync(path.join(root, "package-lock.json"), buf);
console.log("assembled package-lock.json", buf.length, "bytes");
