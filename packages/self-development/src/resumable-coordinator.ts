// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { JobStage, SelfDevelopmentRun } from "./task.js";
import type {
  Clock,
  JobStageExecutor,
  JobStore,
  StageResult,
} from "./job-ports.js";

export class StageFailure extends Error {
  constructor(
    message: string,
    readonly classification: string,
    readonly retryable: boolean,
    readonly evidence?: SelfDevelopmentRun["evidence"],
  ) {
    super(message);
  }
}

function stageFor(run: SelfDevelopmentRun): JobStage | null {
  switch (run.state) {
    case "created":
      return "prepare";
    case "workspace_ready":
    case "implementing":
      return "implement";
    case "validating":
      return "validate";
    case "approved":
      return "commit";
    case "committed":
      return "push";
    case "pushed":
      return "complete";
    case "awaiting_approval":
    case "awaiting_publication":
    case "completed":
    case "failed":
    case "cancelled":
      return null;
  }
}

export type ResumableCoordinatorOptions = {
  workerId: string;
  leaseMs?: number;
  leaseHeartbeatMs?: number;
  maxAttemptsPerStage?: number;
  maxDeployInterruptionsPerStage?: number;
};

const deployInterruptionClassification = "container_interrupted";
const validationRepairClassification = "validation_failed";
const bindingRepairClassification = "implementation_binding_mismatch";

function automaticRepairLimit(stage: JobStage, classification: string): number {
  // The local executor separates workspace preparation from implementation,
  // while the trusted Cloudflare dispatcher performs the complete
  // implementation and validation job during `prepare`. Both are
  // model-backed implementation stages and must share the repair policy.
  if (stage !== "prepare" && stage !== "implement") return 0;
  if (classification === validationRepairClassification) return 3;
  if (classification === bindingRepairClassification) return 2;
  return 0;
}

export class ResumableCoordinator {
  constructor(
    private readonly store: JobStore,
    private readonly executor: JobStageExecutor,
    private readonly clock: Clock,
    private readonly options: ResumableCoordinatorOptions,
  ) {}

  async submit(runId: string, task: SelfDevelopmentRun["task"]): Promise<void> {
    await this.store.submit(runId, task, this.clock.now());
  }

  async workOnce(): Promise<SelfDevelopmentRun | null> {
    const leaseMs = this.options.leaseMs ?? 30_000;
    const claim = await this.store.claimNext(
      this.options.workerId,
      this.clock.now(),
      leaseMs,
    );
    if (!claim) return null;
    return this.workClaim(claim);
  }

  async workRun(
    runId: string,
    expectedRevision?: number,
  ): Promise<SelfDevelopmentRun | null> {
    let claim = await this.store.claim(
      runId,
      this.options.workerId,
      this.clock.now(),
      this.options.leaseMs ?? 30_000,
      expectedRevision,
    );
    if (!claim && expectedRevision !== undefined) {
      const current = await this.store.read(runId);
      const latest = current.attempts.at(-1);
      const leaseExpired =
        current.lease !== undefined &&
        Date.parse(current.lease.expiresAt) <= this.clock.now().getTime();
      if (
        current.revision > expectedRevision &&
        latest?.status === "running" &&
        leaseExpired
      )
        claim = await this.store.claim(
          runId,
          this.options.workerId,
          this.clock.now(),
          this.options.leaseMs ?? 30_000,
          current.revision,
        );
    }
    if (!claim) return null;
    return this.workClaim(claim);
  }

  private async workClaim(
    claim: import("./job-ports.js").JobClaim,
  ): Promise<SelfDevelopmentRun> {
    const stage = stageFor(claim.run);
    if (!stage) {
      await this.store.release(claim.run.runId, claim.token, this.clock.now());
      return this.store.read(claim.run.runId);
    }
    const started = await this.store.startAttempt(
      claim.run.runId,
      claim.token,
      stage,
      this.clock.now(),
    );
    try {
      const result = await this.executeWithLeaseHeartbeat(
        stage,
        started,
        claim.token,
      );
      const completed = await this.store.completeAttempt(
        started.runId,
        claim.token,
        stage,
        result.state,
        result.detail ?? {},
        result.updates ?? {},
        this.clock.now(),
      );
      await this.store.release(started.runId, claim.token, this.clock.now());
      return this.store.read(completed.runId);
    } catch (error) {
      const failure =
        error instanceof StageFailure
          ? error
          : new StageFailure(
              error instanceof Error ? error.message : "Unknown stage error",
              "unexpected",
              false,
            );
      const stageAttempts = started.attempts.filter(
        (attempt) => attempt.stage === stage,
      );
      const deployInterruptions = stageAttempts.filter(
        (attempt) =>
          attempt.classification === deployInterruptionClassification,
      ).length;
      const normalAttempts = stageAttempts.length - deployInterruptions;
      const repairLimit = automaticRepairLimit(stage, failure.classification);
      const automaticRepair = repairLimit > 0;
      const terminal =
        (!failure.retryable && !automaticRepair) ||
        (failure.classification === deployInterruptionClassification
          ? deployInterruptions + 1 >=
            (this.options.maxDeployInterruptionsPerStage ?? 6)
          : normalAttempts >=
            (automaticRepair
              ? Math.min(
                  repairLimit,
                  this.options.maxAttemptsPerStage ?? repairLimit,
                )
              : (this.options.maxAttemptsPerStage ?? 3)));
      const failed = await this.store.failAttempt(
        started.runId,
        claim.token,
        stage,
        {
          retryable: failure.retryable,
          automaticRepair: automaticRepair && !terminal,
          classification: failure.classification,
          error: failure.message,
          evidence: failure.evidence,
        },
        terminal,
        this.clock.now(),
      );
      await this.store.release(started.runId, claim.token, this.clock.now());
      return this.store.read(failed.runId);
    }
  }

  private async executeWithLeaseHeartbeat(
    stage: JobStage,
    run: SelfDevelopmentRun,
    token: string,
  ): Promise<StageResult> {
    const heartbeatMs = this.options.leaseHeartbeatMs;
    if (heartbeatMs === undefined) return this.executor.execute(stage, run);
    const leaseMs = this.options.leaseMs ?? 30_000;
    if (
      !Number.isSafeInteger(heartbeatMs) ||
      heartbeatMs <= 0 ||
      heartbeatMs >= leaseMs
    )
      throw new Error("Lease heartbeat must be shorter than the lease");

    let renewal = Promise.resolve();
    let renewalFailure: unknown;
    const timer = setInterval(() => {
      renewal = renewal
        .then(() =>
          this.store.renew(run.runId, token, this.clock.now(), leaseMs),
        )
        .catch((error: unknown) => {
          renewalFailure ??= error;
        });
    }, heartbeatMs);
    let result: StageResult | undefined;
    let executionFailure: unknown;
    try {
      result = await this.executor.execute(stage, run);
    } catch (error) {
      executionFailure = error;
    } finally {
      clearInterval(timer);
      await renewal;
    }
    if (executionFailure) throw executionFailure;
    if (renewalFailure)
      throw new StageFailure(
        "Worker lease heartbeat failed during stage execution",
        "lease_heartbeat_failed",
        true,
      );
    return result!;
  }
}
