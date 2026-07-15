// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { TrustedImplementationResult } from "@roundhouse/self-development/cloudflare";

export type PullRequestPackage = {
  headSha?: string;
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  planId: string;
  planSha256: string;
  problem: string;
  implementation: string;
  files: Array<{ path: string; reason: string }>;
  validation: TrustedImplementationResult["validation"];
  regressionEvidence?: TrustedImplementationResult["regressionEvidence"];
};

const section = (name: string, body: string): string =>
  `<!-- roundhouse-package:${name}:start -->\n${body}\n<!-- roundhouse-package:${name}:end -->`;

export function replacePullRequestPackageSection(
  body: string,
  name: "review" | "ci" | "limitations" | "action",
  value: string,
): string {
  const start = `<!-- roundhouse-package:${name}:start -->`;
  const end = `<!-- roundhouse-package:${name}:end -->`;
  const from = body.indexOf(start);
  const to = body.indexOf(end, from + start.length);
  if (from < 0 || to < 0)
    throw new Error(
      "Pull request does not contain a Roundhouse review package",
    );
  return `${body.slice(0, from)}${section(name, value)}${body.slice(to + end.length)}`;
}

export function renderPullRequestPackage(input: PullRequestPackage): string {
  const head = input.headSha
    ? `\`${input.headSha}\``
    : "the commit created by this publication";
  const files = input.files
    .map(({ path, reason }) => `- \`${path}\` — ${reason}`)
    .join("\n");
  const validation = input.validation
    .map(
      (value) =>
        `- \`${value.command}\` — ${value.exitCode === 0 && !value.timedOut ? "passed" : value.timedOut ? "timed out" : `failed (exit ${value.exitCode})`}`,
    )
    .join("\n");
  const reproduction = input.regressionEvidence
    ? [
        `- Pre-change: **${input.regressionEvidence.preChange.outcome}** — ${input.regressionEvidence.preChange.summary}`,
        ...(input.regressionEvidence.command
          ? [`- Command: \`${input.regressionEvidence.command}\``]
          : []),
        ...(input.regressionEvidence.postChange
          ? [
              `- Post-change: **${input.regressionEvidence.postChange.outcome}** — ${input.regressionEvidence.postChange.summary}`,
            ]
          : []),
        `- Evidence binding: plan \`${input.regressionEvidence.planId}\`, attempt \`${input.regressionEvidence.attemptId}\`, patch \`${input.regressionEvidence.headPatchSha256}\``,
      ]
    : ["No separate bug reproduction was required by the approved plan."];
  return [
    "<!-- roundhouse-human-review-package:v1 -->",
    "# Human review package",
    "",
    `This package applies only to exact PR head ${head}. Earlier-head review, CI, and remediation history remains in the PR timeline and retained Roundhouse records.`,
    "",
    "## Source and approved plan",
    "",
    `- Source: [#${input.issueNumber} — ${input.issueTitle}](${input.issueUrl})`,
    `- Approved plan: \`${input.planId}\``,
    `- Plan SHA-256: \`${input.planSha256}\``,
    "",
    "## Problem statement",
    "",
    input.problem,
    "",
    "## Implementation summary",
    "",
    input.implementation ||
      "The implementation agent did not provide a summary.",
    "",
    "## Files changed and why",
    "",
    files,
    "",
    "## Validation",
    "",
    validation,
    "",
    "### Bug reproduction",
    "",
    ...reproduction,
    "",
    section(
      "review",
      "## Independent Claude review\n\nPending for this exact head. Verdict, findings, and dispositions will be written here when available.",
    ),
    "",
    section(
      "ci",
      "## Repository CI\n\nPending observation for this exact head.",
    ),
    "",
    section(
      "limitations",
      "## Known limitations and deferred findings\n\nNone recorded yet. Advisory review findings remain visible here when reported.",
    ),
    "",
    section(
      "action",
      "## Next human action\n\nWait for independent review and repository CI to complete; do not merge while this PR is a draft.",
    ),
    "",
    `Closes #${input.issueNumber}`,
  ].join("\n");
}
