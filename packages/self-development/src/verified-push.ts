// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";

export type VerifiedPushInput = {
  repositoryPath: string;
  remote: string;
  expectedRemoteUrl: string;
  branch: string;
  expectedRemoteHead: string | null;
  commit: string;
};

export type VerifiedPushResult = {
  remote: string;
  remoteUrl: string;
  branch: string;
  previousHead: string | null;
  head: string;
};

function git(repositoryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: repositoryPath, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
}

async function remoteHead(
  repositoryPath: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const output = await git(repositoryPath, [
    "ls-remote",
    "--heads",
    remote,
    `refs/heads/${branch}`,
  ]);
  if (!output) return null;
  const [sha] = output.split(/\s+/);
  if (!sha || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Remote returned an invalid branch head");
  return sha;
}

export async function pushVerifiedCommit(
  input: VerifiedPushInput,
): Promise<VerifiedPushResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.remote))
    throw new Error("Invalid remote name");
  try {
    await git(input.repositoryPath, [
      "check-ref-format",
      "--branch",
      input.branch,
    ]);
  } catch {
    throw new Error("Invalid branch name");
  }
  if (!/^[a-f0-9]{40}$/.test(input.commit))
    throw new Error("Invalid commit SHA");
  if (
    input.expectedRemoteHead !== null &&
    !/^[a-f0-9]{40}$/.test(input.expectedRemoteHead)
  )
    throw new Error("Invalid expected remote head");
  const head = await git(input.repositoryPath, ["rev-parse", "HEAD"]);
  if (head !== input.commit)
    throw new Error("Local HEAD does not match approved commit");
  const remoteUrl = await git(input.repositoryPath, [
    "remote",
    "get-url",
    input.remote,
  ]);
  if (remoteUrl !== input.expectedRemoteUrl)
    throw new Error("Configured remote URL does not match the task");
  const before = await remoteHead(
    input.repositoryPath,
    input.remote,
    input.branch,
  );
  if (before !== input.expectedRemoteHead)
    throw new Error("Remote branch moved from its expected head");

  const lease = `--force-with-lease=refs/heads/${input.branch}:${before ?? ""}`;
  await git(input.repositoryPath, [
    "push",
    lease,
    input.remote,
    `${input.commit}:refs/heads/${input.branch}`,
  ]);
  const after = await remoteHead(
    input.repositoryPath,
    input.remote,
    input.branch,
  );
  if (after !== input.commit)
    throw new Error(
      "Remote branch does not contain the approved commit after push",
    );
  return {
    remote: input.remote,
    remoteUrl,
    branch: input.branch,
    previousHead: before,
    head: after,
  };
}
