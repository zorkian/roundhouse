// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  repositoryExecutionRequestSchema,
  repositoryExecutionResultSchema,
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

export type ExecutionContainerPort = {
  runJob(request: RepositoryExecutionRequest): Promise<unknown>;
  runTrustedJob?(
    request: TrustedImplementationRequest,
    codexAuthJson: string,
  ): Promise<unknown>;
  destroy(): Promise<void>;
};

export type ExecutionContainerNamespacePort = {
  getByName(name: string): ExecutionContainerPort;
};

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

async function validateTrustedResult(
  request: TrustedImplementationRequest,
  value: unknown,
): Promise<TrustedImplementationResult> {
  const result = trustedImplementationResultSchema.parse(value);
  const patchHash = bytesToHex(
    await crypto.subtle.digest("SHA-256", encoder.encode(result.patch)),
  );
  if (
    result.runId !== request.runId ||
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit ||
    result.checkoutCommit !== request.baseCommit ||
    result.patchSha256 !== patchHash ||
    result.patchBytes !== new TextEncoder().encode(result.patch).byteLength ||
    !result.changedFiles.every((path) =>
      request.allowedPaths.some(
        (allowed) => path === allowed || path.startsWith(`${allowed}/`),
      ),
    )
  )
    throw new StageFailure(
      "Trusted implementation result did not match its immutable request",
      "implementation_binding_mismatch",
      false,
    );
  return result;
}

export class CloudflareTrustedImplementationBackend implements TrustedImplementationBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly evidence: EvidenceBucketPort,
    private readonly codexAuthJson: string,
  ) {}

  async execute(request: TrustedImplementationRequest): Promise<StageResult> {
    const key = trustedEvidenceKey(request);
    let result: TrustedImplementationResult;
    const existing = await this.evidence.get(key);
    if (existing) {
      try {
        result = await validateTrustedResult(
          request,
          JSON.parse(await existing.text()),
        );
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
          request,
          await container.runTrustedJob(request, this.codexAuthJson),
        );
      } catch (error) {
        await container.destroy().catch(() => undefined);
        if (error instanceof StageFailure) throw error;
        throw new StageFailure(
          `Trusted Container execution was interrupted: ${boundedInfrastructureReason(error)}`,
          "container_interrupted",
          true,
        );
      }
      const bytes = encoder.encode(JSON.stringify(result));
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
          result = await validateTrustedResult(
            request,
            JSON.parse(await raced.text()),
          );
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
    const bytes = encoder.encode(JSON.stringify(result));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const evidence = {
      schemaVersion: 1 as const,
      evidenceId: `evidence_${request.attemptId}`,
      attemptId: request.attemptId,
      objectKey: key,
      sha256: bytesToHex(hash),
      size: bytes.byteLength,
      mediaType: "application/json" as const,
      createdAt: result.completedAt,
    };
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
      allowedPaths: request.allowedPaths,
      validationLevel: request.validationLevel,
      agentTimeoutMs: 20 * 60_000,
      validationTimeoutMs: 15 * 60_000,
      maxPatchBytes: 512 * 1024,
      maxChangedFiles: 50,
      maxOutputBytes: 5 * 1024 * 1024,
      scenario: this.scenario,
    });
  }
}
