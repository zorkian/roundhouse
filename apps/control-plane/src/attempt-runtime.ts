// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { getSandbox, type DirectoryBackup } from "@cloudflare/sandbox";
import {
  attemptHasCapability,
  type Attempt,
  type RunSnapshot,
} from "@roundhouse/core";
import {
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
  validateReadOnlyCheckpoint,
} from "./artifacts.js";
import {
  BranchChangedError,
  CheckpointRejectedError,
  type AttemptCallback,
  type CheckpointValidator,
} from "./callback.js";
import type { RoundhouseRuntimeSandbox } from "./attempt-container.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import { githubClientForRun, type GitHubEnv } from "./github.js";

export interface AttemptStub {
  destroy(): Promise<void>;
}

export interface AttemptNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): AttemptStub;
}

export type SandboxNamespace = DurableObjectNamespace<RoundhouseRuntimeSandbox>;

export type AttemptRuntimeEnv = Cloudflare.Env &
  GitHubEnv & {
    readonly DB: D1Like;
  };

export function attemptSandbox(
  sandboxes: SandboxNamespace,
  name: string,
): RoundhouseRuntimeSandbox {
  return getSandbox(sandboxes, name, { enableDefaultSession: false });
}

export function sandboxName(
  attempt: Pick<Attempt, "id" | "runId" | "stage" | "competition">,
): string {
  // Competition candidates each get their own sandbox so parallel candidates
  // can never observe or overwrite one another's in-progress state.
  if (attempt.competition?.purpose === "candidate") return attempt.id;
  return attempt.stage === "implement" ? attempt.runId : attempt.id;
}

export async function destroyAttemptSandbox(
  containers: AttemptNamespace,
  name: string,
): Promise<void> {
  await containers.get(containers.idFromName(name)).destroy();
}

export type SandboxDestructionTrace = (
  attemptId: string,
  phase: string,
  detail: Readonly<Record<string, unknown>>,
) => Promise<void>;

