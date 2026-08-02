// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  createRun,
  defaultIssueWorkflowSource,
  MemoryRunRepository,
  type Attempt,
  type RunSnapshot,
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
  RoundhouseRuntimeSandbox,
} from "./attempt-container.js";
import {
  artifactNeedsSync,
  attemptArtifactAccess,
  attemptContext,
  handleRequest,
  recoverExpiredAttempts,
  resolveWorkflowAgentInputs,
  sandboxPreviewPath,
  scheduleAttemptSandboxDestruction,
  successorWakeup,
  validAttemptProgress,
} from "./index.js";
import { signCallback, type AttemptCompletion } from "./callback.js";
import { ciDiagnosticsNotice } from "./github-ci.js";
import { GitHubClient } from "./github.js";
import worker from "./index.js";
import type { D1Like } from "./d1-store.js";

const workflowCommit = "a".repeat(40);
const workflow = await compileWorkflow(
  defaultIssueWorkflowSource,
  workflowCommit,
);
const workflowProfile = {
  sourcePath: ".roundhouse/profile.yaml" as const,
  sourceCommit: workflowCommit,
  version: 1 as const,
  hash: "profile",
  workflow,
  paths: { allowed: ["**"], protected: [] },
};
const staleWorkflow = await compileWorkflow(
  `version: 1
triggers:
  github.issue.started: legacy
nodes:
  legacy:
    executor: terminal
    role: legacy
    transitions:
      - terminal: succeeded
`,
  workflowCommit,
);

function workflowRun(
  id: string,
  issueNumber: number,
  title: string,
  body: string,
): RunSnapshot {
  return createRun({
    id,
    repository: "zorkian/roundhouse",
    issueNumber,
    baseCommit: workflowCommit,
    profileVersion: workflowProfile.hash,
    profile: workflowProfile,
    issue: {
      title,
      body,
      url: `https://github.test/issues/${issueNumber}`,
      actor: "maintainer",
    },
  });
}

function seedPreImplementationResults(
  repository: MemoryRunRepository,
  run: RunSnapshot,
  classification: "bug" | "feature",
) {
  for (const [revision, nodeId, stage, key, value] of [
    [1, "qualify", "qualify", "qualification", { classification }],
    [2, "investigate", "reproduce", "reproduction", { status: "confirmed" }],
    [3, "plan", "plan", "plan", { status: "ready" }],
  ] as const) {
    repository.attempts.set(`attempt_${nodeId}`, {
      id: `attempt_${nodeId}`,
      runId: run.id,
      runRevision: revision,
      kind: "agent",
      nodeId,
      executor: "agent.read",
      stage,
      role: nodeId,
      state: "completed",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: { [key]: value },
    });
  }
}

