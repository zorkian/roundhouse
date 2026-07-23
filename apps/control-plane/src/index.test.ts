// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createRun, MemoryRunRepository, type Attempt } from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("cloudflare:workers")>()),
  WorkflowEntrypoint: class {},
}));
import {
  attemptAllowedHosts,
  pauseForModelBudget,
  RoundhouseAttemptSandbox,
} from "./attempt-container.js";
import {
  artifactNeedsSync,
  attemptContext,
  controlPlaneService,
  handleRequest,
  recoverExpiredAttempts,
  sandboxPreviewPath,
  scheduleAttemptSandboxDestruction,
  successorWakeup,
  validAttemptProgress,
} from "./index.js";
import { ciDiagnosticsNotice } from "./github-ci.js";
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
  CONTROL_PLANE_ORIGIN: "https://direct-worker.invalid",
});

describe("V2 control plane", () => {
  it("prepares a private assignment before its workflow restores the workspace", async () => {
    let finishRestore!: () => void;
    const restoring = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    const storage = new Map<string, unknown>();
    const phases: string[] = [];
    const sandbox = Object.create(
      RoundhouseAttemptSandbox.prototype,
    ) as RoundhouseAttemptSandbox & Record<string, unknown>;
    Object.assign(sandbox, {
      durableState: {
        storage: {
          async put(key: string, value: unknown) {
            storage.set(key, value);
          },
          async get(key: string) {
            return storage.get(key);
          },
          async delete(key: string) {
            return storage.delete(key);
          },
        },
      },
      runtimeEnv: {},
      traceSetup: async (_attemptId: string, phase: string): Promise<void> => {
        phases.push(phase);
      },
      restoreWorkspace: async () => restoring,
      runAttempt: async () => 202,
    });
    const attempt = {
      id: "attempt_1",
      runId: "run_1",
      runRevision: 1,
      stage: "implement",
      deadlineAt: Date.now() + 60_000,
      artifact: {
        remote: "https://artifact.invalid/repository.git",
        hostname: "artifact.invalid",
      },
    } as never;

    await sandbox.prepareAttempt(
      attempt,
      "secret",
      "https://control.invalid/attempts/callback",
      {
        id: "backup_1",
        name: "workspace",
        dir: "/workspace/roundhouse",
        localBucket: true,
      } as never,
    );
    expect(storage.has("prepared:attempt_1")).toBe(true);
    expect(phases).toContain("attempt_workflow_preparation_completed");

    const execution = sandbox.executePreparedAttempt("attempt_1");
    expect(phases).not.toContain("attempt_workflow_execution_completed");
    finishRestore();
    await expect(execution).resolves.toBe(202);
    expect(storage.has("prepared:attempt_1")).toBe(false);
    expect(phases).toContain("attempt_workflow_execution_completed");
  });

  it("routes preview and loopback asset URLs to the sandbox application", () => {
    const previewOrigin = "https://preview.roundhouse.invalid";

    expect(
      sandboxPreviewPath(
        new URL("https://preview.roundhouse.invalid/journal?view=recent"),
        previewOrigin,
      ),
    ).toBe("/journal?view=recent");
    expect(
      sandboxPreviewPath(
        new URL("http://localhost/~test_user/res/5/stylesheet?123"),
        previewOrigin,
      ),
    ).toBe("/~test_user/res/5/stylesheet?123");
    expect(
      sandboxPreviewPath(
        new URL("http://127.0.0.1:8080/static/app.css"),
        previewOrigin,
      ),
    ).toBe("/static/app.css");
    expect(
      sandboxPreviewPath(
        new URL("https://cdn.example.com/static/app.css"),
        previewOrigin,
      ),
    ).toBeUndefined();
  });

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

  it("serves screenshots from the public Worker origin without exposing the dashboard", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const env = {
      ...uiEnv(dashboardDb()),
      BACKUP_BUCKET: {
        get: async (key: string) =>
          key === "screenshots/example.png"
            ? { body: new Uint8Array([137, 80, 78, 71]) }
            : null,
      },
    };

    const screenshot = await fetch(
      new Request("https://direct-worker.invalid/screenshots/example"),
      env as never,
      {} as never,
    );
    expect(screenshot.status).toBe(200);
    expect(screenshot.headers.get("content-type")).toBe("image/png");

    const dashboard = await fetch(
      new Request("https://direct-worker.invalid/"),
      env as never,
      {} as never,
    );
    expect(dashboard.status).toBe(404);

    const protectedOriginScreenshot = await fetch(
      new Request("https://v2.invalid/screenshots/example"),
      env as never,
      {} as never,
    );
    expect(protectedOriginScreenshot.status).toBe(404);
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
      RoundhouseAttemptSandbox.outboundByHost?.["model.roundhouse.internal"],
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
          stage: "plan",
          publish: { hostname: "github.com" },
        },
        "https://control.test/attempts/callback",
      ),
    ).toEqual([
      "model.roundhouse.internal",
      "registry.npmjs.org",
      "ghcr.io",
      "pkg-containers.githubusercontent.com",
      "artifacts.test",
      "github.com",
      "control.test",
    ]);
  });

  it("allows repository development environments to fetch their dependencies", () => {
    expect(
      attemptAllowedHosts({
        artifact: {
          remote: "https://artifacts.test/repository.git",
          hostname: "artifacts.test",
        },
        stage: "implement",
      }),
    ).toEqual(["*"]);
  });

  it("resynchronizes an implementation artifact only when its refreshed base is missing", () => {
    const merged = "b".repeat(40);
    const run = {
      baseCommit: merged,
      currentHead: merged,
    };
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { stage: "implement" },
        run,
      ),
    ).toBe(true);
    expect(
      artifactNeedsSync(
        { empty: false, head: merged },
        { stage: "implement" },
        run,
      ),
    ).toBe(false);
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { stage: "review" },
        run,
      ),
    ).toBe(false);
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { stage: "implement" },
        { ...run, candidateHead: "c".repeat(40) },
      ),
    ).toBe(false);
  });

  it("passes CI failure diagnostics to the repair assignment as untrusted evidence without credentials", () => {
    const candidate = "b".repeat(40);
    const log =
      "File t/customtext-module.t needs tidying\n" +
      "Process completed with exit code 1.\n";
    const ci = {
      status: "failure",
      head: candidate,
      pullRequest: { number: 24, html_url: "https://github.test/pull/24" },
      checks: [{ name: "test", status: "completed", conclusion: "failure" }],
      diagnostics: {
        evidenceKey: `${candidate}:11:31:1`,
        untrusted: true,
        notice: ciDiagnosticsNotice,
        failures: [
          {
            key: `${candidate}:11:31:1`,
            repository: "zorkian/dreamwidth",
            candidateSha: candidate,
            checkRun: { id: 11, name: "test", conclusion: "failure" },
            workflowRun: {
              id: 31,
              attempt: 1,
              name: "CI (fast)",
              conclusion: "failure",
              url: "https://github.test/actions/runs/31",
            },
            jobs: [
              {
                id: 41,
                name: "test",
                conclusion: "failure",
                failedSteps: [
                  {
                    name: "Formatting (changed files only)",
                    conclusion: "failure",
                  },
                ],
                log,
              },
            ],
          },
        ],
      },
    };

    const context = attemptContext({ plan: { status: "ready" }, ci });
    const serialized = JSON.stringify(context);
    expect(serialized).toContain("CI (fast)");
    expect(serialized).toContain("Formatting (changed files only)");
    expect(serialized).toContain("File t/customtext-module.t needs tidying");
    expect(serialized).toContain("Process completed with exit code 1.");
    expect(serialized).toContain("untrusted");
    expect(serialized).not.toContain("installationToken");
    expect(serialized).not.toContain("token");
    expect(attemptContext({})).toBeUndefined();
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
      undefined,
      async (_attemptId, phase) => {
        events.push(`trace:${phase}`);
      },
    );
    expect(events).toEqual([
      "trace:recovery_started",
      "diagnose:run_1_rev_3:3",
      "trace:sandbox_name_resolution_started",
      "trace:sandbox_name_resolution_completed",
      "trace:sandbox_destroy_started",
      "destroy:run_1_rev_3",
      "trace:sandbox_destroy_completed",
      "trace:wakeup_enqueue_started",
      "enqueue:run_1:3",
      "trace:wakeup_enqueue_completed",
      "trace:recovery_completed",
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
        detail: "devcontainer failed",
      }),
    ).toBe(true);
    expect(
      validAttemptProgress({
        phase: "command_output",
        operation: "pi agent",
        output: "raw command output must not be persisted",
      }),
    ).toBe(false);
    expect(
      validAttemptProgress({
        phase: "devcontainer_up_failed",
        detail: "x".repeat(4_001),
      }),
    ).toBe(false);
    expect(
      validAttemptProgress({
        phase: "devcontainer_lifecycle_diagnostics_completed",
        durationMs: 81,
        detail: "mysqld is not running",
      }),
    ).toBe(true);
    expect(
      validAttemptProgress({
        phase: "agent_tool_completed",
        toolCallId: "tool_123",
        stage: "review",
        input: '{"query":"Custom Text"}',
        output: '{"matches":3}',
        durationMs: 42,
      }),
    ).toBe(true);
    expect(
      validAttemptProgress({
        phase: "agent_tool_failed",
        toolCallId: "tool_123",
        input: "x".repeat(4_001),
      }),
    ).toBe(false);
    expect(validAttemptProgress({ phase: "unknown" })).toBe(false);
  });

  it("schedules completed sandbox destruction by immutable attempt id", async () => {
    const events: string[] = [];
    const scheduled: Promise<unknown>[] = [];
    scheduleAttemptSandboxDestruction(
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
