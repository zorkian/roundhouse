// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export const profileSourcePath = ".roundhouse/profile.yaml" as const;

export interface AppliedProfile {
  readonly sourcePath: typeof profileSourcePath;
  readonly sourceCommit: string;
  readonly version: 1;
  readonly hash: string;
  readonly paths: {
    readonly allowed: readonly string[];
    readonly protected: readonly string[];
  };
}

function list(lines: string[], heading: string): string[] {
  const start = lines.indexOf(`  ${heading}:`);
  if (start < 0) throw new Error(`profile_paths_${heading}_required`);
  const values: string[] = [];
  for (let i = start + 1; i < lines.length && /^    /.test(lines[i]!); i++) {
    const match = lines[i]!.match(
      /^    -\s+(?:"([^"]+)"|'([^']+)'|([^#\s][^#]*?))\s*$/,
    );
    if (!match) throw new Error(`profile_${heading}_invalid`);
    values.push((match[1] ?? match[2] ?? match[3]!).trim());
  }
  if (!values.length) throw new Error(`profile_paths_${heading}_required`);
  return [...new Set(values)].sort();
}

function validatePattern(pattern: string): void {
  if (
    !pattern ||
    pattern.startsWith("/") ||
    pattern.includes("\\") ||
    pattern.split("/").includes("..")
  )
    throw new Error("profile_path_pattern_invalid");
}

export async function parseProfile(
  yaml: string,
  sourceCommit: string,
): Promise<AppliedProfile> {
  const lines = yaml
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line && !/^\s*#/.test(line));
  if (lines[0] !== "version: 1" || lines[1] !== "paths:")
    throw new Error("profile_schema_invalid");
  const allowed = list(lines, "allowed");
  const protectedPaths = list(lines, "protected");
  [...allowed, ...protectedPaths].forEach(validatePattern);
  const canonical = JSON.stringify({
    version: 1,
    paths: { allowed, protected: protectedPaths },
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    sourcePath: profileSourcePath,
    sourceCommit,
    version: 1,
    hash,
    paths: { allowed, protected: protectedPaths },
  };
}

export function normalizeRepositoryPath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("invalid_repository_path");
  return path;
}

function matches(pattern: string, path: string): boolean {
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i]!;
    if (character === "*" && pattern[i + 1] === "*") {
      expression += ".*";
      i++;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`).test(path);
}

export function assertPathAllowed(
  profile: AppliedProfile,
  candidate: string,
): void {
  const path = normalizeRepositoryPath(candidate);
  if (
    path === ".roundhouse" ||
    path.startsWith(".roundhouse/") ||
    profile.paths.protected.some((pattern) => matches(pattern, path))
  )
    throw new Error("protected_path_changed");
  if (!profile.paths.allowed.some((pattern) => matches(pattern, path)))
    throw new Error("path_outside_allowlist");
}
