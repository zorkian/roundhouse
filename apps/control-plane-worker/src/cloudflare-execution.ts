// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  repositoryExecutionRequestSchema,
  repositoryExecutionResultSchema,
  repositoryPathAllowed,
  roundhouseFormatterWriteCommand,
  type IndependentReviewRequest,
  type IndependentReviewResult,
  type PlanningAgentRequest,
  type PlanningAgentResult,
  trustedImplementationRequestSchema,
  trustedImplementationResultSchema,
  type ExecutionDispatcher,
  type ExecutionDispatchRequest,
  type RepositoryExecutionBackend,
  type RepositoryExecutionRequest,
  type RepositoryExecutionResult,
  type StageResult,
  type TrustedImplementationRequest,
  type TrustedImplementationBackend,
  type TrustedImplementationResult,
} from "@roundhouse/self-development/cloudflare";
import { StageFailure } from "@roundhouse/self-development/cloudflare";
import { ZodError } from "zod";

export type ExecutionContainerPort = {
  runJob(request: RepositoryExecutionRequest): Promise<unknown>;
  runTrustedJob?(
    request: TrustedImplementationRequest,
    codexAuthJson: string,
  ): Promise<unknown>;
  runReviewJob?(
    request: IndependentReviewRequest,
    claudeAuthJson: string,
  ): Promise<IndependentReviewResult>;
  runPlanningJob?(
    request: PlanningAgentRequest,
    codexAuthJson: string,
  ): Promise<PlanningAgentResult>;
  releaseCanary?(expectedCommit: string): Promise<{
    schemaVersion: 1;
    ok: true;
    releaseCommit: string;
  }>;
  readAgentOutput?(request: AgentOutputRequest): Promise<AgentOutputTail>;
  destroy(): Promise<void>;
};

export type AgentOutputRequest = {
  attemptId: string;
  cursor?: number;
};

export type AgentOutputLine = {
  cursor: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
  occurredAt: string;
};

export type AgentOutputTail = {
  schemaVersion: 1;
  attemptId: string;
  status: "running" | "completed" | "failed" | "unavailable";
  nextCursor: number;
  truncated: boolean;
  lines: AgentOutputLine[];
};

export function isValidAgentOutputTail(
  value: Partial<AgentOutputTail>,
  input: AgentOutputRequest,
): value is AgentOutputTail {
  return (
    value.schemaVersion === 1 &&
    value.attemptId === input.attemptId &&
    ["running", "completed", "failed", "unavailable"].includes(
      value.status ?? "",
    ) &&
    Number.isSafeInteger(value.nextCursor) &&
    (value.nextCursor ?? -1) >= (input.cursor ?? 0) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.lines) &&
    value.lines.length <= 100 &&
    (value.lines.length === 0 ||
      value.nextCursor === value.lines.at(-1)!.cursor) &&
    value.lines.every(
      (line, index, lines) =>
        Number.isSafeInteger(line.cursor) &&
        line.cursor > (input.cursor ?? 0) &&
        (index === 0 || line.cursor > lines[index - 1]!.cursor) &&
        ["stdout", "stderr", "system"].includes(line.stream) &&
        typeof line.text === "string" &&
        line.text.length > 0 &&
        line.text.length <= 2_000 &&
        typeof line.occurredAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(line.occurredAt),
    )
  );
}

export type ExecutionContainerNamespacePort = {
  getByName(name: string): ExecutionContainerPort;
};

export async function readAgentOutput(
  containers: ExecutionContainerNamespacePort | undefined,
  request: AgentOutputRequest,
): Promise<AgentOutputTail> {
  const unavailable = (): AgentOutputTail => ({
    schemaVersion: 1,
    attemptId: request.attemptId,
    status: "unavailable",
    nextCursor: request.cursor ?? 0,
    truncated: false,
    lines: [],
  });
  if (!containers) return unavailable();
  const container = containers.getByName(request.attemptId);
  if (!container.readAgentOutput) return unavailable();
  try {
    const value = await container.readAgentOutput(request);
    return isValidAgentOutputTail(value, request) ? value : unavailable();
  } catch {
    return unavailable();
  }
}

export type EvidenceObject = {
  text(): Promise<string>;
};

export type EvidenceBucketPort = {
  get(key: string): Promise<EvidenceObject | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      onlyIf: { etagDoesNotMatch: string };
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      sha256: Uint8Array;
    },
  ): Promise<unknown | null>;
};

const encoder = new TextEncoder();

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function trustedEvidenceKey(request: TrustedImplementationRequest): string {
  return `runs/${request.runId}/attempts/${request.attemptId}/trusted-implementation.json`;
}

