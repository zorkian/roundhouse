// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { planValidation } from "./validation-plan.js";

const profile = parseRepositoryProfile(`
version: 1
runtime: { image: roundhouse/runner:dev, workspace: /workspace }
bootstrap: { command: pnpm, args: [install] }
validation:
  format: { command: pnpm, args: [format:check] }
  compile: { command: pnpm, args: [typecheck] }
  targeted: { command: pnpm, args: [test] }
  quick:
    format:
      command: pnpm
      args: [exec, prettier, --check]
      include: ["**/*.ts", "**/*.md"]
    fullWhenChanged: [package.json, ".github/workflows/**"]
  timeoutMinutes: 15
network: { default: deny, capabilities: [] }
protectedPaths: []
artifacts: { include: [] }
`);

describe("planValidation", () => {
  it("passes only supported changed paths to the quick formatter", () => {
    const plan = planValidation(profile, {
      baseCommit: "a".repeat(40),
      level: "quick",
      changedFiles: [
        { path: "src/change.ts", status: "modified" },
        { path: "removed.ts", status: "deleted" },
        { path: "image.png", status: "untracked" },
      ],
    });

    expect(plan.effectiveLevel).toBe("quick");
    expect(plan.commands[0]).toEqual({
      name: "format",
      command: {
        command: "pnpm",
        args: ["exec", "prettier", "--check", "src/change.ts"],
      },
    });
    expect(plan.commands.map((command) => command.name)).toEqual([
      "format",
      "compile",
      "targeted",
    ]);
  });

  it("escalates global configuration changes to full validation", () => {
    const plan = planValidation(profile, {
      baseCommit: "a".repeat(40),
      level: "quick",
      changedFiles: [{ path: "package.json", status: "modified" }],
    });

    expect(plan.effectiveLevel).toBe("full");
    expect(plan.reasons).toEqual(["package.json requires full validation"]);
    expect(plan.commands[0]?.command.args).toEqual(["format:check"]);
  });

  it("checks a renamed file's previous path when deciding escalation", () => {
    const plan = planValidation(profile, {
      baseCommit: "a".repeat(40),
      level: "quick",
      changedFiles: [
        {
          path: "workflow-disabled.yml",
          previousPath: ".github/workflows/ci.yml",
          status: "renamed",
        },
      ],
    });

    expect(plan.effectiveLevel).toBe("full");
  });
});
