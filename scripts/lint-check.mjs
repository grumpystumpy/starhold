#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PATTERNS = [
  "@ts-ignore",
  "@ts-nocheck",
  ".skip(",
  ".only(",
  "test.todo(",
  "it.todo(",
];

export function findLintIssues(files) {
  const issues = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (line.includes(pattern)) {
          issues.push(`${file.path}:${i + 1}: Found forbidden pattern '${pattern}'`);
        }
      }
    }
  }
  return issues;
}

export async function listFiles(directory, base = directory) {
  let results = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await listFiles(fullPath, base);
      results = results.concat(subFiles);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, "utf8");
      results.push({ path: path.relative(base, fullPath), content });
    }
  }
  return results;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const rootDir = path.resolve(path.dirname(scriptPath), "..");
  const targetDirs = [
    path.join(rootDir, "packages/game/src"),
    path.join(rootDir, "apps/server/src"),
    path.join(rootDir, "apps/web/src"),
  ];

  let allFiles = [];
  for (const dir of targetDirs) {
    const files = await listFiles(dir, rootDir);
    allFiles = allFiles.concat(files);
  }

  const issues = findLintIssues(allFiles);
  if (issues.length > 0) {
    console.error(`Lint check failed with ${issues.length} issue(s):\n${issues.map((i) => `- ${i}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Lint check passed cleanly across all workspaces.");
  }
}
