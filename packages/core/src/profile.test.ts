// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPathAllowed, parseProfile } from "./profile.js";

const commit = "a".repeat(40);
const valid = `version: 1
paths:
  allowed:
    - "**"
  protected:
    - ".github/workflows/**"
`;
const validV2 = `version: 2
paths:
  allowed: ["**"]
  protected: [".github/workflows/**"]
merge:
  mode: maintainer
  method: squash
permissions:
  operators:
    repository_permissions: [admin, maintain, write]
    users: [zorkian]
    teams: [dreamwidth/maintainers]
instructions:
  project: prompts/project.md
stages:
  qualification:
    model: { id: openai/gpt-5.6-sol, reasoning: low }
  investigation:
    model: { id: openai/gpt-5.6-sol, reasoning: low }
  planning:
    model: { id: openai/gpt-5.6-sol, reasoning: low }
    instructions: prompts/planning.md
  implementation:
    model: { id: moonshotai/kimi-k3, reasoning: low }
    instructions: prompts/implementation.md
reviewers:
  holistic:
    enabled: true
    model: { id: openai/gpt-5.6-sol, reasoning: low }
    instructions: prompts/review-holistic.md
    blocking_severities: [critical, high, medium]
  security:
    enabled: true
    selected_by: holistic
    model: { id: openai/gpt-5.6-sol, reasoning: low }
    blocking_severities: [critical, high, medium]
  data:
    enabled: false
    selected_by: holistic
    model: { id: openai/gpt-5.6-sol, reasoning: low }
    blocking_severities: [critical, high]
validation:
  commands:
    - name: tests
      run: [pnpm, test]
development_environment:
  devcontainer: .devcontainer/devcontainer.json
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

  it("loads and snapshots a complete version 2 profile", async () => {
    const files = new Map([
      [".roundhouse/prompts/project.md", "Project instructions"],
      [".roundhouse/prompts/planning.md", "Planning instructions"],
      [".roundhouse/prompts/implementation.md", "Implementation instructions"],
      [
        ".roundhouse/prompts/review-holistic.md",
        "Holistic review instructions",
      ],
    ]);
    const profile = await parseProfile(validV2, commit, async (path) => {
      const content = files.get(path);
      if (!content) throw new Error("missing");
      return content;
    });
    expect(profile).toMatchObject({
      version: 2,
      merge: { mode: "maintainer", method: "squash" },
      permissions: {
        operators: {
          repositoryPermissions: ["admin", "maintain", "write"],
          users: ["zorkian"],
          teams: ["dreamwidth/maintainers"],
        },
      },
      instructions: {
        project: {
          sourcePath: ".roundhouse/prompts/project.md",
          content: "Project instructions",
        },
      },
      stages: {
        implementation: {
          model: { id: "moonshotai/kimi-k3", reasoning: "low" },
          instructions: {
            sourcePath: ".roundhouse/prompts/implementation.md",
          },
        },
      },
      reviewers: {
        data: {
          enabled: false,
          selectedBy: "holistic",
          blockingSeverities: ["critical", "high"],
        },
      },
      validation: {
        commands: [{ name: "tests", run: ["pnpm", "test"] }],
      },
      developmentEnvironment: {
        devcontainer: ".devcontainer/devcontainer.json",
      },
    });
  });

  it("parses Roundhouse's checked-in profile and instruction files", async () => {
    const profile = await parseProfile(
      await readFile(resolve(".roundhouse/profile.yaml"), "utf8"),
      commit,
      (path) => readFile(resolve(path), "utf8"),
    );
    expect(profile).toMatchObject({
      version: 2,
      merge: { mode: "automatic", method: "merge" },
      stages: {
        implementation: {
          model: { id: "moonshotai/kimi-k3", reasoning: "low" },
        },
      },
      validation: {
        commands: [{ name: "repository checks", run: ["pnpm", "check"] }],
      },
    });
    expect(profile.instructions?.project?.content).toContain(
      "capture before-and-after screenshots",
    );
  });

  it("includes referenced instruction contents in the profile hash", async () => {
    const load = (project: string) => async (path: string) =>
      path.endsWith("project.md") ? project : path;
    const first = await parseProfile(validV2, commit, load("First"));
    const second = await parseProfile(validV2, commit, load("Second"));
    expect(first.hash).not.toBe(second.hash);
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

  it("always protects the selected development container", async () => {
    const profile = await parseProfile(validV2, commit, async (path) => path);
    expect(() =>
      assertPathAllowed(profile, ".devcontainer/devcontainer.json"),
    ).toThrow("protected_path_changed");
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
