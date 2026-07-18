// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["apps", "containers", "packages", "scripts"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".pl"]);
const marker = "SPDX-License-Identifier: Apache-2.0";
const excludedDirectories = new Set(["dist", "node_modules"]);
const generatedFiles = new Set(["worker-configuration.d.ts"]);
const missing = [];

async function inspect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await inspect(child);
      continue;
    }
    if (
      generatedFiles.has(entry.name) ||
      (entry.name !== "Dockerfile" &&
        !sourceExtensions.has(extname(entry.name)))
    )
      continue;
    if (!(await readFile(child, "utf8")).includes(marker)) missing.push(child);
  }
}

await Promise.all(roots.map(inspect));

if (missing.length > 0) {
  console.error(`Missing ${marker}:\n${missing.sort().join("\n")}`);
  process.exitCode = 1;
}
