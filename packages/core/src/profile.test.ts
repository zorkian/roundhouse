// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assertPathAllowed, parseProfile } from "./profile.js";

const commit = "a".repeat(40);
const valid = `version: 1
paths:
  allowed:
    - "**"
  protected:
    - ".github/workflows/**"
`;

describe("repository profile parsing", () => {
  it("parses the complete supported document", async () => {
    const profile = await parseProfile(valid, commit);
    expect(profile).toMatchObject({
      sourceCommit: commit,
      version: 1,
      paths: { allowed: ["**"], protected: [".github/workflows/**"] },
    });
  });

  it("matches globstars across zero or more path segments", async () => {
    const profile = await parseProfile(
      `version: 1
paths:
  allowed: ["**/*.ts"]
  protected: ["docs/**/generated.ts"]
`,
      commit,
    );
    expect(() => assertPathAllowed(profile, "index.ts")).not.toThrow();
    expect(() => assertPathAllowed(profile, "src/index.ts")).not.toThrow();
    expect(() => assertPathAllowed(profile, "docs/generated.ts")).toThrow(
      "protected_path_changed",
    );
    expect(() =>
      assertPathAllowed(profile, "docs/nested/generated.ts"),
    ).toThrow("protected_path_changed");
  });

  it("allows either path list to be empty", async () => {
    const noProtectedPaths = await parseProfile(
      `version: 1
paths:
  allowed: ["**"]
  protected: []
`,
      commit,
    );
    expect(() =>
      assertPathAllowed(noProtectedPaths, "src/index.ts"),
    ).not.toThrow();

    const noAllowedPaths = await parseProfile(
      `version: 1
paths:
  allowed: []
  protected: ["docs/**"]
`,
      commit,
    );
    expect(() => assertPathAllowed(noAllowedPaths, "src/index.ts")).toThrow(
      "path_outside_allowlist",
    );
  });

  it.each([
    `${valid}models: []\n`,
    `version: 1\npaths:\n  allowed: ["**"]\n  protected: []\n  reviewers: []\n`,
    `version: 1\npaths:\n  allowed: ["**"]\n  allowed: ["src/**"]\n  protected: ["docs/**"]\n`,
    `version: 1\npaths:\n  allowed: ["**"\n  protected: ["docs/**"]\n`,
    `version: 1\nallowed: ["**"]\npaths:\n  allowed: ["**"]\n  protected: ["docs/**"]\n`,
    `version: 1\npaths:\n  allowed: ["./src/**"]\n  protected: ["docs/**"]\n`,
    `version: 1\npaths:\n  allowed: ["src//**"]\n  protected: ["docs/**"]\n`,
  ])("rejects malformed or unsupported YAML", async (yaml) => {
    await expect(parseProfile(yaml, commit)).rejects.toThrow();
  });
});

const validV2 = `version: 2
paths:
  - "**"
  - "!.github/workflows/**"
`;

describe("version 2 repository profiles", () => {
  it("parses one path-rule list with positive and exclusion rules", async () => {
    const profile = await parseProfile(validV2, commit);
    expect(profile).toMatchObject({
      sourcePath: ".roundhouse/profile.yaml",
      sourceCommit: commit,
      version: 2,
      paths: ["!.github/workflows/**", "**"],
    });
    expect(profile.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes the rule list deterministically for hashing", async () => {
    const first = await parseProfile(validV2, commit);
    const reordered = await parseProfile(
      `version: 2\npaths:\n  - "!.github/workflows/**"\n  - "**"\n  - "**"\n`,
      commit,
    );
    expect(reordered.paths).toEqual(first.paths);
    expect(reordered.hash).toBe(first.hash);
    const other = await parseProfile(`version: 2\npaths: ["src/**"]\n`, commit);
    expect(other.hash).not.toBe(first.hash);
  });

  it("allows only paths matching a positive rule", async () => {
    const profile = await parseProfile(
      `version: 2\npaths: ["src/**"]\n`,
      commit,
    );
    expect(() => assertPathAllowed(profile, "src/index.ts")).not.toThrow();
    expect(() => assertPathAllowed(profile, "index.ts")).toThrow(
      "path_outside_allowlist",
    );
  });

  it.each([
    `version: 2\npaths: ["**", "!docs/**"]\n`,
    `version: 2\npaths: ["!docs/**", "**"]\n`,
  ])(
    "makes exclusions win over positives regardless of rule order",
    async (yaml) => {
      const profile = await parseProfile(yaml, commit);
      expect(() => assertPathAllowed(profile, "src/index.ts")).not.toThrow();
      expect(() => assertPathAllowed(profile, "docs/readme.md")).toThrow(
        "protected_path_changed",
      );
      expect(() => assertPathAllowed(profile, "docs/nested/readme.md")).toThrow(
        "protected_path_changed",
      );
    },
  );

  it("supports overlapping exclusions", async () => {
    const profile = await parseProfile(
      `version: 2\npaths: ["**", "!docs/**", "!docs/private/**"]\n`,
      commit,
    );
    expect(() => assertPathAllowed(profile, "src/index.ts")).not.toThrow();
    expect(() => assertPathAllowed(profile, "docs/private/a.md")).toThrow(
      "protected_path_changed",
    );
  });

  it.each([
    ".roundhouse",
    ".roundhouse/profile.yaml",
    ".roundhouse/state/run.json",
  ])(
    "keeps %s non-editable even when a positive rule matches it",
    async (path) => {
      const profile = await parseProfile(`version: 2\npaths: ["**"]\n`, commit);
      expect(() => assertPathAllowed(profile, path)).toThrow(
        "protected_path_changed",
      );
    },
  );

  it("keeps changed paths repository-rooted", async () => {
    const profile = await parseProfile(validV2, commit);
    expect(() => assertPathAllowed(profile, "/absolute/path")).toThrow(
      "invalid_repository_path",
    );
    expect(() => assertPathAllowed(profile, "../escape")).toThrow(
      "invalid_repository_path",
    );
  });

  it.each([
    `version: 2\npaths: "src/**"\n`,
    `version: 2\npaths:\n  allowed: ["**"]\n`,
    `version: 2\npaths: ["!"]\n`,
    `version: 2\npaths: ["!/absolute/**"]\n`,
    `version: 2\npaths: ["./src/**"]\n`,
    `version: 2\npaths: [42]\n`,
    `version: 3\npaths: ["**"]\n`,
    `version: 2\npaths: ["**"]\nextra: true\n`,
  ])("rejects malformed or unsupported documents", async (yaml) => {
    await expect(parseProfile(yaml, commit)).rejects.toThrow();
  });
});
