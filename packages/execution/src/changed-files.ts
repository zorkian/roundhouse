// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commitSchema = /^[a-f0-9]{40}$/;

export type ChangedFileStatus =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "type-changed"
  | "unmerged"
  | "untracked";

export type ChangedFile = {
  path: string;
  status: ChangedFileStatus;
  previousPath?: string;
};

const statusNames: Record<string, ChangedFileStatus> = {
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type-changed",
  U: "unmerged",
};

function parseTrackedChanges(output: string): ChangedFile[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();

  const changes: ChangedFile[] = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    if (!rawStatus) throw new Error("Git returned an empty change status");
    const status = statusNames[rawStatus[0] ?? ""];
    if (!status) throw new Error(`Unsupported Git change status: ${rawStatus}`);

    if (status === "renamed" || status === "copied") {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path)
        throw new Error(`Git returned an incomplete ${status} record`);
      changes.push({ path, previousPath, status });
      continue;
    }

    const path = fields[index++];
    if (!path) throw new Error(`Git returned an incomplete ${status} record`);
    changes.push({ path, status });
  }
  return changes;
}

function parseUntrackedFiles(output: string): ChangedFile[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ path, status: "untracked" as const }));
}

export async function inventoryChangedFiles(
  repositoryPath: string,
  baseCommit: string,
): Promise<ChangedFile[]> {
  if (!commitSchema.test(baseCommit))
    throw new Error("baseCommit must be a full lowercase commit SHA");

  await execFileAsync(
    "git",
    ["-C", repositoryPath, "cat-file", "-e", `${baseCommit}^{commit}`],
    { encoding: "utf8" },
  );

  const [{ stdout: tracked }, { stdout: untracked }] = await Promise.all([
    execFileAsync(
      "git",
      [
        "-C",
        repositoryPath,
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        baseCommit,
        "--",
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ),
    execFileAsync(
      "git",
      [
        "-C",
        repositoryPath,
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ),
  ]);

  return [
    ...parseTrackedChanges(tracked),
    ...parseUntrackedFiles(untracked),
  ].sort((left, right) => left.path.localeCompare(right.path));
}