function trustedValidationFailureReason(
  result: TrustedImplementationResult,
): string {
  const failures = result.validation.filter(
    (item) => item.exitCode !== 0 || item.timedOut || item.outputTruncated,
  );
  const diagnostics = failures
    .map((item) => {
      const output = [item.stdout, item.stderr]
        .filter(Boolean)
        .join("\n")
        .trim()
        .slice(-3_000);
      return [
        `${item.name}: ${item.command} (exit ${item.exitCode ?? "none"}${item.timedOut ? ", timed out" : ""}${item.outputTruncated ? ", output truncated" : ""})`,
        output,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return `Trusted implementation validation failed\n\n${diagnostics}`.slice(
    0,
    12_000,
  );
}

async function validateTrustedResult(
  request: TrustedImplementationRequest,
  value: unknown,
): Promise<TrustedImplementationResult> {
  const parsed = trustedImplementationResultSchema.safeParse(value);
  if (!parsed.success)
    throw new StageFailure(
      "Trusted implementation result failed schema validation",
      "implementation_binding_mismatch",
      false,
    );
  const result = parsed.data;
  const validationFailed = result.validation.some(
    (item) => item.exitCode !== 0 || item.timedOut || item.outputTruncated,
  );
  const patchBytes = encoder.encode(result.patch);
  const patchHash = bytesToHex(
    await crypto.subtle.digest("SHA-256", patchBytes),
  );
  const publicationManifest = result.publicationManifest;
  const retryLineage = result.retryLineage;
  const regression = result.regressionEvidence;
  const regressionBindingValid = regression
    ? request.planning !== undefined &&
      regression.repositoryUrl === request.repositoryUrl &&
      regression.baseCommit === request.baseCommit &&
      regression.planId === request.planning.planId &&
      regression.planSha256 === request.planning.planSha256 &&
      regression.attemptId === request.attemptId &&
      regression.headPatchSha256 === result.patchSha256 &&
      regression.command ===
        (request.bugReproduction?.applicability === "applicable"
          ? request.bugReproduction.command
          : undefined)
    : request.bugReproduction === undefined;
  const retryBindingValid = request.retryCandidate
    ? retryLineage?.priorAttemptId === request.retryCandidate.attemptId &&
      retryLineage.priorPatchSha256 === request.retryCandidate.patchSha256 &&
      [...retryLineage.priorChangedFiles].sort().join("\0") ===
        [...request.retryCandidate.changedFiles].sort().join("\0") &&
      retryLineage.retainedAllPriorPaths ===
        retryLineage.priorChangedFiles.every((path) =>
          result.changedFiles.includes(path),
        )
    : retryLineage === undefined;
  let manifestBindingValid = true;
  let publicationBytes = 0;
  if (publicationManifest) {
    const manifestValue = {
      schemaVersion: publicationManifest.schemaVersion,
      baseCommit: publicationManifest.baseCommit,
      patchSha256: publicationManifest.patchSha256,
      files: publicationManifest.files,
    };
    const manifestBytes = encoder.encode(JSON.stringify(manifestValue));
    const manifestHash = bytesToHex(
      await crypto.subtle.digest("SHA-256", manifestBytes),
    );
    const manifestPaths = publicationManifest.files.map((file) => file.path);
    manifestBindingValid =
      publicationManifest.baseCommit === request.baseCommit &&
      publicationManifest.patchSha256 === result.patchSha256 &&
      publicationManifest.sha256 === manifestHash &&
      new Set(manifestPaths).size === manifestPaths.length &&
      [...manifestPaths].sort().join("\0") ===
        [...result.changedFiles].sort().join("\0");
    for (const file of publicationManifest.files) {
      if (file.operation !== "upsert") continue;
      let content: Uint8Array;
      try {
        content = Uint8Array.from(atob(file.contentBase64), (value) =>
          value.charCodeAt(0),
        );
      } catch {
        throw new StageFailure(
          "Trusted publication content was not valid base64",
          "implementation_binding_mismatch",
          false,
        );
      }
      publicationBytes += content.byteLength;
      const ownedContent = new Uint8Array(new ArrayBuffer(content.byteLength));
      ownedContent.set(content);
      const contentHash = bytesToHex(
        await crypto.subtle.digest("SHA-256", ownedContent),
      );
      if (content.byteLength !== file.size || contentHash !== file.sha256)
        throw new StageFailure(
          "Trusted publication content binding did not match",
          "implementation_binding_mismatch",
          false,
        );
    }
  }
  if (
    result.runId !== request.runId ||
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit ||
    result.checkoutCommit !== request.baseCommit ||
    result.patchSha256 !== patchHash ||
    result.patchBytes !== patchBytes.byteLength ||
    result.patchBytes > request.maxPatchBytes ||
    (result.validationOutcome === "failed") !== validationFailed ||
    (result.validationOutcome === "failed" &&
      result.publicationManifest !== undefined) ||
    !manifestBindingValid ||
    !retryBindingValid ||
    !regressionBindingValid ||
    publicationBytes > request.maxPatchBytes ||
    result.changedFiles.length > request.maxChangedFiles ||
    !result.changedFiles.every((path) =>
      request.pathPolicy
        ? repositoryPathAllowed(request.pathPolicy, path)
        : request.allowedPaths.includes(path),
    )
  )
    throw new StageFailure(
      "Trusted implementation result did not match its immutable request",
      "implementation_binding_mismatch",
      false,
    );
  return result;
}

async function parseTrustedEvidence(
  request: TrustedImplementationRequest,
  text: string,
): Promise<TrustedImplementationResult> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new StageFailure(
      "Trusted implementation evidence is not valid JSON",
      "implementation_binding_mismatch",
      false,
    );
  }
  return validateTrustedResult(request, value);
}

export class CloudflareTrustedImplementationBackend implements TrustedImplementationBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly evidence: EvidenceBucketPort,
    private readonly codexAuthJson: string,
  ) {}

  async execute(input: TrustedImplementationRequest): Promise<StageResult> {
    const request = trustedImplementationRequestSchema.parse(input);
    let boundRequest = request;
    if (request.retryFromAttemptId) {
      const priorRequest = trustedImplementationRequestSchema.parse({
        ...request,
        attemptId: request.retryFromAttemptId,
        retryFromAttemptId: undefined,
        retryCandidate: undefined,
      });
      const priorObject = await this.evidence.get(
        trustedEvidenceKey(priorRequest),
      );
      if (!priorObject)
        throw new StageFailure(
          "Prior retry candidate evidence is unavailable",
          "evidence_unavailable",
          false,
        );
      const prior = await parseTrustedEvidence(
        priorRequest,
        await priorObject.text(),
      );
      if (prior.validationOutcome !== "failed")
        throw new StageFailure(
          "Retry predecessor is not a failed candidate",
          "implementation_binding_mismatch",
          false,
        );
      boundRequest = trustedImplementationRequestSchema.parse({
        ...request,
        retryCandidate: {
          attemptId: prior.attemptId,
          patch: prior.patch,
          patchSha256: prior.patchSha256,
          changedFiles: prior.changedFiles,
        },
      });
    }
    const key = trustedEvidenceKey(request);
    let result: TrustedImplementationResult;
    let evidenceBytes: Uint8Array<ArrayBuffer>;
    const existing = await this.evidence.get(key);
    if (existing) {
      try {
        const text = await existing.text();
        evidenceBytes = encoder.encode(text);
        result = await parseTrustedEvidence(boundRequest, text);
      } catch (error) {
        if (error instanceof StageFailure) throw error;
        throw new StageFailure(
          `Trusted evidence could not be read: ${boundedInfrastructureReason(error)}`,
          "evidence_unavailable",
          true,
        );
      }
    } else {
      const container = this.containers.getByName(request.attemptId);
      try {
        if (!container.runTrustedJob)
          throw new StageFailure(
            "Trusted Container adapter is unavailable",
            "trusted_adapter_unavailable",
            false,
          );
        result = await validateTrustedResult(
          boundRequest,
          await container.runTrustedJob(boundRequest, this.codexAuthJson),
        );
      } catch (error) {
        await container.destroy().catch(() => undefined);
        if (error instanceof StageFailure) throw error;
        if (error instanceof ZodError)
          throw new StageFailure(
            "Trusted implementation result failed schema validation",
            "implementation_binding_mismatch",
            false,
          );
        const reason = boundedInfrastructureReason(error);
        if (reason.includes("validation_failed"))
          throw new StageFailure(
            `Trusted implementation validation failed: ${reason}`,
            "validation_failed",
            false,
          );
        throw new StageFailure(
          `Trusted Container execution was interrupted: ${reason}`,
          "container_interrupted",
          true,
        );
      }
      const bytes = encoder.encode(JSON.stringify(result));
      evidenceBytes = bytes;
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const stored = await this.evidence
        .put(key, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            runId: request.runId,
            attemptId: request.attemptId,
            patchSha256: result.patchSha256,
            validationOutcome: result.validationOutcome,
          },
          sha256: digest,
        })
        .catch(() => null);
      if (!stored) {
        const raced = await this.evidence.get(key).catch(() => null);
        if (!raced)
          throw new StageFailure(
            "Trusted evidence upload did not become durable",
            "evidence_unavailable",
            true,
          );
        try {
          const text = await raced.text();
          evidenceBytes = encoder.encode(text);
          result = await parseTrustedEvidence(boundRequest, text);
        } catch (error) {
          if (error instanceof StageFailure) throw error;
          throw new StageFailure(
            `Trusted raced evidence could not be verified: ${boundedInfrastructureReason(error)}`,
            "evidence_unavailable",
            true,
          );
        }
      }
    }
    const hash = await crypto.subtle.digest("SHA-256", evidenceBytes);
    const evidence = {
      schemaVersion: 1 as const,
      evidenceId: `evidence_${request.attemptId}`,
      attemptId: request.attemptId,
      objectKey: key,
      sha256: bytesToHex(hash),
      size: evidenceBytes.byteLength,
      mediaType: "application/json" as const,
      approvalEligible: result.validationOutcome === "passed",
      createdAt: result.completedAt,
    };
    if (result.validationOutcome === "failed")
      throw new StageFailure(
        trustedValidationFailureReason(result),
        "validation_failed",
        false,
        [evidence],
      );
    return {
      state: "awaiting_approval",
      detail: {
        dispatcher: "cloudflare-trusted-codex",
        attemptId: request.attemptId,
        patchSha256: result.patchSha256,
        evidenceSha256: evidence.sha256,
      },
      updates: {
        workspaceRef: request.baseCommit,
        evidence: [evidence],
        implementation: {
          patchSha256: result.patchSha256,
          patchBytes: result.patchBytes,
          changedFiles: result.changedFiles,
          evidenceId: evidence.evidenceId,
          objectKey: key,
        },
      },
    };
  }
}

