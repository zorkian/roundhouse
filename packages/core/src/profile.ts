// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseDocument } from "yaml";

export const profileSourcePath = ".roundhouse/profile.yaml" as const;

interface AppliedProfileBase {
  readonly sourcePath: typeof profileSourcePath;
  readonly sourceCommit: string;
  readonly hash: string;
}

export interface AppliedProfileV1 extends AppliedProfileBase {
  readonly version: 1;
  readonly paths: {
    readonly allowed: readonly string[];
    readonly protected: readonly string[];
  };
}

export interface AppliedProfileV2 extends AppliedProfileBase {
  readonly version: 2;
  readonly paths: readonly string[];
}

export type AppliedProfile = AppliedProfileV1 | AppliedProfileV2;

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

async function hashCanonical(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseV1(value: Record<string, unknown>): Omit<
  AppliedProfileV1,
  "sourcePath" | "sourceCommit" | "hash"
> & {
  canonical: string;
} {
  if (
    !isRecord(value.paths) ||
    !hasOnlyKeys(value.paths, ["allowed", "protected"])
  )
    throw new Error("profile_schema_invalid");
  const allowed = stringList(value.paths.allowed, "allowed");
  const protectedPaths = stringList(value.paths.protected, "protected");
  [...allowed, ...protectedPaths].forEach(validatePattern);
  return {
    version: 1,
    paths: { allowed, protected: protectedPaths },
    canonical: JSON.stringify({
      version: 1,
      paths: { allowed, protected: protectedPaths },
    }),
  };
}

function parseV2(value: Record<string, unknown>): Omit<
  AppliedProfileV2,
  "sourcePath" | "sourceCommit" | "hash"
> & {
  canonical: string;
} {
  const rules = stringList(value.paths, "rules");
  for (const rule of rules)
    validatePattern(rule.startsWith("!") ? rule.slice(1) : rule);
  return {
    version: 2,
    paths: rules,
    canonical: JSON.stringify({ version: 2, paths: rules }),
  };
}

export async function parseProfile(
  yaml: string,
  sourceCommit: string,
): Promise<AppliedProfile> {
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length) throw new Error("profile_yaml_invalid");
  const value: unknown = document.toJS();
  if (!isRecord(value) || !hasOnlyKeys(value, ["paths", "version"]))
    throw new Error("profile_schema_invalid");
  const parsed =
    value.version === 1
      ? parseV1(value)
      : value.version === 2
        ? parseV2(value)
        : undefined;
  if (!parsed) throw new Error("profile_schema_invalid");
  const { canonical, ...profile } = parsed;
  return {
    sourcePath: profileSourcePath,
    sourceCommit,
    ...profile,
    hash: await hashCanonical(canonical),
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
  if (path === ".roundhouse" || path.startsWith(".roundhouse/"))
    throw new Error("protected_path_changed");
  if (profile.version === 2) {
    let editable = false;
    for (const rule of profile.paths) {
      if (rule.startsWith("!")) {
        if (matches(rule.slice(1), path))
          throw new Error("protected_path_changed");
      } else if (matches(rule, path)) editable = true;
    }
    if (!editable) throw new Error("path_outside_allowlist");
    return;
  }
  if (profile.paths.protected.some((pattern) => matches(pattern, path)))
    throw new Error("protected_path_changed");
  if (!profile.paths.allowed.some((pattern) => matches(pattern, path)))
    throw new Error("path_outside_allowlist");
}
