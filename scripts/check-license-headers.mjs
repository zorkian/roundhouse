// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { promisify } from "node:util";

const roots = ["apps", "containers", "packages", "scripts"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".pl"]);
const marker = "SPDX-License-Identifier: Apache-2.0";
const generatedFiles = new Set(["worker-configuration.d.ts"]);
const missing = [];
const run = promisify(execFile);

const { stdout } = await run(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...roots,
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const files = stdout.split("\0").filter(Boolean);

await Promise.all(
  files.map(async (path) => {
    const name = basename(path);
    if (
      generatedFiles.has(name) ||
      (name !== "Dockerfile" && !sourceExtensions.has(extname(name)))
    )
      return;
    if (!(await readFile(path, "utf8")).includes(marker)) missing.push(path);
  }),
);

if (missing.length > 0) {
  console.error(`Missing ${marker}:\n${missing.sort().join("\n")}`);
  process.exitCode = 1;
}