async function encodeEvidence(result: RepositoryExecutionResult): Promise<{
  bytes: Uint8Array;
  digest: Uint8Array;
  sha256: string;
}> {
  const bytes = encoder.encode(JSON.stringify(result));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes,
    digest: new Uint8Array(hash),
    sha256: bytesToHex(hash),
  };
}

function evidenceKey(request: RepositoryExecutionRequest): string {
  return `runs/${request.runId}/attempts/${request.attemptId}/execution.json`;
}

function boundedInfrastructureReason(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError";
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\/(?:[^\s/:]+\/)+[^\s:]+/g, "[path]")
    .slice(0, 200);
}

async function evidenceReference(
  request: RepositoryExecutionRequest,
  result: RepositoryExecutionResult,
) {
  const encoded = await encodeEvidence(result);
  return {
    encoded,
    reference: {
      schemaVersion: 1 as const,
      evidenceId: `evidence_${request.attemptId}`,
      attemptId: request.attemptId,
      objectKey: evidenceKey(request),
      sha256: encoded.sha256,
      size: encoded.bytes.byteLength,
      mediaType: "application/json" as const,
      createdAt: result.completedAt,
    },
  };
}

function validateResult(
  request: RepositoryExecutionRequest,
  value: unknown,
): RepositoryExecutionResult {
  const result = repositoryExecutionResultSchema.parse(value);
  if (
    result.runId !== request.runId ||
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit ||
    result.checkoutCommit !== request.baseCommit
  )
    throw new StageFailure(
      "Execution result did not match its immutable request binding",
      "execution_binding_mismatch",
      false,
    );
  return result;
}

