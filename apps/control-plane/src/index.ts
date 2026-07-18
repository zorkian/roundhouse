// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  runSchemaVersion,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import {
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
  validateReadOnlyCheckpoint,
} from "./artifacts.js";
import { coordinate, type AttemptDispatcher } from "./coordinator.js";
import {
  acceptCallback,
  signCallback,
  type AttemptCallback,
  type CheckpointValidator,
} from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import {
  acceptGitHubComment,
  GitHubClient,
  GitHubStageReporter,
} from "./github.js";
export { ContainerProxy } from "@cloudflare/containers";
export { RoundhouseAttemptContainer } from "./attempt-container.js";

export const controlPlaneService = "roundhouse-v2-control-plane";
const protectedPaths = [".github/workflows"] as const;

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    if (request.method !== "GET")
      return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
    return json({
      schemaVersion: runSchemaVersion,
      ok: true,
      service: controlPlaneService,
    });
  }
  return json({ error: "not_found" }, 404);
}

export function successorWakeup(
  run: RunSnapshot | undefined,
  processed: Wakeup,
): Wakeup | undefined {
  return run?.status === "active" &&
    new Set(["reproduce", "plan", "implement"]).has(run.stage) &&
    run.revision === processed.expectedRevision + 1
    ? { runId: run.id, expectedRevision: run.revision }
    : undefined;
}

interface AttemptStub {
  fetch(request: Request): Promise<Response>;
}
interface AttemptNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): AttemptStub;
}
type RuntimeEnv = Cloudflare.Env & {
  DB: D1Like;
  CALLBACK_SIGNING_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_INSTALLATION_ID: string;
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: string;
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: string;
};

function artifactsNamespace(env: RuntimeEnv) {
  return new CloudflareArtifactsNamespace(env.ARTIFACTS, {
    namespace: env.ARTIFACTS_NAMESPACE,
    remoteOrigin: env.ARTIFACTS_REMOTE_ORIGIN,
  });
}

function workspaceName(runId: string): string {
  return runId;
}
function workspaceRef(runId: string): string {
  return `refs/heads/roundhouse/${runId}`;
}
export function githubBranch(issueNumber: number): string {
  return `roundhouse/issue-${issueNumber}`;
}

class ContainerDispatcher implements AttemptDispatcher {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly callbackSigningSecret: string,
    private readonly controlPlaneOrigin: string,
    private readonly runs: D1RunRepository,
  ) {}

  async submit(attempt: Attempt, run: RunSnapshot): Promise<void> {
    const repository = await this.artifacts.importBase(
      workspaceName(attempt.runId),
      `https://github.com/${run.repository}.git`,
    );
    // Recovery invalidates every token from an interrupted container before a
    // replacement receives a fresh, short-lived credential.
    await repository.revokeActiveTokens();
    const access = attempt.stage === "implement" ? "write" : "read";
    const token = await repository.createToken(access, 30 * 60);
    const id = this.containers.idFromName(attempt.id);
    const attemptSecret = await signCallback(
      this.callbackSigningSecret,
      attempt.id,
    );
    const qualificationAttempt = ["reproduce", "plan", "implement"].includes(
      attempt.stage,
    )
      ? await this.runs.latestCompletedAttempt(run.id, "qualify", run.revision)
      : undefined;
    const reproductionAttempt =
      attempt.stage === "plan" || attempt.stage === "implement"
        ? await this.runs.latestCompletedAttempt(
            run.id,
            "reproduce",
            run.revision,
          )
        : undefined;
    const planAttempt =
      attempt.stage === "implement"
        ? await this.runs.latestCompletedAttempt(run.id, "plan", run.revision)
        : undefined;
    const qualification = qualificationAttempt?.result?.qualification;
    const reproduction = reproductionAttempt?.result?.reproduction;
    const plan = planAttempt?.result?.plan;
    if (attempt.stage === "reproduce" && !qualification)
      throw new Error("reproduction_qualification_missing");
    if (attempt.stage === "plan" && !reproduction)
      throw new Error("planning_reproduction_missing");
    if (attempt.stage === "implement" && !plan)
      throw new Error("implementation_plan_missing");
    const routingRule =
      attempt.stage === "reproduce"
        ? "reproduction-default-v1"
        : attempt.stage === "plan"
          ? "planning-default-v1"
          : attempt.stage === "implement"
            ? "implementation-default-v1"
            : "qualification-default-v1";
    const taskType =
      attempt.stage === "plan"
        ? "planning"
        : attempt.stage === "implement"
          ? "implementation"
          : "validation";
    const assignment = {
      ...attempt,
      baseCommit: attempt.baseCommit,
      protectedPaths,
      issue: run.issue,
      issueNumber: run.issueNumber,
      context:
        qualification || reproduction || plan
          ? {
              ...(qualification ? { qualification } : {}),
              ...(reproduction ? { reproduction } : {}),
              ...(plan ? { plan } : {}),
            }
          : undefined,
      routing: {
        role: attempt.role,
        taskType,
        complexity: "unknown",
        rule: routingRule,
      },
      artifact: {
        repositoryId: repository.id,
        repository: repository.name,
        remote: repository.remote,
        hostname: repository.hostname,
        tokenId: token.id,
        token: token.plaintext,
        access: token.access,
        ref: workspaceRef(attempt.runId),
      },
    };
    try {
      const response = await this.containers.get(id).fetch(
        new Request("https://attempt.invalid/assign", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-roundhouse-attempt-secret": attemptSecret,
            "x-roundhouse-callback-url": new URL(
              "/attempts/callback",
              this.controlPlaneOrigin,
            ).toString(),
          },
          body: JSON.stringify(assignment),
        }),
      );
      if (response.status !== 202) throw new Error("container_dispatch_failed");
    } catch (error) {
      await repository.revokeToken(token.id);
      throw error;
    }
  }
}

