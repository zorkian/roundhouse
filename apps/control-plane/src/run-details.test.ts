// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { RunDetails } from "./d1-store.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import { renderRunDetails } from "./run-details.js";

describe("run details", () => {
  it("assembles the current run and chronological attempts by repository issue", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind: (...values: unknown[]) => {
            call.values = values;
            return statement;
          },
          first: async () => ({
            document_json: JSON.stringify({
              schemaVersion: 2,
              id: "current-run",
              repository: "zorkian/roundhouse",
              issueNumber: 281,
              baseCommit: "base",
              currentHead: "head",
              profileVersion: "v2",
              status: "active",
              stage: "review",
              revision: 4,
            }),
            created_at: 10,
            updated_at: 20,
          }),
          all: async () => ({
            meta: {},
            results: [
              {
                id: "first",
                run_id: "current-run",
                run_revision: 1,
                kind: "agent",
                stage: "qualify",
                role: "qualifier",
                state: "completed",
                deadline_at: 9,
                base_commit: "base",
                expected_head: "base",
                accepted_head: null,
                result_json: '{"qualification":{"summary":"ok"}}',
                routing_json: '{"provider":"openai","model":"model-a"}',
                created_at: 11,
                updated_at: 12,
              },
            ],
          }),
          run: async () => ({ meta: {} }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      },
    };
    const details = await new D1RunRepository(db).detailsByIssue(
      "zorkian/roundhouse",
      281,
    );
    expect(calls[0]?.values).toEqual(["zorkian/roundhouse", 281]);
    expect(calls[1]?.sql).toContain("ORDER BY created_at ASC,id ASC");
    expect(calls[1]?.values).toEqual(["current-run"]);
    expect(details).toMatchObject({
      run: { id: "current-run" },
      createdAt: 10,
      updatedAt: 20,
      attempts: [
        {
          id: "first",
          createdAt: 11,
          updatedAt: 12,
          routing: { provider: "openai", model: "model-a" },
        },
      ],
    });
  });

  it("renders summary and expandable attempt details without duplicate sections", () => {
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
      usage: [
        {
          callId: "call-1",
          attemptId: "implementation",
          model: "test-model",
          inputTokens: 100,
          cachedInputTokens: 40,
          reasoningTokens: 10,
          outputTokens: 20,
          totalTokens: 120,
          costUsd: 0.01,
        },
      ],
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
          result: {
            ci: { checks: [{ name: "test", url: "https://example.test" }] },
          },
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
    expect(html).toContain("120 tokens");
    expect(html).toContain("$0.01");
    expect(html).toContain(
      "<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>",
    );
    expect(html).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
    expect(html).toContain('class="status succeeded">Succeeded</span>');
    expect(html).toContain("<dt>Elapsed</dt><dd>1 ms</dd>");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(
      "100 input, 40 cached input, unavailable cache creation input, 10 reasoning, 20 output",
    );
    expect(html).toContain("npm test");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/pull/99/files",
    );
    expect(html).toContain('<a href="https://example.test">test</a>');
    expect(html).toContain("</dl>\n<section><h2>Attempt history</h2>");
    for (const heading of [
      "Issue",
      "Commit trace",
      "Usage by workflow step",
      "Qualification",
      "Reproduction",
      "Current behavior",
      "Plan",
      "Implementation and validation",
      "Review",
      "CI checks",
      "Merge",
    ]) {
      expect(html).not.toContain(`<h2>${heading}</h2>`);
    }
  });

  it("renders attempts chronologically as collapsed timeline rows", () => {
    const attempt = (
      id: string,
      stage: "implement" | "review",
      createdAt: number,
    ) => ({
      id,
      runId: "run_timeline",
      runRevision: 1,
      kind: "agent" as const,
      stage,
      role: "worker",
      state: "completed" as const,
      deadlineAt: createdAt + 10_000,
      baseCommit: "base",
      expectedHead: "base",
      createdAt,
      updatedAt: createdAt + 65_000,
    });
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_timeline",
        repository: "zorkian/roundhouse",
        issueNumber: 3,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "review",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        attempt("later", "review", Date.UTC(2026, 0, 2)),
        attempt("earlier", "implement", Date.UTC(2026, 0, 1)),
      ],
    });

    expect(html.indexOf(">implement</span>")).toBeLessThan(
      html.indexOf(">review</span>"),
    );
    expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).toContain('<span class="label">Revision</span>1');
    expect(html).toContain("1m 5s");
    expect(html).toContain('<span class="label">Status</span>completed');
    expect(html.match(/<details>/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
  });

  it("labels feature evidence as current behavior", () => {
    const common = {
      runId: "run_feature",
      kind: "agent" as const,
      state: "completed" as const,
      deadlineAt: 2,
      baseCommit: "base",
      expectedHead: "base",
      createdAt: 1,
      updatedAt: 2,
    };
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_feature",
        repository: "zorkian/roundhouse",
        issueNumber: 3,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "reproduce",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          ...common,
          id: "investigation",
          runRevision: 2,
          stage: "reproduce",
          role: "reproduce",
          result: {
            requestClassification: "feature",
            reproduction: {
              status: "confirmed",
            },
          },
        },
      ],
    });
    expect(html).toContain('<span class="phase">Current behavior</span>');
    expect(html).not.toContain('<span class="phase">reproduce</span>');
    expect(html).toContain("<dt>Current stage</dt><dd>Current behavior</dd>");
    expect(html).not.toContain("<dt>reproduce</dt>");
    expect(html).not.toContain("<h2>Current behavior</h2>");
    expect(html).not.toContain("<h2>Reproduction</h2>");
  });

  it("shows total and per-attempt usage without workflow usage sections", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_usage",
        repository: "zorkian/roundhouse",
        issueNumber: 4,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "implement",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: "implement-1",
          runId: "run_usage",
          runRevision: 1,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "failed",
          deadlineAt: 2,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "implement-2",
          runId: "run_usage",
          runRevision: 2,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "completed",
          deadlineAt: 3,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
      usage: [
        {
          callId: "call-1",
          attemptId: "implement-1",
          model: "test-model",
          totalTokens: 100,
          costUsd: 0.01,
        },
        {
          callId: "call-2",
          attemptId: "implement-2",
          model: "test-model",
          totalTokens: 250,
          costUsd: 0.02,
        },
      ],
    });

    expect(html).toContain('<dt>Total usage</dt><dd><span class="usage-hint"');
    expect(html).toContain('>350 tokens · $0.03<span class="usage-breakdown"');
    expect(html).toContain(
      ".usage-hint:hover .usage-breakdown,.usage-hint:focus .usage-breakdown",
    );
    expect(html).toContain("100 tokens");
    expect(html).toContain("250 tokens");
    expect(html).toContain("$0.03");
    expect(html).not.toContain("<h2>Usage by workflow step</h2>");
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
    expect(html).toContain("<title>Issue #1</title>");
    expect(html).toContain("<h1>Issue #1</h1>");
    expect(html).toContain("Unavailable");
  });

  it("does not label an unaccepted merge head as merged", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_failed_merge",
        repository: "zorkian/roundhouse",
        issueNumber: 2,
        baseCommit: "base",
        currentHead: "candidate",
        profileVersion: "test",
        status: "failed",
        stage: "merge",
        revision: 1,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: "merge",
          runId: "run_failed_merge",
          runRevision: 1,
          kind: "external",
          stage: "merge",
          role: "github-merge",
          state: "failed",
          deadlineAt: 2,
          baseCommit: "base",
          expectedHead: "candidate",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(html).toContain(
      "<dt>Accepted head</dt><dd><code>Unavailable</code></dd>",
    );
  });
});