async function readEvidence(
  bucket: EvidenceBucketPort,
  key: string,
  request: RepositoryExecutionRequest,
): Promise<RepositoryExecutionResult | null> {
  try {
    const object = await bucket.get(key);
    return object
      ? validateResult(request, JSON.parse(await object.text()))
      : null;
  } catch (error) {
    throw new StageFailure(
      `Execution evidence could not be read: ${boundedInfrastructureReason(error)}`,
      "evidence_unavailable",
      true,
    );
  }
}

export class CloudflareRepositoryExecutionBackend implements RepositoryExecutionBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly evidence: EvidenceBucketPort,
  ) {}

  async execute(input: RepositoryExecutionRequest): Promise<StageResult> {
    const request = repositoryExecutionRequestSchema.parse(input);
    const key = evidenceKey(request);
    const existing = await readEvidence(this.evidence, key, request);
    let result: RepositoryExecutionResult;
    if (existing) {
      result = existing;
    } else {
      const container = this.containers.getByName(request.attemptId);
      try {
        result = validateResult(request, await container.runJob(request));
      } catch (error) {
        const reason = boundedInfrastructureReason(error);
        console.error("Cloudflare Container execution failed", {
          reason,
          attemptId: request.attemptId,
        });
        await container.destroy().catch(() => undefined);
        if (error instanceof StageFailure) throw error;
        throw new StageFailure(
          `Cloudflare Container execution was interrupted: ${reason}`,
          "container_interrupted",
          true,
        );
      }
      const encoded = await encodeEvidence(result);
      let stored;
      try {
        stored = await this.evidence.put(key, encoded.bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            runId: request.runId,
            attemptId: request.attemptId,
            sha256: encoded.sha256,
          },
          sha256: encoded.digest,
        });
      } catch {
        throw new StageFailure(
          "Execution evidence upload was interrupted",
          "evidence_unavailable",
          true,
        );
      }
      if (!stored) {
        const raced = await readEvidence(this.evidence, key, request);
        if (!raced)
          throw new StageFailure(
            "Execution evidence upload did not become durable",
            "evidence_unavailable",
            true,
          );
        result = raced;
      }
    }

    const { encoded, reference } = await evidenceReference(request, result);
    if (result.timedOut)
      throw new StageFailure(
        "Repository profile command timed out",
        "execution_timeout",
        false,
        [reference],
      );
    if (result.exitCode !== 0)
      throw new StageFailure(
        "Repository profile command failed",
        "command_failed",
        false,
        [reference],
      );
    return {
      state: "awaiting_approval",
      detail: {
        dispatcher: "cloudflare-container",
        attemptId: request.attemptId,
        evidenceSha256: encoded.sha256,
      },
      updates: {
        workspaceRef: request.baseCommit,
        evidence: [reference],
      },
    };
  }
}