class ContainerCheckpointValidator implements CheckpointValidator {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly repository: D1RunRepository,
    private readonly github: GitHubClient,
  ) {}

  async validate(input: AttemptCallback): Promise<void> {
    const attempt = await this.repository.getAttempt(input.attemptId);
    const run = attempt && (await this.repository.get(attempt.runId));
    if (!attempt || !run) throw new Error("attempt_not_found");
    const artifact = await this.artifacts.get(input.checkpoint.repository);
    if (!artifact) throw new Error("artifact_repository_not_found");
    validateCheckpointIdentity(input.checkpoint, {
      repositoryId: artifact.id,
      repository: workspaceName(run.id),
      baseCommit: run.baseCommit,
      inputHead: attempt.expectedHead,
      ref: workspaceRef(run.id),
      protectedPaths,
    });
    if (attempt.stage !== "implement") {
      try {
        validateReadOnlyCheckpoint(input.checkpoint);
      } finally {
        await artifact.revokeToken(input.artifactTokenId);
      }
      return;
    }
    const token = await artifact.createToken("read", 5 * 60);
    try {
      const response = await this.containers
        .get(this.containers.idFromName(`${attempt.id}-validation`))
        .fetch(
          new Request("https://attempt.invalid/validate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...attempt,
              baseCommit: run.baseCommit,
              protectedPaths,
              checkpoint: input.checkpoint,
              artifact: {
                repositoryId: artifact.id,
                repository: artifact.name,
                remote: artifact.remote,
                hostname: artifact.hostname,
                tokenId: token.id,
                token: token.plaintext,
                access: token.access,
                ref: input.checkpoint.ref,
              },
              publish: {
                remote: `https://github.com/${run.repository}.git`,
                hostname: "github.com",
                token: await this.github.installationToken(),
                ref: `refs/heads/${githubBranch(run.issueNumber)}`,
              },
            }),
          }),
        );
      if (!response.ok) throw new Error("checkpoint_git_validation_failed");
    } finally {
      await Promise.all([
        artifact.revokeToken(token.id),
        artifact.revokeToken(input.artifactTokenId),
      ]);
    }
  }
}

const worker: ExportedHandler<RuntimeEnv, Wakeup> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/github/webhook" && request.method === "POST") {
      const outcome = await acceptGitHubComment(
        request,
        env,
        new D1RunRepository(env.DB),
        async (wakeup) => {
          await env.RUN_WAKEUPS.send(wakeup);
        },
      );
      return json(
        { outcome },
        outcome === "unauthorized" ? 401 : outcome === "ignored" ? 202 : 202,
      );
    }
    if (url.pathname === "/attempts/callback" && request.method === "POST") {
      const input = await request.json<AttemptCallback>();
      const repository = new D1RunRepository(env.DB);
      const artifacts = artifactsNamespace(env);
      const outcome = await acceptCallback(
        repository,
        await signCallback(env.CALLBACK_SIGNING_SECRET, input.attemptId),
        new ContainerCheckpointValidator(
          env.ATTEMPT_CONTAINERS,
          artifacts,
          repository,
          new GitHubClient(env),
        ),
        input,
      );
      if (outcome === "completed" || outcome === "duplicate") {
        const attempt = await repository.getAttempt(input.attemptId);
        if (attempt)
          await env.RUN_WAKEUPS.send({
            runId: attempt.runId,
            expectedRevision: attempt.runRevision,
          });
      }
      return json(
        { outcome },
        outcome === "unauthorized" ? 401 : outcome === "stale" ? 409 : 202,
      );
    }
    return handleRequest(request);
  },
  async queue(batch, env) {
    const repository = new D1RunRepository(env.DB);
    const dispatcher = new ContainerDispatcher(
      env.ATTEMPT_CONTAINERS,
      artifactsNamespace(env),
      env.CALLBACK_SIGNING_SECRET,
      env.CONTROL_PLANE_ORIGIN,
      repository,
    );
    for (const message of batch.messages) {
      try {
        await coordinate(
          repository,
          dispatcher,
          message.body,
          Date.now(),
          30 * 60_000,
          new GitHubStageReporter(new GitHubClient(env)),
        );
        const next = successorWakeup(
          await repository.get(message.body.runId),
          message.body,
        );
        if (next) await env.RUN_WAKEUPS.send(next);
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "coordination_failed",
            runId: message.body.runId,
            expectedRevision: message.body.expectedRevision,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        message.retry();
      }
    }
  },
  async scheduled(_controller, env) {
    const repository = new D1RunRepository(env.DB);
    for (const wakeup of await repository.expiredLeases(Date.now()))
      await env.RUN_WAKEUPS.send(wakeup);
  },
};

export default worker;
