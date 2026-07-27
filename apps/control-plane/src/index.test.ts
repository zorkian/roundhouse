// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  createRun,
  defaultIssueWorkflowSource,
  MemoryRunRepository,
  type Attempt,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("cloudflare:workers")>()),
  WorkflowEntrypoint: class {},
}));
import {
  attemptAllowedHosts,
  attemptUsesProjectEnvironment,
  pauseForModelBudget,
  RoundhouseAttemptSandbox,
} from "./attempt-container.js";
import {
  artifactNeedsSync,
  attemptArtifactAccess,
  attemptContext,
  controlPlaneService,
  handleRequest,
  recoverExpiredAttempts,
  resolveWorkflowAgentInputs,
  sandboxPreviewPath,
  scheduleAttemptSandboxDestruction,
  successorWakeup,
  validAttemptProgress,
} from "./index.js";
import { ciDiagnosticsNotice } from "./github-ci.js";
import worker from "./index.js";
import type { D1Like } from "./d1-store.js";

const workflowCommit = "a".repeat(40);
const workflow = await compileWorkflow(
  defaultIssueWorkflowSource,
  workflowCommit,
);

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
          const issueNumber = values[1];
          const matchesRepository = sql.includes("github_id IN (")
            ? values.includes(enrolledGithubId)
            : values.includes(enrolledRepository);
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
  GITHUB_CLIENT_ID: "client-id",
  ROUNDHOUSE_GITHUB_CLIENT_SECRET: "client-secret",
});

const authedUiCookie = "roundhouse_ui_session=test-session";

