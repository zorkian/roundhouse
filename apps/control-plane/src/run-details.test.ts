// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { RunDetails } from "./d1-store.js";
import { renderRunDetails } from "./run-details.js";

describe("run details", () => {
  it("renders recorded evidence, commit history, routing, and escaped text", () => {
    const details: RunDetails = {
      run: {
        schemaVersion: 2,
        id: "run_1",
        repository: "zorkian/roundhouse",
        issueNumber: 281,
        baseCommit: "base-sha",
        currentHead: "merged-sha",
        profileVersion: "test",
        status: "succeeded",
        stage: "merge",
        revision: 7,
        issue: {
          title: "<script>alert(1)</script>",
          body: "issue body",
          url: "https://github.com/zorkian/roundhouse/issues/281",
          actor: "user",
        },
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: "implementation",
          runId: "run_1",
          runRevision: 3,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "completed",
          deadlineAt: 3,
          baseCommit: "base-sha",
          expectedHead: "base-sha",
          acceptedHead: "candidate-sha",
          result: {
            implementation: {
              summary: "done <img src=x onerror=alert(1)>",
              validation: [{ command: "npm test", output: "<b>bad</b>" }],
              pullRequest: {
                number: 99,
                html_url: "https://github.com/zorkian/roundhouse/pull/99",
              },
            },
          },
          routing: { provider: "openai", model: "test-model" },
          createdAt: 3,
          updatedAt: 4,
        },
        {
          id: "review",
          runId: "run_1",
          runRevision: 4,
          kind: "agent",
          stage: "review",
          role: "reviewer",
          state: "completed",
          deadlineAt: 5,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "candidate-sha",
          result: { review: { status: "clean", findings: [] } },
          createdAt: 5,
          updatedAt: 6,
        },
        {
          id: "ci",
          runId: "run_1",
          runRevision: 5,
          kind: "external",
          stage: "ci",
          role: "github-checks",
          state: "completed",
          deadlineAt: 7,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "candidate-sha",
          result: { ci: { checks: [{ name: "test", url: "https://example.test" }] } },
          createdAt: 7,
          updatedAt: 8,
        },
        {
          id: "merge",
          runId: "run_1",
          runRevision: 6,
          kind: "external",
          stage: "merge",
          role: "github-merge",
          state: "completed",
          deadlineAt: 9,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "merged-sha",
          result: { merge: { status: "merged" } },
          createdAt: 9,
          updatedAt: 10,
        },
      ],
    };
    const html = renderRunDetails(details);
    expect(html).toContain("candidate-sha");
    expect(html).toContain("merged-sha");
    expect(html).toContain("test-model");
    expect(html).toContain("npm test");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("https://github.com/zorkian/roundhouse/pull/99/files");
  });

  it("identifies missing optional evidence", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_2",
        repository: "zorkian/roundhouse",
        issueNumber: 1,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "qualify",
        revision: 0,
      },
      createdAt: 1,
      updatedAt: 1,
      attempts: [],
    });
    expect(html).toContain("No attempts recorded");
    expect(html).toContain("Unavailable");
  });
});
