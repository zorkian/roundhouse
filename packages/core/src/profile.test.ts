// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseProfile } from "./profile.js";

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

  it.each([
    `${valid}models: []\n`,
    `version: 1\npaths:\n  allowed: ["**"]\n  protected: []\n  reviewers: []\n`,
    `version: 1\npaths:\n  allowed: ["**"]\n  allowed: ["src/**"]\n  protected: ["docs/**"]\n`,
    `version: 1\npaths:\n  allowed: ["**"\n  protected: ["docs/**"]\n`,
    `version: 1\nallowed: ["**"]\npaths:\n  allowed: ["**"]\n  protected: ["docs/**"]\n`,
  ])("rejects malformed or unsupported YAML", async (yaml) => {
    await expect(parseProfile(yaml, commit)).rejects.toThrow();
  });
});
