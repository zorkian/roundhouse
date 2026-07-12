// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  repositoryExecutionRequestSchema,
  type RepositoryExecutionRequest,
} from "@roundhouse/self-development/cloudflare";
import { describe, expect, it } from "vitest";

import {
  CloudflareRepositoryExecutionBackend,
  type EvidenceBucketPort,
  type ExecutionContainerPort,
} from "./cloudflare-execution.js";

const request: RepositoryExecutionRequest = {
  schemaVersion: 1,
  runId: "run_container_contract",
  attemptId: "run_container_contract-prepare-1",
  attemptNumber: 1,
  expectedRevision: 3,
  repositoryUrl: "https://github.com/zorkian/roundhouse.git",
  baseCommit: "a".repeat(40),
  profile: "roundhouse.v1",
  command: "license",
  scenario: "success",
  timeoutMs: 120_000,
  maxOutputBytes: 262_144,
};

describe("repository execution request", () => {
  it("shares the runner attempt identity boundary", () => {
    expect(() =>
      repositoryExecutionRequestSchema.parse({ ...request, attemptId: "" }),
    ).toThrow();
    expect(() =>
      repositoryExecutionRequestSchema.parse({
        ...request,
        attemptId: `attempt-${"x".repeat(200)}`,
      }),
    ).toThrow();
  });
});

function result(exitCode = 0, timedOut = false) {
  return {
    schemaVersion: 1 as const,
    runId: request.runId,
    attemptId: request.attemptId,
    baseCommit: request.baseCommit,
    checkoutCommit: request.baseCommit,
    command: "license" as const,
    exitCode,
    timedOut,
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    startupDurationMs: 250,
    checkoutDurationMs: 500,
    durationMs: 1_000,
    stdout: "license headers valid\n",
    stderr: "",
    outputTruncated: false,
    changedFiles: [],
    network: {
      checkoutHosts: ["github.com"],
      executionInternetEnabled: false as const,
      deniedProbe: true as const,
    },
    resources: { diskBytes: 1024, memoryBytes: 2048 },
  };
}

class MemoryEvidence implements EvidenceBucketPort {
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;

  async get(key: string) {
    const value = this.objects.get(key);
    return value ? { text: async () => new TextDecoder().decode(value) } : null;
  }

  async put(
    key: string,
    value: Uint8Array,
    _options: Parameters<EvidenceBucketPort["put"]>[2],
  ) {
    this.puts += 1;
    if (this.objects.has(key)) return null;
    this.objects.set(key, value);
    return {};
  }
}

describe("CloudflareRepositoryExecutionBackend", () => {
  it("stores immutable hash-bound evidence and replays without execution", async () => {
    const evidence = new MemoryEvidence();
    let executions = 0;
    const container: ExecutionContainerPort = {
      runJob: async () => {
        executions += 1;
        return result();
      },
      destroy: async () => undefined,
    };
    const backend = new CloudflareRepositoryExecutionBackend(
      { getByName: () => container },
      evidence,
    );

    const first = await backend.execute(request);
    const replay = await backend.execute(request);

    expect(executions).toBe(1);
    expect(evidence.puts).toBe(1);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      state: "awaiting_approval",
      updates: {
        workspaceRef: request.baseCommit,
        evidence: [
          {
            attemptId: request.attemptId,
            objectKey:
              "runs/run_container_contract/attempts/run_container_contract-prepare-1/execution.json",
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      },
    });
  });

  it("classifies interruption as retryable and tears down the container", async () => {
    let destroyed = 0;
    const backend = new CloudflareRepositoryExecutionBackend(
      {
        getByName: () => ({
          runJob: async () => {
            throw new Error("instance disappeared");
          },
          destroy: async () => {
            destroyed += 1;
          },
        }),
      },
      new MemoryEvidence(),
    );

    await expect(backend.execute(request)).rejects.toMatchObject({
      classification: "container_interrupted",
      retryable: true,
    });
    expect(destroyed).toBe(1);
  });

  it("retains evidence for a classified nonzero exit", async () => {
    const evidence = new MemoryEvidence();
    const backend = new CloudflareRepositoryExecutionBackend(
      {
        getByName: () => ({
          runJob: async () => result(2),
          destroy: async () => undefined,
        }),
      },
      evidence,
    );

    await expect(backend.execute(request)).rejects.toMatchObject({
      classification: "command_failed",
      retryable: false,
      evidence: [
        {
          objectKey:
            "runs/run_container_contract/attempts/run_container_contract-prepare-1/execution.json",
        },
      ],
    });
    expect(evidence.objects.size).toBe(1);
  });

  it("classifies an interrupted evidence upload as retryable", async () => {
    const evidence = new MemoryEvidence();
    evidence.put = async () => {
      throw new Error("simulated R2 interruption");
    };
    const backend = new CloudflareRepositoryExecutionBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          destroy: async () => undefined,
        }),
      },
      evidence,
    );

    await expect(backend.execute(request)).rejects.toMatchObject({
      classification: "evidence_unavailable",
      retryable: true,
    });
  });
});