// Extends a UI database stub with one valid, unexpired browser session.
function withUiSession(DB: D1Like, repositoryIds = '["1297678423"]'): D1Like {
  return {
    prepare(sql: string) {
      if (sql.includes("FROM ui_sessions")) {
        const statement = {
          bind: (..._values: unknown[]) => statement,
          first: async () => ({
            github_user_id: 7,
            github_login: "octocat",
            repository_ids_json: repositoryIds,
            expires_at: Date.now() + 60_000,
          }),
          run: async () => ({ meta: {} }),
          all: async () => ({ meta: {}, results: [] }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      }
      return DB.prepare(sql);
    },
  };
}

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
      runAttempt: async () => ({
        status: 200,
        responseBody: JSON.stringify({
          attemptId: "attempt_1",
          expectedRevision: 1,
          checkpoint: {},
          artifactTokenId: "token-id",
          result: { outcome: "ok" },
        }),
      }),
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

    await sandbox.prepareAttempt(attempt, "secret", "https://control.invalid", {
      id: "backup_1",
      name: "workspace",
      dir: "/workspace/roundhouse",
      localBucket: true,
    } as never);
    expect(storage.has("prepared:attempt_1")).toBe(true);
    expect(phases).toContain("attempt_workflow_preparation_completed");

    const restore = sandbox.restorePreparedAttempt("attempt_1");
    expect(phases).not.toContain("attempt_workflow_restore_completed");
    finishRestore();
    await restore;
    expect(storage.has("prepared:attempt_1")).toBe(true);
    const execution = sandbox.executePreparedAttempt("attempt_1");
    await expect(execution).resolves.toMatchObject({
      attemptId: "attempt_1",
      expectedRevision: 1,
    });
    expect(storage.has("prepared:attempt_1")).toBe(false);
    expect(phases).toContain("attempt_workflow_restore_completed");
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
    const signedOut = await fetch(
      new Request("https://v2.invalid/"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(signedOut.status).toBe(200);
    await expect(signedOut.text()).resolves.toContain("Sign in with GitHub");

    const response = await fetch(
      new Request("https://v2.invalid/", {
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb())) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    const body = await response.text();
    expect(body).toContain("Development runs across enrolled repositories");
    expect(body).toContain("Sign out");

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
        { headers: { cookie: authedUiCookie } },
      ),
      uiEnv(withUiSession(detailsDb())) as never,
      {} as never,
    );
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(html.text()).resolves.toContain("Issue #281");

    const missing = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/999",
        { headers: { cookie: authedUiCookie } },
      ),
      uiEnv(withUiSession(detailsDb(false))) as never,
      {} as never,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");

    const malformed = await fetch(
      new Request(
        "https://v2.invalid/repositories/%E0%A4%A/roundhouse/issues/281",
        { headers: { cookie: authedUiCookie } },
      ),
      uiEnv(withUiSession(detailsDb())) as never,
      {} as never,
    );
    expect(malformed.status).toBe(404);

    const mutation = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
        { method: "POST", headers: { cookie: authedUiCookie } },
      ),
      uiEnv(withUiSession(detailsDb())) as never,
      {} as never,
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("makes unauthorized and missing direct pages indistinguishable", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const request = () =>
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
        { headers: { cookie: authedUiCookie } },
      );
    const missing = await fetch(
      request(),
      uiEnv(withUiSession(detailsDb(false))) as never,
      {} as never,
    );
    const unauthorized = await fetch(
      request(),
      uiEnv(withUiSession(detailsDb(), '["9999999999"]')) as never,
      {} as never,
    );
    expect(missing.status).toBe(404);
    expect(unauthorized.status).toBe(404);
    expect(await unauthorized.text()).toBe(await missing.text());
  });

  it("registers the private model egress handler with the Containers SDK", () => {
    expect(
      RoundhouseAttemptSandbox.outboundByHost?.["model.roundhouse.internal"],
    ).toBeTypeOf("function");
  });

  it("resolves typed workflow inputs from exact durable node results", async () => {
    const repository = new MemoryRunRepository();
    const profile = {
      sourcePath: ".roundhouse/profile.yaml" as const,
      sourceCommit: workflowCommit,
      version: 1 as const,
      hash: "profile",
      workflow,
      paths: { allowed: ["**"], protected: [] },
    };
    const initial = createRun({
      id: "run_inputs",
      repository: "zorkian/roundhouse",
      issueNumber: 1,
      baseCommit: workflowCommit,
      profileVersion: profile.hash,
      profile,
      issue: {
        title: "Typed inputs",
        body: "Use durable evidence",
        url: "https://github.test/issues/1",
        actor: "maintainer",
      },
    });
    const results = [
      ["qualify", "qualification", { classification: "bug" }],
      ["investigate", "reproduction", { status: "confirmed" }],
      ["plan", "plan", { status: "ready" }],
    ] as const;
    for (const [index, [nodeId, key, result]] of results.entries()) {
      const attempt: Attempt = {
        id: `attempt_${nodeId}`,
        runId: initial.id,
        runRevision: index + 1,
        kind: "agent",
        nodeId,
        executor: "agent.read",
        stage:
          nodeId === "qualify"
            ? "qualify"
            : nodeId === "investigate"
              ? "reproduce"
              : "plan",
        role: nodeId,
        state: "created",
        deadlineAt: 1,
        baseCommit: initial.baseCommit,
        expectedHead: initial.currentHead,
      };
      repository.attempts.set(attempt.id, {
        ...attempt,
        state: "completed",
        acceptedHead: attempt.expectedHead,
        result: { [key]: result },
      });
    }
    const run = {
      ...initial,
      revision: 4,
      stage: "implement" as const,
      currentNodeId: "implement",
    };
    const attempt: Attempt = {
      id: "attempt_implement",
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      nodeId: "implement",
      executor: "agent.write",
      stage: "implement",
      role: "implement",
      state: "created",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    };
    const resolved = await resolveWorkflowAgentInputs(
      repository,
      run,
      attempt,
      workflow.nodes.implement!.agent!,
    );
    expect(resolved.values).toMatchObject({
      issue: { title: "Typed inputs" },
      qualification: { classification: "bug" },
      reproduction: { status: "confirmed" },
      plan: { status: "ready" },
    });
    expect(resolved.evidence.plan).toMatchObject({
      selector: "nodes.plan.plan",
      present: true,
      sourceAttemptId: "attempt_plan",
      sourceHead: workflowCommit,
    });
    expect(resolved.evidence.review).toEqual({
      selector: "nodes.review.review",
      present: false,
    });
  });

  it("resolves a review node to the joined findings from every selected reviewer", async () => {
    const repository = new MemoryRunRepository();
    const profile = {
      sourcePath: ".roundhouse/profile.yaml" as const,
      sourceCommit: workflowCommit,
      version: 1 as const,
      hash: "profile",
      workflow,
      paths: { allowed: ["**"], protected: [] },
    };
    const initial = createRun({
      id: "run_joined_review_inputs",
      repository: "zorkian/roundhouse",
      issueNumber: 414,
      baseCommit: workflowCommit,
      profileVersion: profile.hash,
      profile,
      issue: {
        title: "Joined reviews",
        body: "Preserve every selected finding.",
        url: "https://github.test/issues/414",
        actor: "maintainer",
      },
    });
    for (const [revision, nodeId, key, value] of [
      [1, "qualify", "qualification", { classification: "feature" }],
      [2, "investigate", "reproduction", { status: "confirmed" }],
      [3, "plan", "plan", { status: "ready" }],
    ] as const) {
      repository.attempts.set(`attempt_${nodeId}`, {
        id: `attempt_${nodeId}`,
        runId: initial.id,
        runRevision: revision,
        kind: "agent",
        nodeId,
        executor: "agent.read",
        stage:
          nodeId === "qualify"
            ? "qualify"
            : nodeId === "investigate"
              ? "reproduce"
              : "plan",
        role: nodeId,
        state: "completed",
        deadlineAt: 1,
        baseCommit: initial.baseCommit,
        expectedHead: initial.currentHead,
        acceptedHead: initial.currentHead,
        result: { [key]: value },
      });
    }
    const review = (
      role: "review-holistic" | "review-security",
      finding: string,
    ): Attempt => ({
      id: `attempt_${role}`,
      runId: initial.id,
      runRevision: 4,
      kind: "agent",
      nodeId: "review",
      executor: "review",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: 1,
      baseCommit: initial.baseCommit,
      expectedHead: initial.currentHead,
      acceptedHead: initial.currentHead,
      result: {
        review: {
          status: "changes_requested",
          summary: finding,
          findings: [
            {
              title: finding,
              details: `${finding} details`,
              severity: "medium",
              file: "src/index.ts",
            },
          ],
          ...(role === "review-holistic"
            ? {
                selections: [
                  {
                    role: "review-security",
                    applicable: true,
                    rationale: "Authentication changed.",
                  },
                  {
                    role: "review-data",
                    applicable: false,
                    rationale: "No persistence changes.",
                  },
                ],
              }
            : {}),
        },
      },
    });
    const holistic = review("review-holistic", "Public repositories omitted");
    const security = review("review-security", "OAuth state is not bound");
    repository.attempts.set(holistic.id, holistic);
    repository.attempts.set(security.id, security);
    const run = {
      ...initial,
      revision: 5,
      stage: "implement" as const,
      currentNodeId: "implement",
    };
    const attempt: Attempt = {
      id: "attempt_implement_fix",
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      nodeId: "implement",
      executor: "agent.write",
      stage: "implement",
      role: "implement",
      state: "created",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    };

    const resolved = await resolveWorkflowAgentInputs(
      repository,
      run,
      attempt,
      workflow.nodes.implement!.agent!,
    );

    expect(
      (
        resolved.values.review as { findings: readonly { title: string }[] }
      ).findings.map(({ title }) => title),
    ).toEqual(["Public repositories omitted", "OAuth state is not bound"]);
    expect(resolved.evidence.review).toMatchObject({
      selector: "nodes.review.review",
      present: true,
      sourceAttemptIds: [holistic.id, security.id],
    });
  });

  it("preserves implementation screenshots across repeated fix passes", async () => {
    const repository = new MemoryRunRepository();
    const profile = {
      sourcePath: ".roundhouse/profile.yaml" as const,
      sourceCommit: workflowCommit,
      version: 1 as const,
      hash: "profile",
      workflow,
      paths: { allowed: ["**"], protected: [] },
    };
    const initial = createRun({
      id: "run_cumulative_implementation_evidence",
      repository: "zorkian/roundhouse",
      issueNumber: 414,
      baseCommit: workflowCommit,
      profileVersion: profile.hash,
      profile,
      issue: {
        title: "Preserve visual evidence",
        body: "Keep valid screenshots through review fix passes.",
        url: "https://github.test/issues/414",
        actor: "maintainer",
      },
    });
    for (const [revision, nodeId, key, value] of [
      [1, "qualify", "qualification", { classification: "feature" }],
      [2, "investigate", "reproduction", { status: "confirmed" }],
      [3, "plan", "plan", { status: "ready" }],
    ] as const) {
      repository.attempts.set(`attempt_${nodeId}`, {
        id: `attempt_${nodeId}`,
        runId: initial.id,
        runRevision: revision,
        kind: "agent",
        nodeId,
        executor: "agent.read",
        stage:
          nodeId === "qualify"
            ? "qualify"
            : nodeId === "investigate"
              ? "reproduce"
              : "plan",
        role: nodeId,
        state: "completed",
        deadlineAt: 1,
        baseCommit: initial.baseCommit,
        expectedHead: initial.currentHead,
        acceptedHead: initial.currentHead,
        result: { [key]: value },
      });
    }
    const implementation = (
      id: string,
      revision: number,
      summary: string,
      screenshots: readonly Readonly<Record<string, unknown>>[],
    ): Attempt => ({
      id,
      runId: initial.id,
      runRevision: revision,
      kind: "agent",
      nodeId: "implement",
      executor: "agent.write",
      stage: "implement",
      role: "implement",
      state: "completed",
      deadlineAt: 1,
      baseCommit: initial.baseCommit,
      expectedHead: initial.currentHead,
      acceptedHead: `${revision}`.repeat(40),
      result: {
        implementation: {
          summary,
          validation: [],
          screenshots,
        },
      },
    });
    const first = implementation("attempt_implement_first", 4, "Initial", [
      { url: "https://example.test/signed-in", description: "Signed in" },
      { url: "https://example.test/unauthorized", description: "Denied" },
    ]);
    const latest = implementation("attempt_implement_latest", 6, "Fixed", [
      {
        url: "https://example.test/signed-in",
        description: "Signed in, still valid",
      },
      { url: "https://example.test/signed-out", description: "Signed out" },
    ]);
    repository.attempts.set(first.id, first);
    repository.attempts.set(latest.id, latest);
    const run = {
      ...initial,
      revision: 7,
      stage: "implement" as const,
      currentNodeId: "implement",
    };
    const attempt: Attempt = {
      id: "attempt_implement_next",
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      nodeId: "implement",
      executor: "agent.write",
      stage: "implement",
      role: "implement",
      state: "created",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: latest.acceptedHead!,
    };

    const resolved = await resolveWorkflowAgentInputs(
      repository,
      run,
      attempt,
      workflow.nodes.implement!.agent!,
    );

    expect(resolved.values.implementation).toEqual({
      summary: "Fixed",
      validation: [],
      screenshots: [
        {
          url: "https://example.test/signed-in",
          description: "Signed in, still valid",
        },
        {
          url: "https://example.test/unauthorized",
          description: "Denied",
        },
        {
          url: "https://example.test/signed-out",
          description: "Signed out",
        },
      ],
    });
    expect(resolved.evidence.implementation).toMatchObject({
      selector: "nodes.implement.implementation",
      present: true,
      sourceAttemptId: latest.id,
      sourceAttemptIds: [first.id, latest.id],
      sourceHead: latest.acceptedHead,
    });
  });

  it("allows only required attempt services and the package registry", () => {
    expect(
      attemptAllowedHosts(
        {
          artifact: {
            remote: "https://artifacts.test/repository.git",
            hostname: "artifacts.test",
          },
          capabilities: [],
          executor: "agent.read",
          stage: "plan",
          publish: { hostname: "github.com" },
        },
        "https://control.test",
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
        capabilities: ["network.project"],
        executor: "agent.write",
        stage: "implement",
      }),
    ).toEqual(["*"]);
  });

  it("selects the project environment independently from network authority", () => {
    expect(
      attemptUsesProjectEnvironment({
        capabilities: ["environment.project"],
      }),
    ).toBe(true);
    expect(
      attemptUsesProjectEnvironment({ capabilities: ["network.project"] }),
    ).toBe(false);
  });

  it("resynchronizes a writable artifact whenever it differs from the bound head", () => {
    const merged = "b".repeat(40);
    const run = {
      baseCommit: merged,
      currentHead: merged,
    };
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { capabilities: ["artifact.write"] },
        run,
      ),
    ).toBe(true);
    expect(
      artifactNeedsSync(
        { empty: false, head: merged },
        { capabilities: ["artifact.write"] },
        run,
      ),
    ).toBe(false);
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { capabilities: [] },
        run,
      ),
    ).toBe(false);
    expect(
      artifactNeedsSync(
        { empty: false, head: "a".repeat(40) },
        { capabilities: ["artifact.write"] },
        { ...run, candidateHead: "c".repeat(40) },
      ),
    ).toBe(true);
  });

  it("gives artifact write access only to attempts carrying that capability", () => {
    expect(
      attemptArtifactAccess({
        capabilities: ["artifact.write"],
        executor: "agent.write",
        role: "implement",
      }),
    ).toBe("write");
    expect(
      attemptArtifactAccess({
        capabilities: ["artifact.write"],
        executor: "validate",
        role: "integrate",
      }),
    ).toBe("write");
    expect(
      attemptArtifactAccess({
        capabilities: ["artifact.write"],
        executor: "validate",
        role: "conflict-resolution",
      }),
    ).toBe("write");
    expect(
      attemptArtifactAccess({
        capabilities: [],
        executor: "review",
        role: "review-integration",
      }),
    ).toBe("read");
    expect(
      attemptArtifactAccess({
        capabilities: [],
        executor: "validate",
        role: "validate",
      }),
    ).toBe("read");
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

  it("destroys an interrupted sandbox before reconciling its outcome", async () => {
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
      {
        async decide() {
          return "reconcile";
        },
        async resumeSettlement() {
          throw new Error("unexpected_settlement");
        },
        async reconcile(attemptId, next) {
          events.push(
            `reconcile:${attemptId}:${next.runId}:${next.expectedRevision}`,
          );
        },
        async diagnose(attemptId, next) {
          events.push(`diagnose:${attemptId}:${next.expectedRevision}`);
        },
        async trace(_attemptId, phase) {
          events.push(`trace:${phase}`);
        },
      },
    );
    expect(events).toEqual([
      "trace:recovery_started",
      "diagnose:run_1_rev_3:3",
      "trace:recovery_action_selected",
      "trace:sandbox_name_resolution_started",
      "trace:sandbox_name_resolution_completed",
      "trace:sandbox_destroy_started",
      "destroy:run_1_rev_3",
      "trace:sandbox_destroy_completed",
      "trace:execution_reconciliation_started",
      "reconcile:run_1_rev_3:run_1:3",
      "trace:execution_reconciliation_completed",
      "trace:recovery_completed",
    ]);
  });

  it("resumes settlement without destroying or redispatching an executed attempt", async () => {
    const events: string[] = [];
    const wakeup = {
      runId: "run_1",
      expectedRevision: 8,
      attemptId: "run_1_rev_8_review-security",
    };
    await recoverExpiredAttempts(
      {
        idFromName: (name: string) => name,
        get: () => ({
          destroy: async () => {
            events.push("destroy");
          },
        }),
      },
      [wakeup],
      {
        async decide(attemptId) {
          events.push(`decide:${attemptId}`);
          return "settle";
        },
        async resumeSettlement(attemptId, next, name) {
          events.push(`settle:${attemptId}:${next.expectedRevision}:${name}`);
        },
        async reconcile() {
          events.push("pause");
        },
        async resolveName() {
          return "review-sandbox";
        },
      },
    );
    expect(events).toEqual([
      "decide:run_1_rev_8_review-security",
      "settle:run_1_rev_8_review-security:8:review-sandbox",
    ]);
  });

  it("records interrupted execution for coordinator reconciliation", async () => {
    const events: string[] = [];
    const wakeup = { runId: "run_1", expectedRevision: 9 };
    await recoverExpiredAttempts(
      {
        idFromName: (name: string) => name,
        get: () => ({
          destroy: async () => {
            events.push("destroy");
          },
        }),
      },
      [wakeup],
      {
        async decide() {
          return "reconcile";
        },
        async resumeSettlement() {
          events.push("settle");
        },
        async reconcile(attemptId) {
          events.push(`reconcile:${attemptId}`);
        },
      },
    );
    expect(events).toEqual(["destroy", "reconcile:run_1_rev_9"]);
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
      "attempt_1",
      async (attemptId, phase, detail) => {
        events.push(
          `trace:${attemptId}:${phase}:${String(detail.sandboxName)}`,
        );
      },
    );
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(events).toEqual([
      "trace:attempt_1:sandbox_destroy_started:run_1_rev_4",
      "destroy:id:run_1_rev_4",
      "trace:attempt_1:sandbox_destroy_completed:run_1_rev_4",
    ]);
  });

  it("records failed normal sandbox destruction before surfacing it", async () => {
    const phases: string[] = [];
    const scheduled: Promise<unknown>[] = [];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    scheduleAttemptSandboxDestruction(
      {
        idFromName: (name: string) => name,
        get: () => ({
          destroy: async () => {
            throw new Error("container unavailable");
          },
          fetch: async () => new Response(),
        }),
      },
      "run_1",
      {
        waitUntil: (promise) => {
          scheduled.push(promise);
        },
      },
      "attempt_1",
      async (_attemptId, phase) => {
        phases.push(phase);
      },
    );

    await expect(Promise.all(scheduled)).rejects.toThrow(
      "container unavailable",
    );
    expect(phases).toEqual([
      "sandbox_destroy_started",
      "sandbox_destroy_failed",
    ]);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"phase":"sandbox_destroy_failed"'),
    );
    errorLog.mockRestore();
  });
});
