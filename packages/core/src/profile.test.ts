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
