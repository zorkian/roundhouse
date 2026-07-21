// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createRun, MemoryRunRepository, type Attempt } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import {
  attemptAllowedHosts,
  pauseForModelBudget,
  RoundhouseAttemptContainer,
} from "./attempt-container.js";
import {
  controlPlaneService,
  handleRequest,
  recoverExpiredAttempts,
  scheduleAttemptContainerDestruction,
  successorWakeup,
  validAttemptProgress,
} from "./index.js";
import worker from "./index.js";
import type { D1Like } from "./d1-store.js";

function detailsDb(found = true): D1Like {
  // Multi-repository enrollment stores the numeric GitHub repository ID in
  // github_id and keeps the owner/name in the profile metadata, so the stub
  // only matches when the query looks the name up in that metadata.
  const enrolledGithubId = "1297678423";
  const enrolledRepository = "zorkian/roundhouse";
  const enrolledIssueNumber = 281;
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        first: async () => {
          const [repository, issueNumber] = values;
          const matchesRepository = sql.includes("github_id")
            ? repository === enrolledGithubId
            : repository === enrolledRepository;
          if (
            !found ||
            !matchesRepository ||
            issueNumber !== enrolledIssueNumber
          )
            return null;
          return {
            document_json: JSON.stringify({
              schemaVersion: 2,
              id: "run_1",
              repository: "zorkian/roundhouse",
              issueNumber: 281,
              baseCommit: "base",
              currentHead: "head",
              profileVersion: "v2",
              status: "succeeded",
              stage: "merge",
              revision: 1,
            }),
            created_at: 1,
            updated_at: 2,
          };
        },
        run: async () => ({ meta: {} }),
        all: async () => ({
          meta: {},
          results: sql.includes("FROM attempts") ? [] : undefined,
        }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
}

function dashboardDb(): D1Like {
  return {
    prepare() {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        first: async () => null,
        run: async () => ({ meta: {} }),
        all: async () => ({ meta: {}, results: [] }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
}

const uiEnv = (DB: D1Like) => ({
  DB,
  PUBLIC_ORIGIN: "https://v2.invalid",
});

describe("V2 control plane", () => {
  it("serves the operational dashboard at the root", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const response = await fetch(
      new Request("https://v2.invalid/"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    await expect(response.text()).resolves.toContain(
      "Development runs across enrolled repositories",
    );

    for (const path of [
      "/",
      "/runs",
      "/repositories/zorkian/roundhouse/issues/281",
    ]) {
      const directOrigin = await fetch(
        new Request(`https://direct-worker.invalid${path}`),
        uiEnv(dashboardDb()) as never,
        {} as never,
      );
      expect(directOrigin.status).toBe(404);
    }
  });

  it("reports a small versioned health contract", async () => {
    const response = handleRequest(new Request("https://v2.invalid/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      ok: true,
      service: controlPlaneService,
    });
  });

  it("reconciles immediate successor wakeups through review", () => {
    const processed = { runId: "run_1", expectedRevision: 1 };
    const run = {
      schemaVersion: 2,
      id: "run_1",
      repository: "zorkian/roundhouse",
      issueNumber: 1,
      baseCommit: "a".repeat(40),
      currentHead: "a".repeat(40),
      profileVersion: "v2",
      status: "active",
      stage: "reproduce",
      revision: 2,
    } as const;
    expect(successorWakeup(run, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "plan" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "implement" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "review" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "ci" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "merge" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, revision: 3 }, processed)).toBeUndefined();
  });

  it("does not expose undeclared routes or methods", async () => {
    const missing = handleRequest(new Request("https://v2.invalid/v1/runs"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "not_found" });

    const mutation = handleRequest(
      new Request("https://v2.invalid/health", { method: "POST" }),
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("serves run details and handles unknown, malformed, and non-GET routes", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const html = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
      ),
      uiEnv(detailsDb()) as never,
      {} as never,
    );
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(html.text()).resolves.toContain("Issue #281");

    const missing = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/999",
      ),
      uiEnv(detailsDb(false)) as never,
      {} as never,
    );
    expect(missing.status).toBe(404);

    const malformed = await fetch(
      new Request(
        "https://v2.invalid/repositories/%E0%A4%A/roundhouse/issues/281",
      ),
      uiEnv(detailsDb()) as never,
      {} as never,
    );
    expect(malformed.status).toBe(404);

    const mutation = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
        {
          method: "POST",
        },
      ),
      uiEnv(detailsDb()) as never,
      {} as never,
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("registers the private model egress handler with the Containers SDK", () => {
    expect(
      RoundhouseAttemptContainer.outboundByHost?.["model.roundhouse.internal"],
    ).toBeTypeOf("function");
  });

  it("allows only required attempt services and the package registry", () => {
    expect(
      attemptAllowedHosts(
        {
          artifact: {
            remote: "https://artifacts.test/repository.git",
            hostname: "artifacts.test",
          },
          publish: { hostname: "github.com" },
        },
        "https://control.test/attempts/callback",
      ),
    ).toEqual([
      "model.roundhouse.internal",
      "registry.npmjs.org",
      "artifacts.test",
      "github.com",
      "control.test",
    ]);
  });

  it("stops an account-limited attempt in the budget waiting state", async () => {
    const repository = new MemoryRunRepository();
    const run = createRun({
      id: "run_budget",
      repository: "zorkian/roundhouse",
      issueNumber: 370,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    });
    await repository.create(run);
    const attempt = {
      id: "run_budget_rev_1",
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      stage: "qualify",
      role: "qualify",
      state: "dispatched",
      deadlineAt: Date.now() + 60_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    } satisfies Attempt;
    await repository.createAttempt(attempt);

    await expect(pauseForModelBudget(repository, attempt)).resolves.toBe(true);
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "waiting",
      stage: "qualify",
      revision: 2,
      waitingReason: "budget",
    });
    await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
      state: "failed",
      result: {
        failure: { reason: "budget", source: "model_provider" },
      },
    });
    await expect(pauseForModelBudget(repository, attempt)).resolves.toBe(false);
  });

  it("destroys an inactive sandbox before redispatching its stage", async () => {
    const events: string[] = [];
    const wakeup = { runId: "run_1", expectedRevision: 3 };
    await recoverExpiredAttempts(
      {
        idFromName: (name: string) => name,
        get: (id: unknown) => ({
          destroy: async () => {
            events.push(`destroy:${String(id)}`);
          },
          fetch: async () => new Response(),
        }),
      },
      [wakeup],
      async (next) => {
        events.push(`enqueue:${next.runId}:${next.expectedRevision}`);
      },
      async (attemptId, next) => {
        events.push(`diagnose:${attemptId}:${next.expectedRevision}`);
      },
    );
    expect(events).toEqual([
      "diagnose:run_1_rev_3:3",
      "destroy:run_1_rev_3",
      "enqueue:run_1:3",
    ]);
  });

  it("accepts only bounded runner progress metadata", () => {
    expect(
      validAttemptProgress({
        phase: "command_output",
        operation: "pi agent",
        durationMs: 30_000,
        stdoutBytes: 128,
        stderrBytes: 0,
      }),
    ).toBe(true);
    expect(
      validAttemptProgress({
        phase: "command_output",
        operation: "pi agent",
        output: "raw command output must not be persisted",
      }),
    ).toBe(false);
    expect(validAttemptProgress({ phase: "unknown" })).toBe(false);
  });

  it("schedules completed sandbox destruction by immutable attempt id", async () => {
    const events: string[] = [];
    const scheduled: Promise<unknown>[] = [];
    scheduleAttemptContainerDestruction(
      {
        idFromName: (name: string) => `id:${name}`,
        get: (id: unknown) => ({
          destroy: async () => {
            events.push(`destroy:${String(id)}`);
          },
          fetch: async () => new Response(),
        }),
      },
      "run_1_rev_4",
      {
        waitUntil: (promise) => {
          scheduled.push(promise);
        },
      },
    );
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(events).toEqual(["destroy:id:run_1_rev_4"]);
  });
});
