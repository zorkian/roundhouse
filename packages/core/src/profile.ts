// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseDocument } from "yaml";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, i) => key === keys[i])
  );
}

function stringList(value: unknown, heading: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`profile_paths_${heading}_invalid`);
  return [...new Set(value)].sort();
}

function validatePattern(pattern: string): void {
  if (
    !pattern ||
    pattern.startsWith("/") ||
    pattern.includes("\\") ||
    pattern
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("profile_path_pattern_invalid");
}

export async function parseProfile(
  yaml: string,
  sourceCommit: string,
): Promise<AppliedProfile> {
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length) throw new Error("profile_yaml_invalid");
  const value: unknown = document.toJS();
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["paths", "version"]) ||
    value.version !== 1 ||
    !isRecord(value.paths) ||
    !hasOnlyKeys(value.paths, ["allowed", "protected"])
  )
    throw new Error("profile_schema_invalid");
  const allowed = stringList(value.paths.allowed, "allowed");
  const protectedPaths = stringList(value.paths.protected, "protected");
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
      if (pattern[i + 2] === "/") {
        expression += "(?:[^/]+/)*";
        i += 2;
      } else {
        expression += ".*";
        i++;
      }
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
