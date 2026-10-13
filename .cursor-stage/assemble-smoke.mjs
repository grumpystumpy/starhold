#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const n = 5;
let b64 = "";
for (let i = 0; i < n; i++) {
  b64 += readFileSync(`.cursor-stage/smoke-ui.part-${i}.b64`, "utf8").trim();
}
const buf = Buffer.from(b64, "base64");
writeFileSync("scripts/smoke-ui.mjs", buf);
rmSync(".cursor-stage", { recursive: true, force: true });
console.log("assembled", buf.length);
