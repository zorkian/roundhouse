// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  automaticMergeDecisionPackage,
  mergedPullRequestOutcomePackage,
  renderPullRequestPackage,
  replacePullRequestPackageSection,
} from "./github-pr-package.js";

describe("GitHub pull request review package", () => {
  it("renders every human decision section bound to the exact head", () => {
    const body = renderPullRequestPackage({
      headSha: "d".repeat(40),
      issueNumber: 7,
      issueUrl: "https://github.com/zorkian/roundhouse/issues/7",
      issueTitle: "Review package",
      planId: `plan_${"a".repeat(40)}`,
      planSha256: "b".repeat(64),
      problem: "Reviewers need complete context.",
      implementation: "Added a complete package.",
      files: [{ path: "file.ts", reason: "implements the approved plan" }],
      validation: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
          stdout: "",
          stderr: "",
          outputTruncated: false,
        },
      ],
      regressionEvidence: {
        repositoryUrl: "https://github.com/zorkian/roundhouse.git",
        baseCommit: "c".repeat(40),
        planId: `plan_${"a".repeat(40)}`,
        planSha256: "b".repeat(64),
        attemptId: "run_review-prepare-1",
        headPatchSha256: "e".repeat(64),
        command: "pnpm test",
        preChange: {
          outcome: "reproduced",
          summary: "The bug reproduced.",
          output: "failed",
          outputTruncated: false,
        },
        postChange: {
          outcome: "passed",
          summary: "The regression now passes.",
          output: "passed",
          outputTruncated: false,
        },
      },
    });
    expect(body).toContain(`exact PR head \`${"d".repeat(40)}\``);
    expect(body).toContain("Approved plan");
    expect(body).toContain("Files changed and why");
    expect(body).toContain("Bug reproduction");
    expect(body).toContain("Pre-change: **reproduced**");
    expect(body).toContain("Post-change: **passed**");
    expect(body).toContain("Independent Claude review");
    expect(body).toContain("Repository CI");
    expect(body).toContain("Known limitations");
    expect(body).toContain("Risk analysis and recommendation");
    expect(body).toContain("No merge recommendation has been made yet");
    expect(body).toContain("Next human action");
  });

  it("updates one rolling section without removing the package", () => {
    const initial = renderPullRequestPackage({
      issueNumber: 7,
      issueUrl: "https://github.com/zorkian/roundhouse/issues/7",
      issueTitle: "Review package",
      planId: "plan",
      planSha256: "sha",
      problem: "problem",
      implementation: "summary",
      files: [{ path: "file.ts", reason: "reason" }],
      validation: [],
    });
    const updated = replacePullRequestPackageSection(
      initial,
      "ci",
      "## Repository CI\n\nPassing.",
    );
    expect(updated).toContain("Passing.");
    expect(updated).toContain("## Source and approved plan");
    expect(updated).not.toContain("Pending observation");
  });

  it("renders exact-head automatic-merge risk and final outcome sections", () => {
    const headSha = "d".repeat(40);
    const mergeCommitSha = "e".repeat(40);
    const decision = automaticMergeDecisionPackage({
      headSha,
      approvedPaths: ["docs/one.md", "packages/example/src/index.ts"],
    });
    expect(decision).toContain(`exact head \`${headSha}\``);
    expect(decision).toContain("**Policy risk:** low");
    expect(decision).toContain("**Blast radius:** 2 approved changed files");
    expect(decision).toContain("Protected or sensitive areas");
    expect(decision).toContain(
      "Migration, dependency, or configuration effects",
    );
    expect(decision).toContain("**Rollback:**");
    expect(decision).toContain("Test gaps and residual risk");
    expect(decision).toContain("**Confidence:**");
    expect(decision).toContain("**Recommendation: Merge automatically.**");

    const initial = renderPullRequestPackage({
      issueNumber: 7,
      issueUrl: "https://github.com/zorkian/roundhouse/issues/7",
      issueTitle: "Review package",
      planId: "plan",
      planSha256: "sha",
      problem: "problem",
      implementation: "summary",
      files: [{ path: "file.ts", reason: "reason" }],
      validation: [],
    });
    const recommended = replacePullRequestPackageSection(
      initial,
      "decision",
      decision,
    );
    expect(recommended).toContain("Merge automatically");
    expect(recommended).toContain("## Source and approved plan");

    const outcome = mergedPullRequestOutcomePackage({
      pullRequestNumber: 42,
      mergeCommitSha,
    });
    expect(outcome).toContain("Pull request #42 is closed as merged");
    expect(outcome).toContain(`commit \`${mergeCommitSha}\``);
    expect(outcome).toContain("No action needed");
    expect(outcome).toContain("deployment status is owned by the repository");
    expect(outcome).not.toContain("deployed successfully");
  });
});
