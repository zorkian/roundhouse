// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  repositoryExecutionRequestSchema,
  repositoryExecutionResultSchema,
  type ExecutionDispatcher,
  type ExecutionDispatchRequest,
  type RepositoryExecutionBackend,
  type RepositoryExecutionRequest,
  type RepositoryExecutionResult,
  type StageResult,
} from "@roundhouse/self-development/cloudflare";
import { StageFailure } from "@roundhouse/self-development/cloudflare";

export type ExecutionContainerPort = {
  runJob(request: RepositoryExecutionRequest): Promise<unknown>;
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

export class CloudflareRepositoryExecutionBackend implements RepositoryExecutionBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly evidence: EvidenceBucketPort,
  ) {}

  async execute(input: RepositoryExecutionRequest): Promise<StageResult> {
    const request = repositoryExecutionRequestSchema.parse(input);
    const key = evidenceKey(request);
    const existing = await this.evidence.get(key);
    let result: RepositoryExecutionResult;
    if (existing) {
      result = validateResult(request, JSON.parse(await existing.text()));
    } else {
      const container = this.containers.getByName(request.attemptId);
      try {
        result = validateResult(request, await container.runJob(request));
      } catch (error) {
        await container.destroy().catch(() => undefined);
        if (error instanceof StageFailure) throw error;
        throw new StageFailure(
          "Cloudflare Container execution was interrupted",
          "container_interrupted",
          true,
        );
      }
      const encoded = await encodeEvidence(result);
      const stored = await this.evidence.put(key, encoded.bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          runId: request.runId,
          attemptId: request.attemptId,
          sha256: encoded.sha256,
        },
        sha256: encoded.digest,
      });
      if (!stored) {
        const raced = await this.evidence.get(key);
        if (!raced)
          throw new StageFailure(
            "Execution evidence upload did not become durable",
            "evidence_unavailable",
            true,
          );
        result = validateResult(request, JSON.parse(await raced.text()));
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