export class CloudflareExecutionDispatcher implements ExecutionDispatcher {
  constructor(
    private readonly backend: RepositoryExecutionBackend,
    private readonly scenario: RepositoryExecutionRequest["scenario"] = "success",
  ) {}

  dispatch(request: ExecutionDispatchRequest): Promise<StageResult> {
    if (request.stage !== "prepare")
      throw new StageFailure(
        "Only the bounded execution stage is authorized",
        "stage_not_authorized",
        false,
      );
    return this.backend.execute({
      schemaVersion: 1,
      runId: request.runId,
      attemptId: `${request.runId}-prepare-${request.attemptNumber}`,
      attemptNumber: request.attemptNumber,
      expectedRevision: request.expectedRevision,
      repositoryUrl: "https://github.com/zorkian/roundhouse.git",
      baseCommit: request.baseCommit,
      profile: "roundhouse.v1",
      command: "license",
      scenario: this.scenario,
      timeoutMs: 120_000,
      maxOutputBytes: 262_144,
    });
  }
}

export class CloudflareTrustedExecutionDispatcher implements ExecutionDispatcher {
  constructor(
    private readonly backend: TrustedImplementationBackend,
    private readonly scenario: TrustedImplementationRequest["scenario"] = "success",
  ) {}

  dispatch(request: ExecutionDispatchRequest): Promise<StageResult> {
    if (request.stage !== "prepare")
      throw new StageFailure(
        "Only the bounded trusted implementation stage is authorized",
        "stage_not_authorized",
        false,
      );
    return this.backend.execute({
      schemaVersion: 1,
      runId: request.runId,
      attemptId: `${request.runId}-prepare-${request.attemptNumber}`,
      attemptNumber: request.attemptNumber,
      expectedRevision: request.expectedRevision,
      repositoryUrl: "https://github.com/zorkian/roundhouse.git",
      baseCommit: request.baseCommit,
      subject: request.subject,
      instructions: request.instructions,
      retryContext: request.retryContext,
      retryFromAttemptId: request.retryFromAttemptId,
      allowedPaths: request.allowedPaths,
      pathPolicy: request.pathPolicy,
      validationLevel: request.validationLevel,
      formatter: {
        command: roundhouseFormatterWriteCommand.command,
        args: [...roundhouseFormatterWriteCommand.args],
      },
      bugReproduction: request.bugReproduction,
      planning: request.planning,
      // The development Workflow, rather than a Queue invocation, owns this
      // bounded long-running attempt. These are total agent and validation
      // budgets; the Workflow itself retains a small finalization margin.
      agentTimeoutMs: 2 * 60 * 60_000,
      validationTimeoutMs: 30 * 60_000,
      maxPatchBytes: 512 * 1024,
      maxChangedFiles: request.pathPolicy?.maxChangedFiles ?? 50,
      maxOutputBytes: 5 * 1024 * 1024,
      scenario: this.scenario,
    });
  }
}
