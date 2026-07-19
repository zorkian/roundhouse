// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { renderDashboard } from "./dashboard.js";
import { D1RunRepository, type D1Like, type RunSummary } from "./d1-store.js";

const summary = (
  status: RunSummary["run"]["status"],
  issueNumber: number,
  title: string,
): RunSummary => ({
  run: {
    schemaVersion: 2,
    id: `run_${issueNumber}`,
    repository: "zorkian/roundhouse",
    issueNumber,
    baseCommit: "a".repeat(40),
    currentHead: "a".repeat(40),
    profileVersion: "v2",
    status,
    stage: status === "succeeded" ? "merge" : "implement",
    revision: 1,
    issue: {
      title,
      body: "Body",
      url: `https://github.com/zorkian/roundhouse/issues/${issueNumber}`,
      actor: "person",
    },
  },
  createdAt: 1,
  updatedAt: 2,
});

describe("dashboard", () => {
  it("lists recently updated runs from D1", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
      prepare(sql) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind: (...values: unknown[]) => {
            call.values = values;
            return statement;
          },
          all: async () => ({
            meta: {},
            results: [
              {
                document_json: JSON.stringify(summary("active", 1, "One").run),
                created_at: 10,
                updated_at: 20,
              },
            ],
          }),
          first: async () => null,
          run: async () => ({ meta: {} }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      },
    };

    await expect(new D1RunRepository(db).listRuns()).resolves.toMatchObject([
      { run: { issueNumber: 1 }, createdAt: 10, updatedAt: 20 },
    ]);
    expect(calls[0]?.sql).toContain("ORDER BY updated_at DESC LIMIT ?1");
    expect(calls[0]?.values).toEqual([50]);
  });

  it("groups runs, links to details and GitHub, and escapes issue text", () => {
    const html = renderDashboard([
      summary("waiting", 1, "A question"),
      summary("active", 2, "Working"),
      summary("succeeded", 3, "<script>alert(1)</script>"),
    ]);

    expect(html).toContain("Needs attention");
    expect(html).toContain("In progress");
    expect(html).toContain("Recently finished");
    expect(html).toContain("/repositories/zorkian/roundhouse/issues/2");
    expect(html).toContain("https://github.com/zorkian/roundhouse/issues/2");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("has an approachable empty state", () => {
    const html = renderDashboard([]);
    expect(html).toContain("Nothing here right now.");
    expect(html).toContain("0</strong> need attention");
  });
});