function detailsDb(found = true): D1Like {
  // Multi-repository enrollment stores the numeric GitHub repository ID in
  // github_id and keeps the owner/name in the profile metadata, so the stub
  // only matches when the query looks the name up in that metadata.
  const enrolledGithubId = "1297678423";
  const enrolledRepository = "zorkian/roundhouse";
  const enrolledIssueNumber = 281;
  return {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
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
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
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

function workflowPageDb(): D1Like {
  const run = createRun({
    id: "run_stale_workflow",
    repository: "zorkian/roundhouse",
    githubRepositoryId: 1297678423,
    githubInstallationId: 456,
    githubDefaultBranch: "main",
    issueNumber: 281,
    baseCommit: workflowCommit,
    profileVersion: "stale-profile",
    profile: {
      sourcePath: ".roundhouse/profile.yaml",
      sourceCommit: workflowCommit,
      version: 2,
      hash: "stale-profile",
      workflow: staleWorkflow,
      paths: { allowed: ["**"], protected: [] },
    },
  });
  return {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        first: async () => {
          if (sql.includes("SELECT r.id FROM repositories"))
            return values.includes("1297678423") ? { id: run.id } : null;
          if (sql === "SELECT document_json FROM runs WHERE id = ?1")
            return values[0] === run.id
              ? { document_json: JSON.stringify(run) }
              : null;
          if (sql.includes("SELECT r.document_json,r.created_at,r.updated_at"))
            return values.includes("zorkian/roundhouse") &&
              values.includes(281) &&
              values.includes("1297678423")
              ? {
                  document_json: JSON.stringify(run),
                  created_at: 1,
                  updated_at: 2,
                }
              : null;
          return null;
        },
        run: async () => ({ meta: {} }),
        all: async () => ({ meta: {}, results: [] }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
}

function completionDb() {
  let state = "dispatched";
  let completion: string | null = null;
  const events: Array<{ kind: string; payload: string }> = [];
  const DB: D1Like = {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        first: async () => {
          if (sql.startsWith("SELECT id,run_id,run_revision"))
            return {
              id: "attempt_completion",
              run_id: "run_1",
              run_revision: 3,
              kind: "agent",
              node_id: "implement",
              executor: "agent.write",
              stage: "implement",
              role: "implement",
              state,
              deadline_at: Date.now() + 60_000,
              base_commit: "a".repeat(40),
              expected_head: "a".repeat(40),
              accepted_head: null,
              result_json: null,
              routing_json: null,
              capabilities_json: '["artifact.write"]',
              outcome_json: null,
            };
          if (sql === "SELECT completion_json FROM attempts WHERE id=?1")
            return { completion_json: completion };
          return null;
        },
        run: async () => {
          if (sql.startsWith("UPDATE attempts SET state='executed'")) {
            if (state !== "dispatched") return { meta: { changes: 0 } };
            completion = String(values[0]);
            state = "executed";
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO events")) {
            events.push({
              kind: String(values[0]),
              payload: String(values[1]),
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        all: async () => ({ meta: {}, results: [] }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
  return {
    DB,
    events,
    completion: () => completion,
    state: () => state,
  };
}

const uiEnv = (DB: D1Like) => ({
  DB,
  PUBLIC_ORIGIN: "https://v2.invalid",
  CONTROL_PLANE_ORIGIN: "https://direct-worker.invalid",
  GITHUB_APP_ID: "development-app",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_START_COMMAND: "/roundhouse-dev start",
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: "not-used-by-mocked-client",
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "not-used",
  ROUNDHOUSE_GITHUB_CLIENT_SECRET: "client-secret",
});

const authedUiCookie = "roundhouse_ui_session=test-session";

// Extends a UI database stub with one valid, unexpired browser session.
// Pass `renewals` to record the expires_at values written by session renewal.
function withUiSession(
  DB: D1Like,
  repositoryIds = '["1297678423"]',
  renewals?: number[],
): D1Like {
  return {
    batch: DB.batch.bind(DB),
    prepare(sql: string) {
      if (sql.includes("FROM ui_sessions")) {
        let values: unknown[] = [];
        const statement = {
          bind: (...bound: unknown[]) => {
            values = bound;
            return statement;
          },
          first: async () => ({
            github_user_id: 7,
            github_login: "octocat",
            repository_ids_json: repositoryIds,
            expires_at: Date.now() + 60_000,
            created_at: Date.now(),
          }),
          run: async () => {
            if (sql.includes("UPDATE ui_sessions SET expires_at"))
              renewals?.push(Number(values[0]));
            return { meta: {} };
          },
          all: async () => ({ meta: {}, results: [] }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      }
      if (sql.includes("UPDATE ui_sessions SET expires_at")) {
        let values: unknown[] = [];
        const statement = {
          bind: (...bound: unknown[]) => {
            values = bound;
            return statement;
          },
          // Mirrors UPDATE ... RETURNING: no concurrent writes in these
          // tests, so the proposed expiration is the persisted one.
          first: async () => {
            renewals?.push(Number(values[0]));
            return { expires_at: Number(values[0]) };
          },
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
  it("records runner completion in D1 before the Sandbox RPC can return", async () => {
    const durable = completionDb();
    const secret = "control-plane-secret";
    const completion: AttemptCompletion = {
      attemptId: "attempt_completion",
      expectedRevision: 3,
      checkpoint: {
        repositoryId: "repository-id",
        repository: "run_1",
        baseCommit: "a".repeat(40),
        inputHead: "a".repeat(40),
        outputHead: "b".repeat(40),
        ref: "refs/heads/roundhouse/run_1",
        changedPaths: ["src/fix.ts"],
      },
      artifactTokenId: "token-id",
      result: { outcome: "ok" },
    };
    const capability = await signCallback(secret, completion.attemptId);
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const request = () =>
      new Request("https://direct-worker.invalid/attempts/completion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-roundhouse-attempt-id": completion.attemptId,
          "x-roundhouse-attempt-capability": capability,
        },
        body: JSON.stringify(completion),
      });
    const env = {
      DB: durable.DB,
      CALLBACK_SIGNING_SECRET: secret,
      PUBLIC_ORIGIN: "https://v2.invalid",
      CONTROL_PLANE_ORIGIN: "https://direct-worker.invalid",
    };

    const recorded = await fetch(request(), env, {});
    expect(recorded.status).toBe(200);
    await expect(recorded.json()).resolves.toEqual({ outcome: "recorded" });
    expect(durable.state()).toBe("executed");
    expect(JSON.parse(durable.completion()!)).toEqual(completion);

    const duplicate = await fetch(request(), env, {});
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ outcome: "duplicate" });
    expect(durable.events.map(({ kind }) => kind)).toEqual([
      "attempt_execution_recorded",
      "attempt_execution_recorded",
    ]);
  });

  it("prepares a private assignment before its workflow restores the workspace", async () => {
    let finishRestore!: () => void;
    const restoring = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    const storage = new Map<string, unknown>();
    const phases: string[] = [];
    const sandbox = Object.create(
      RoundhouseRuntimeSandbox.prototype,
    ) as RoundhouseRuntimeSandbox & Record<string, unknown>;
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
          checkpoint: {
            repositoryId: "repository-id",
            repository: "run_1",
            baseCommit: "a".repeat(40),
            inputHead: "a".repeat(40),
            outputHead: "b".repeat(40),
            ref: "refs/heads/roundhouse/run_1",
            changedPaths: ["src/fix.ts"],
          },
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
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
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

    const renewals: number[] = [];
    const response = await fetch(
      new Request("https://v2.invalid/", {
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb(), '["1297678423"]', renewals)) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    // Valid activity renews the session: the stored expiration extends to at
    // least 30 days out and the response carries a matching renewed cookie.
    expect(renewals).toHaveLength(1);
    expect(renewals[0]! - Date.now()).toBeGreaterThanOrEqual(
      30 * 24 * 60 * 60 * 1000 - 60_000,
    );
    const renewedCookie = response.headers.get("set-cookie")!;
    expect(renewedCookie).toContain("roundhouse_ui_session=test-session");
    expect(renewedCookie).toContain("HttpOnly");
    expect(renewedCookie).toContain("Secure");
    const renewedMaxAge = Number(renewedCookie.match(/Max-Age=(\d+)/)![1]);
    expect(renewedMaxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
    expect(renewals[0]!).toBeLessThanOrEqual(
      Date.now() + (renewedMaxAge + 1) * 1000,
    );
    // The cookie's absolute Expires deadline equals the persisted expiration.
    expect(renewedCookie).toContain(
      `Expires=${new Date(renewals[0]!).toUTCString()}`,
    );
    // The signed-out fallback does not set a renewed session cookie.
    expect(signedOut.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    const body = await response.text();
    expect(body).toContain("Development runs across enrolled repositories");
    expect(body).toContain('<a href="/usage">Model usage</a>');
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

  it("serves the model usage page only to signed-in users", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const signedOut = await fetch(
      new Request("https://v2.invalid/usage"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(signedOut.status).toBe(200);
    await expect(signedOut.text()).resolves.toContain("Sign in with GitHub");

    const renewals: number[] = [];
    const post = await fetch(
      new Request("https://v2.invalid/usage", {
        method: "POST",
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb(), '["1297678423"]', renewals)) as never,
      {} as never,
    );
    expect(post.status).toBe(405);
    // The session was renewed during authorization, so even this error
    // response carries a matching renewed cookie.
    expect(renewals).toHaveLength(1);
    const errorCookie = post.headers.get("set-cookie")!;
    expect(errorCookie).toContain("roundhouse_ui_session=test-session");
    const errorMaxAge = Number(errorCookie.match(/Max-Age=(\d+)/)![1]);
    expect(errorMaxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
    expect(renewals[0]!).toBeLessThanOrEqual(
      Date.now() + (errorMaxAge + 1) * 1000,
    );
    expect(errorCookie).toContain(
      `Expires=${new Date(renewals[0]!).toUTCString()}`,
    );

    const response = await fetch(
      new Request("https://v2.invalid/usage", {
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb())) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const body = await response.text();
    expect(body).toContain("Model usage");
    expect(body).toContain("Rolling 30-day window");
    expect(body).toContain("No model usage was recorded in this 30-day window");

    const directOrigin = await fetch(
      new Request("https://direct-worker.invalid/usage", {
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb())) as never,
      {} as never,
    );
    expect(directOrigin.status).toBe(404);
  });

  it("protects the conversation UI and requires same-origin mutations", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const signedOut = await fetch(
      new Request("https://v2.invalid/conversations"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    await expect(signedOut.text()).resolves.toContain("Sign in with GitHub");

    const authorizedEnv = uiEnv(withUiSession(dashboardDb()));
    const page = await fetch(
      new Request("https://v2.invalid/conversations", {
        headers: { cookie: authedUiCookie },
      }),
      authorizedEnv as never,
      {} as never,
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain(
      "form-action 'self'",
    );
    // Form POSTs are non-cors; referrer-policy: no-referrer would null the
    // Origin header and make every logged-in conversation start return 403.
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    await expect(page.text()).resolves.toContain("Start with a conversation");

    const crossOrigin = await fetch(
      new Request("https://v2.invalid/conversations", {
        method: "POST",
        headers: {
          cookie: authedUiCookie,
          origin: "https://attacker.invalid",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "repository=repo_1&message=build+it",
      }),
      authorizedEnv as never,
      {} as never,
    );
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toEqual({ error: "forbidden" });

    const nullOrigin = await fetch(
      new Request("https://v2.invalid/conversations", {
        method: "POST",
        headers: {
          cookie: authedUiCookie,
          origin: "null",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "repository=repo_1&message=build+it&message_id=00000000-0000-4000-8000-000000000001",
      }),
      authorizedEnv as never,
      {} as never,
    );
    expect(nullOrigin.status).toBe(403);
    await expect(nullOrigin.json()).resolves.toEqual({ error: "forbidden" });

    const sameOrigin = await fetch(
      new Request("https://v2.invalid/conversations", {
        method: "POST",
        headers: {
          cookie: authedUiCookie,
          origin: "https://v2.invalid",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "repository=repo_1&message=build+it",
      }),
      authorizedEnv as never,
      {} as never,
    );
    // Same-origin clears the CSRF gate; missing message_id fails validation.
    expect(sameOrigin.status).toBe(400);
    await expect(sameOrigin.json()).resolves.toEqual({
      error: "invalid_request",
    });

    const dashboard = await fetch(
      new Request("https://v2.invalid/", {
        headers: { cookie: authedUiCookie },
      }),
      authorizedEnv as never,
      {} as never,
    );
    expect(dashboard.headers.get("content-security-policy")).toContain(
      "form-action 'none'",
    );
    expect(dashboard.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("serves the workflow graph asset from the public UI origin", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const asset = await fetch(
      new Request("https://v2.invalid/assets/workflow-graph.js"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(asset.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(asset.text()).resolves.toContain("workflow_graph_initialized");

    const post = await fetch(
      new Request("https://v2.invalid/assets/workflow-graph.js", {
        method: "POST",
      }),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(post.status).toBe(405);

    const directOrigin = await fetch(
      new Request("https://direct-worker.invalid/assets/workflow-graph.js"),
      uiEnv(dashboardDb()) as never,
      {} as never,
    );
    expect(directOrigin.status).toBe(404);
  });

  it("serves the current default-branch workflow instead of the latest run snapshot", async () => {
    const currentCommit = "b".repeat(40);
    const get = vi
      .spyOn(GitHubClient.prototype, "get")
      .mockImplementation(async (path: string) => {
        if (path === "/repos/zorkian/roundhouse")
          return { default_branch: "main" } as never;
        if (path.endsWith("/commits/main"))
          return { sha: currentCommit } as never;
        if (path.includes("/contents/.roundhouse/profile.yaml?ref="))
          return {
            name: "profile.yaml",
            type: "file",
            encoding: "base64",
            content: btoa(
              'version: 1\npaths:\n  allowed:\n    - "**"\n  protected: []\n',
            ),
          } as never;
        throw new Error(`unexpected_github_path:${path}`);
      });
    try {
      const fetch = worker.fetch as unknown as (
        request: Request,
        env: unknown,
        context: unknown,
      ) => Promise<Response>;
      const response = await fetch(
        new Request(
          "https://v2.invalid/repositories/zorkian/roundhouse/workflow",
          { headers: { cookie: authedUiCookie } },
        ),
        uiEnv(withUiSession(workflowPageDb())) as never,
        {} as never,
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(
        "workflow currently on the repository’s <code>main</code> branch",
      );
      expect(body).toContain(currentCommit);
      expect(body).toContain('data-stage="approval"');
      expect(body).not.toContain('data-stage="legacy"');
    } finally {
      get.mockRestore();
    }
  });

  it("serves the immutable workflow snapshot linked from a run", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const response = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281/workflow",
        { headers: { cookie: authedUiCookie } },
      ),
      uiEnv(withUiSession(workflowPageDb())) as never,
      {} as never,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("immutable workflow snapshot attached to this run");
    expect(body).toContain('data-stage="legacy"');
    expect(body).not.toContain('data-stage="approval"');
    expect(body).toContain("run_stale_workflow revision 1");
  });

  it("allows same-origin scripts on UI pages", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const response = await fetch(
      new Request("https://v2.invalid/", {
        headers: { cookie: authedUiCookie },
      }),
      uiEnv(withUiSession(dashboardDb())) as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
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

  it("reconciles one immediate successor revision", () => {
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
      RoundhouseRuntimeSandbox.outboundByHost?.["model.roundhouse.internal"],
    ).toBeTypeOf("function");
  });

  it("resolves typed workflow inputs from exact durable node results", async () => {
    const repository = new MemoryRunRepository();
    const initial = workflowRun(
      "run_inputs",
      1,
      "Typed inputs",
      "Use durable evidence",
    );
    seedPreImplementationResults(repository, initial, "bug");
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
    const initial = workflowRun(
      "run_joined_review_inputs",
      414,
      "Joined reviews",
      "Preserve every selected finding.",
    );
    seedPreImplementationResults(repository, initial, "feature");
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
    const initial = workflowRun(
      "run_cumulative_implementation_evidence",
      414,
      "Preserve visual evidence",
      "Keep valid screenshots through review fix passes.",
    );
    seedPreImplementationResults(repository, initial, "feature");
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

  describe("competition source resolution", () => {
    const competitionModels = `candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: anthropic/claude-beta, reasoning: medium }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }`;
    const planCompetitionWorkflow = defaultIssueWorkflowSource.replace(
      "        key: plan\n        schema: roundhouse.plan.v1\n      model: { id: openai/gpt-5.6-sol, reasoning: max }",
      `        key: plan\n        schema: roundhouse.plan.v1\n      competition:\n        ${competitionModels}`,
    );
    const reviewCompetitionWorkflow = defaultIssueWorkflowSource.replace(
      "        - id: review-security\n          label: Security review\n          activation: selected\n          selected_by: review-holistic\n          mode: blocking\n          blocking_severities: [critical, high, medium]\n          model: { id: moonshotai/kimi-k3, reasoning: max }",
      `        - id: review-security\n          label: Security review\n          activation: selected\n          selected_by: review-holistic\n          mode: blocking\n          blocking_severities: [critical, high, medium]\n          competition:\n            candidates:\n              - id: alpha\n                model: { id: openai/gpt-alpha, reasoning: low }\n              - id: beta\n                model: { id: anthropic/claude-beta, reasoning: medium }\n            judge:\n              model: { id: openai/gpt-judge, reasoning: high }`,
    );

    const competitionProfile = async (source: string) => {
      const compiled = await compileWorkflow(source, workflowCommit);
      return {
        sourcePath: ".roundhouse/profile.yaml" as const,
        sourceCommit: workflowCommit,
        version: 1 as const,
        hash: "profile-competition",
        workflow: compiled,
        paths: { allowed: ["**"], protected: [] },
      };
    };

    const competitionAttempt = (
      run: RunSnapshot,
      overrides: Partial<Attempt> & { id: string },
    ): Attempt => ({
      runId: run.id,
      runRevision: 3,
      kind: "agent",
      executor: "agent.read",
      stage: "plan",
      role: "plan",
      state: "completed",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      ...overrides,
    });

    const judgement = {
      selected: "beta",
      scores: [
        { candidateId: "alpha", score: 0.4, rationale: "Weaker." },
        { candidateId: "beta", score: 0.9, rationale: "Stronger." },
      ],
    };

    const implementAttempt = (run: RunSnapshot): Attempt => ({
      id: "attempt_implement_consumer",
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
    });

    it("resolves ordinary selectors to the selected competition attempt only", async () => {
      const profile = await competitionProfile(planCompetitionWorkflow);
      expect(profile.workflow.nodes.plan?.agent?.competition).toBeDefined();
      const repository = new MemoryRunRepository();
      const initial = {
        ...workflowRun("run_competition_plan", 434, "Compete", "Judge plans."),
        profile,
      };
      seedPreImplementationResults(repository, initial, "feature");
      repository.attempts.delete("attempt_plan");
      for (const attempt of [
        competitionAttempt(initial, {
          id: "attempt_plan_candidate_alpha",
          nodeId: "plan",
          role: "plan-candidate-alpha",
          competition: { purpose: "candidate", candidateId: "alpha" },
          result: { plan: { status: "ready", summary: "loser alpha" } },
        }),
        competitionAttempt(initial, {
          id: "attempt_plan_candidate_beta",
          nodeId: "plan",
          role: "plan-candidate-beta",
          competition: { purpose: "candidate", candidateId: "beta" },
          result: { plan: { status: "ready", summary: "winner beta" } },
        }),
        competitionAttempt(initial, {
          id: "attempt_plan_judge",
          nodeId: "plan",
          role: "plan-judge",
          competition: { purpose: "judge" },
          result: { judgement },
        }),
        competitionAttempt(initial, {
          id: "attempt_plan_selected",
          nodeId: "plan",
          role: "plan",
          competition: {
            purpose: "selected",
            candidateId: "beta",
            judgement,
          },
          result: { plan: { status: "ready", summary: "winner beta" } },
        }),
      ])
        repository.attempts.set(attempt.id, attempt);
      const run = {
        ...initial,
        revision: 4,
        stage: "implement" as const,
        currentNodeId: "implement",
      };

      const resolved = await resolveWorkflowAgentInputs(
        repository,
        run,
        implementAttempt(run),
        profile.workflow.nodes.implement!.agent!,
      );

      expect(resolved.values.plan).toEqual({
        status: "ready",
        summary: "winner beta",
      });
      expect(resolved.evidence.plan).toMatchObject({
        present: true,
        sourceAttemptId: "attempt_plan_selected",
      });
    });

    it("excludes competition candidates and judges from implementation evidence", async () => {
      const repository = new MemoryRunRepository();
      const initial = workflowRun(
        "run_competition_implementation",
        434,
        "Compete implementations",
        "Judge implementations.",
      );
      seedPreImplementationResults(repository, initial, "feature");
      const implementation = (
        id: string,
        summary: string,
        competition?: Attempt["competition"],
        screenshots: readonly Readonly<Record<string, unknown>>[] = [],
      ): Attempt => ({
        id,
        runId: initial.id,
        runRevision: 4,
        kind: "agent",
        nodeId: "implement",
        executor: "agent.write",
        stage: "implement",
        role: "implement",
        state: "completed",
        deadlineAt: 1,
        baseCommit: initial.baseCommit,
        expectedHead: initial.currentHead,
        acceptedHead: initial.currentHead,
        ...(competition ? { competition } : {}),
        result: { implementation: { summary, validation: [], screenshots } },
      });
      const candidateAlpha = implementation(
        "attempt_implement_candidate_alpha",
        "loser alpha",
        { purpose: "candidate", candidateId: "alpha" },
        [{ url: "https://example.test/loser", description: "Loser shot" }],
      );
      const candidateBeta = implementation(
        "attempt_implement_candidate_beta",
        "winner beta",
        { purpose: "candidate", candidateId: "beta" },
        [{ url: "https://example.test/winner", description: "Winner shot" }],
      );
      const judge = implementation("attempt_implement_judge", "judge", {
        purpose: "judge",
      });
      const selected = implementation(
        "attempt_implement_selected",
        "winner beta",
        { purpose: "selected", candidateId: "beta", judgement },
        [{ url: "https://example.test/winner", description: "Winner shot" }],
      );
      for (const attempt of [candidateAlpha, candidateBeta, judge, selected])
        repository.attempts.set(attempt.id, attempt);
      const run = {
        ...initial,
        revision: 5,
        stage: "implement" as const,
        currentNodeId: "implement",
      };

      const resolved = await resolveWorkflowAgentInputs(
        repository,
        run,
        implementAttempt(run),
        workflow.nodes.implement!.agent!,
      );

      expect(resolved.values.implementation).toEqual({
        summary: "winner beta",
        validation: [],
        screenshots: [
          { url: "https://example.test/winner", description: "Winner shot" },
        ],
      });
      expect(resolved.evidence.implementation).toMatchObject({
        present: true,
        sourceAttemptId: "attempt_implement_selected",
      });
    });

    it("aggregates review inputs from the selected competition reviewer only", async () => {
      const profile = await competitionProfile(reviewCompetitionWorkflow);
      expect(
        profile.workflow.nodes.review?.review?.reviewers.find(
          (reviewer) => reviewer.id === "review-security",
        )?.competition,
      ).toBeDefined();
      const repository = new MemoryRunRepository();
      const initial = {
        ...workflowRun(
          "run_competition_review",
          434,
          "Compete reviews",
          "Judge reviews.",
        ),
        profile,
      };
      seedPreImplementationResults(repository, initial, "feature");
      const review = (
        id: string,
        role: string,
        finding: string,
        competition?: Attempt["competition"],
      ): Attempt => ({
        id,
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
        ...(competition ? { competition } : {}),
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
      const holistic = review(
        "attempt_review_holistic",
        "review-holistic",
        "Holistic finding",
      );
      const loser = review(
        "attempt_review_security_candidate_alpha",
        "review-security-candidate-alpha",
        "Losing security finding",
        { purpose: "candidate", candidateId: "alpha" },
      );
      const winner = review(
        "attempt_review_security_candidate_beta",
        "review-security-candidate-beta",
        "Winning security finding",
        { purpose: "candidate", candidateId: "beta" },
      );
      const judge = review(
        "attempt_review_security_judge",
        "review-security-judge",
        "Judge output",
        { purpose: "judge" },
      );
      const selected = review(
        "attempt_review_security_selected",
        "review-security",
        "Winning security finding",
        { purpose: "selected", candidateId: "beta", judgement },
      );
      for (const attempt of [holistic, loser, winner, judge, selected])
        repository.attempts.set(attempt.id, attempt);
      const run = {
        ...initial,
        revision: 5,
        stage: "implement" as const,
        currentNodeId: "implement",
      };

      const resolved = await resolveWorkflowAgentInputs(
        repository,
        run,
        implementAttempt(run),
        profile.workflow.nodes.implement!.agent!,
      );

      expect(
        (
          resolved.values.review as { findings: readonly { title: string }[] }
        ).findings.map(({ title }) => title),
      ).toEqual(["Holistic finding", "Winning security finding"]);
      expect(resolved.evidence.review).toMatchObject({
        present: true,
        sourceAttemptIds: [
          "attempt_review_holistic",
          "attempt_review_security_selected",
        ],
      });
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
