#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findPublicSourcemapIssues(files) {
  const issues = [];
  for (const file of files) {
    if (file.path.endsWith(".map")) {
      issues.push(`${file.path} is a public source map`);
    }
    if (/\.(?:js|mjs|cjs)$/i.test(file.path) && /sourceMappingURL\s*=/.test(file.content)) {
      issues.push(`${file.path} contains a sourceMappingURL comment`);
    }
  }
  return issues;
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, base);
    if (!entry.isFile()) return [];
    return [{ path: path.relative(base, fullPath), content: await readFile(fullPath, "utf8") }];
  }));
  return nested.flat();
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const dist = path.resolve(path.dirname(scriptPath), "../apps/web/dist");
  try {
    const issues = findPublicSourcemapIssues(await listFiles(dist));
    if (issues.length) {
      console.error(`Public source map check failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log("Public source map check passed.");
    }
  } catch (error) {
    console.error(`Public source map check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
