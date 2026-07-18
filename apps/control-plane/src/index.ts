// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { runSchemaVersion, type Attempt, type Wakeup } from "@roundhouse/core";
import {
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
} from "./artifacts.js";
import { coordinate, type AttemptDispatcher } from "./coordinator.js";
import {
  acceptCallbackAndAdvance,
  signCallback,
  type AttemptCallback,
  type CheckpointValidator,
} from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
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
};

function workspaceName(runId: string): string {
  return runId;
}
function workspaceRef(runId: string): string {
  return `refs/heads/roundhouse/${runId}`;
}

class ContainerDispatcher implements AttemptDispatcher {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly callbackSigningSecret: string,
    private readonly controlPlaneOrigin: string,
  ) {}

  async submit(attempt: Attempt, repositoryName: string): Promise<void> {
    const repository = await this.artifacts.importBase(
      workspaceName(attempt.runId),
      `https://github.com/${repositoryName}.git`,
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
    const assignment = {
      ...attempt,
      baseCommit: attempt.baseCommit,
      protectedPaths,
      artifact: {
        repositoryId: repository.id,
        repository: repository.name,
        remote: repository.remote,
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
                tokenId: token.id,
                token: token.plaintext,
                access: token.access,
                ref: input.checkpoint.ref,
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
    if (url.pathname === "/attempts/callback" && request.method === "POST") {
      const input = await request.json<AttemptCallback>();
      const repository = new D1RunRepository(env.DB);
      const artifacts = new CloudflareArtifactsNamespace(env.ARTIFACTS);
      const outcome = await acceptCallbackAndAdvance(
        repository,
        await signCallback(env.CALLBACK_SIGNING_SECRET, input.attemptId),
        new ContainerCheckpointValidator(
          env.ATTEMPT_CONTAINERS,
          artifacts,
          repository,
        ),
        input,
        async (wakeup) => {
          await env.RUN_WAKEUPS.send(wakeup);
        },
      );
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
      new CloudflareArtifactsNamespace(env.ARTIFACTS),
      env.CALLBACK_SIGNING_SECRET,
      env.CONTROL_PLANE_ORIGIN,
    );
    for (const message of batch.messages) {
      try {
        await coordinate(repository, dispatcher, message.body, Date.now());
        message.ack();
      } catch {
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