export async function destroyAttemptSandboxWithTrace(
  containers: AttemptNamespace,
  name: string,
  attemptId: string,
  trace?: SandboxDestructionTrace,
): Promise<void> {
  const startedAt = Date.now();
  const emit = async (
    phase: string,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<void> => {
    const payload = {
      phase,
      sandboxName: name,
      durationMs: Date.now() - startedAt,
      ...detail,
    };
    const log = { message: "sandbox_destruction_trace", attemptId, ...payload };
    if (phase.endsWith("_failed")) console.error(JSON.stringify(log));
    else console.log(JSON.stringify(log));
    if (!trace) return;
    try {
      await trace(attemptId, phase, payload);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "sandbox_destruction_trace_record_failed",
          attemptId,
          phase,
          sandboxName: name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
  await emit("sandbox_destroy_started");
  try {
    await destroyAttemptSandbox(containers, name);
    await emit("sandbox_destroy_completed");
  } catch (error) {
    await emit("sandbox_destroy_failed", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function cleanupCheckpointResources(
  attemptId: string,
  phase: "validation" | "publication",
  resources: Readonly<Record<string, () => Promise<unknown>>>,
): Promise<void> {
  const entries = Object.entries(resources);
  const results = await Promise.allSettled(
    entries.map(([, cleanup]) => cleanup()),
  );
  for (const [index, result] of results.entries()) {
    if (result?.status !== "rejected") continue;
    const resource = entries[index]?.[0] ?? "unknown";
    console.error(
      JSON.stringify({
        message: "checkpoint_cleanup_unavailable",
        attemptId,
        phase,
        resource,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      }),
    );
  }
}

export async function workspaceBackup(
  db: D1Like,
  runId: string,
): Promise<DirectoryBackup | undefined> {
  const row = await db
    .prepare(
      "SELECT backup_json FROM implementation_workspaces WHERE run_id = ?",
    )
    .bind(runId)
    .first<{ backup_json: string }>();
  return row ? (JSON.parse(row.backup_json) as DirectoryBackup) : undefined;
}

export async function saveWorkspaceBackup(
  db: D1Like,
  runId: string,
  attemptId: string,
  backup: DirectoryBackup,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO implementation_workspaces (run_id, attempt_id, backup_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         attempt_id = excluded.attempt_id,
         backup_json = excluded.backup_json,
         updated_at = excluded.updated_at`,
    )
    .bind(runId, attemptId, JSON.stringify(backup), Date.now())
    .run();
}

export function artifactsNamespace(
  env: Pick<
    Cloudflare.Env,
    "ARTIFACTS" | "ARTIFACTS_NAMESPACE" | "ARTIFACTS_REMOTE_ORIGIN"
  >,
): CloudflareArtifactsNamespace {
  return new CloudflareArtifactsNamespace(env.ARTIFACTS, {
    namespace: env.ARTIFACTS_NAMESPACE,
    remoteOrigin: env.ARTIFACTS_REMOTE_ORIGIN,
  });
}

export function workspaceName(runId: string): string {
  return runId;
}

export function workspaceRef(runId: string): string {
  return `refs/heads/roundhouse/${runId}`;
}

// Candidates publish checkpoints to attempt-specific refs inside their own
// artifact repository; the canonical run ref is only written when the judged
// winner is promoted. Refs are keyed by the deterministic attempt ID because
// candidate IDs are unique only within one competition: two reviewers in one
// review node may both define a candidate with the same ID.
export function attemptWorkspaceRef(
  attempt: Pick<Attempt, "id" | "runId" | "competition">,
): string {
  if (attempt.competition?.purpose === "candidate")
    return `refs/heads/roundhouse/${attempt.id}`;
  return workspaceRef(attempt.runId);
}

// Candidate workspace backups are keyed by attempt so they never overwrite
// the run's canonical workspace backup before judgement.
// Each write candidate receives its own artifact repository so the
// repository-wide write credential one candidate holds can never enumerate,
// fetch, or modify a competitor's state. Token revocation is likewise scoped
// to the issuing attempt's repository.
export function artifactRepositoryName(
  attempt: Pick<Attempt, "id" | "runId" | "competition">,
): string {
  return attempt.competition?.purpose === "candidate"
    ? attempt.id
    : workspaceName(attempt.runId);
}

export function attemptWorkspaceBackupKey(
  attempt: Pick<Attempt, "id" | "runId" | "competition">,
): string {
  return attempt.competition?.purpose === "candidate"
    ? attempt.id
    : attempt.runId;
}

export function checkpointIdentityExpectation(
  attempt: Pick<Attempt, "baseCommit" | "expectedHead"> &
    Partial<Pick<Attempt, "id" | "runId" | "competition">>,
  run: Pick<RunSnapshot, "id" | "profile" | "baseCommit">,
  repositoryId: string,
  enforcePathPolicy: boolean,
) {
  if (!run.profile) throw new Error("run_profile_missing");
  const candidate =
    attempt.competition?.purpose === "candidate" &&
    attempt.id !== undefined &&
    attempt.runId !== undefined;
  return {
    repositoryId,
    repository: candidate ? attempt.id : workspaceName(run.id),
    // Integration attempts may deliberately select a newer target commit
    // than the run's original base. The attempt records that exact identity.
    baseCommit: attempt.baseCommit,
    inputHead: attempt.expectedHead,
    ref: candidate
      ? `refs/heads/roundhouse/${attempt.id}`
      : workspaceRef(run.id),
    profile: run.profile,
    enforcePathPolicy,
  };
}

export function githubBranch(issueNumber: number): string {
  return `roundhouse/issue-${issueNumber}`;
}

// The conflict details a conflict-resolution or integration-delta review
// needs may live several revisions back (for example after a failed delta
// review), so scan revisions until the conflicted integration is found.
export async function conflictedIntegrationOutcome(
  runs: D1RunRepository,
  run: RunSnapshot,
): Promise<Record<string, unknown> | undefined> {
  const latest = await runs.latestCompletedAttempt(
    run.id,
    "integrate",
    run.revision,
  );
  const latestOutcome = latest?.result?.integration as
    Record<string, unknown> | undefined;
  if (latestOutcome?.status === "conflict") return latestOutcome;
  for (let revision = run.revision - 1; revision >= 1; revision -= 1) {
    const attempts = await runs.attemptsForRevision(run.id, revision);
    for (const attempt of attempts) {
      const outcome = attempt.result?.integration as
        Record<string, unknown> | undefined;
      if (
        attempt.stage === "integrate" &&
        attempt.state === "completed" &&
        outcome?.status === "conflict"
      )
        return outcome;
    }
  }
  return undefined;
}

export class SandboxCheckpointValidator implements CheckpointValidator {
  constructor(
    private readonly containers: SandboxNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly repository: D1RunRepository,
  ) {}

  async validate(input: AttemptCallback): Promise<void> {
    const attempt = await this.repository.getAttempt(input.attemptId);
    const run = attempt && (await this.repository.get(attempt.runId));
    if (!attempt || !run) throw new Error("attempt_not_found");
    const artifact = await this.artifacts.get(input.checkpoint.repository);
    if (!artifact) throw new Error("artifact_repository_not_found");
    const reportedIntegration = input.result?.integration as
      Record<string, unknown> | undefined;
    let integrationValidation:
      | {
          readonly baseHead: string;
          readonly mechanical?: true;
          readonly conflicts?: readonly unknown[];
        }
      | undefined;
    if (attempt.stage === "integrate" && attempt.role === "integrate") {
      if (
        reportedIntegration?.candidateHead !== attempt.expectedHead ||
        typeof reportedIntegration.baseHead !== "string" ||
        !/^[a-f0-9]{40}$/.test(reportedIntegration.baseHead)
      )
        throw new Error("integration_result_identity_mismatch");
      if (reportedIntegration.status === "clean") {
        if (reportedIntegration.head !== input.checkpoint.outputHead)
          throw new Error("integration_result_identity_mismatch");
        integrationValidation = {
          baseHead: reportedIntegration.baseHead,
          mechanical: true,
        };
      } else if (reportedIntegration.status === "conflict") {
        if (!Array.isArray(reportedIntegration.conflicts))
          throw new Error("integration_result_identity_mismatch");
        validateReadOnlyCheckpoint(input.checkpoint);
      } else {
        throw new Error("integration_result_identity_mismatch");
      }
    }
    const conflicted =
      attempt.role === "conflict-resolution"
        ? await conflictedIntegrationOutcome(this.repository, run)
        : undefined;
    if (attempt.role === "conflict-resolution" && !conflicted)
      throw new Error("integration_conflict_context_missing");
    if (conflicted) {
      if (
        typeof conflicted.baseHead !== "string" ||
        !/^[a-f0-9]{40}$/.test(conflicted.baseHead) ||
        !Array.isArray(conflicted.conflicts)
      )
        throw new Error("integration_conflict_context_invalid");
      integrationValidation = {
        baseHead: conflicted.baseHead,
        conflicts: conflicted.conflicts,
      };
    }
    console.log(
      JSON.stringify({
        message: "checkpoint_validation_mode_selected",
        runId: run.id,
        attemptId: attempt.id,
        stage: attempt.stage,
        role: attempt.role,
        mode: integrationValidation?.mechanical
          ? "mechanical_integration"
          : integrationValidation?.conflicts
            ? "conflict_resolution"
            : "authored_paths",
        baseHead: integrationValidation?.baseHead ?? null,
        checkpointBaseCommit: input.checkpoint.baseCommit,
        expectedBaseCommit: attempt.baseCommit,
        runBaseCommit: run.baseCommit,
        changedPathCount: input.checkpoint.changedPaths.length,
      }),
    );
    validateCheckpointIdentity(
      input.checkpoint,
      checkpointIdentityExpectation(
        attempt,
        run,
        artifact.id,
        !integrationValidation,
      ),
    );
    if (!attemptHasCapability(attempt, "artifact.write")) {
      try {
        validateReadOnlyCheckpoint(input.checkpoint);
      } finally {
        await cleanupCheckpointResources(attempt.id, "validation", {
          artifactWriterToken: () =>
            artifact.revokeToken(input.artifactTokenId),
        });
      }
      return;
    }
    const token = await artifact.createToken("read", 5 * 60);
    try {
      const validation = await attemptSandbox(
        this.containers,
        `${attempt.id}-validation`,
      ).validateCheckpoint({
        ...attempt,
        baseCommit: attempt.baseCommit,
        profile: run.profile,
        checkpoint: input.checkpoint,
        ...(integrationValidation
          ? { integration: integrationValidation }
          : {}),
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
      });
      if (validation.status >= 400 && validation.status < 500)
        throw new CheckpointRejectedError(
          validation.status,
          validation.responseBody,
        );
      if (validation.status < 200 || validation.status >= 300)
        throw new Error("checkpoint_git_validation_failed");
    } finally {
      await cleanupCheckpointResources(attempt.id, "validation", {
        artifactReaderToken: () => artifact.revokeToken(token.id),
        artifactWriterToken: () => artifact.revokeToken(input.artifactTokenId),
        validationSandbox: () =>
          destroyAttemptSandbox(this.containers, `${attempt.id}-validation`),
      });
    }
  }
}

export class SandboxCheckpointPublisher {
  constructor(
    private readonly containers: SandboxNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly repository: D1RunRepository,
    private readonly githubEnv: GitHubEnv,
  ) {}

  async publish(
    input: AttemptCallback,
    options?: { readonly promoteCompetitionWinner?: boolean },
  ): Promise<void> {
    const attempt = await this.repository.getAttempt(input.attemptId);
    const run = attempt && (await this.repository.get(attempt.runId));
    if (!attempt || !run) throw new Error("attempt_not_found");
    if (
      input.checkpoint.outputHead === input.checkpoint.inputHead ||
      !attemptHasCapability(attempt, "artifact.write")
    )
      return;
    // A losing candidate must never publish to the shared GitHub branch. Its
    // checkpoint remains under its candidate ref in the artifact repository
    // as evidence; only the promoted winner is published, via the promoter.
    if (
      attempt.competition?.purpose === "candidate" &&
      !options?.promoteCompetitionWinner
    ) {
      console.log(
        JSON.stringify({
          message: "competition_candidate_publication_deferred",
          attemptId: attempt.id,
          runId: run.id,
          candidateId: attempt.competition.candidateId,
          ref: input.checkpoint.ref,
          outputHead: input.checkpoint.outputHead,
        }),
      );
      return;
    }
    const artifact = await this.artifacts.get(input.checkpoint.repository);
    if (!artifact) throw new Error("artifact_repository_not_found");
    const token = await artifact.createToken("read", 5 * 60);
    const publicationSandbox = `${attempt.id}-publication`;
    try {
      const publication = await attemptSandbox(
        this.containers,
        publicationSandbox,
      ).publishCheckpoint({
        ...attempt,
        baseCommit: attempt.baseCommit,
        profile: run.profile,
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
          token: await githubClientForRun(
            this.githubEnv,
            run,
          ).installationToken(),
          ref: `refs/heads/${githubBranch(run.issueNumber)}`,
        },
      });
      if (publication.status === 409)
        throw new BranchChangedError(
          publication.status,
          publication.responseBody,
        );
      if (publication.status < 200 || publication.status >= 300)
        throw new Error("checkpoint_git_publication_failed");
    } finally {
      await cleanupCheckpointResources(attempt.id, "publication", {
        artifactReaderToken: () => artifact.revokeToken(token.id),
        publicationSandbox: () =>
          destroyAttemptSandbox(this.containers, publicationSandbox),
      });
    }
  }
}
