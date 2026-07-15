// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  repositoryExecutionRequestSchema,
  type RepositoryExecutionRequest,
  type TrustedImplementationRequest,
} from "@roundhouse/self-development/cloudflare";
import { describe, expect, it } from "vitest";

import {
  CloudflareRepositoryExecutionBackend,
  CloudflareTrustedImplementationBackend,
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

const trustedRequest: TrustedImplementationRequest = {
  schemaVersion: 1,
  runId: "run_trusted_container_contract",
  attemptId: "run_trusted_container_contract-prepare-1",
  attemptNumber: 1,
  expectedRevision: 3,
  repositoryUrl: "https://github.com/zorkian/roundhouse.git",
  baseCommit: "a".repeat(40),
  subject: "Document the trusted loop",
  instructions: "Change only the dogfood document.",
  allowedPaths: ["docs/dogfood/trusted-self-development-loop.md"],
  validationLevel: "full",
  agentTimeoutMs: 1_200_000,
  validationTimeoutMs: 900_000,
  maxPatchBytes: 512 * 1024,
  maxChangedFiles: 50,
  maxOutputBytes: 5 * 1024 * 1024,
  scenario: "success",
};

function trustedResult() {
  const patch =
    "diff --git a/docs/dogfood/trusted-self-development-loop.md b/docs/dogfood/trusted-self-development-loop.md\n";
  return {
    schemaVersion: 1 as const,
    runId: trustedRequest.runId,
    attemptId: trustedRequest.attemptId,
    baseCommit: trustedRequest.baseCommit,
    checkoutCommit: trustedRequest.baseCommit,
    patch,
    patchSha256:
      "d3e85c9b33fe5cfed596b842e3e9c09c68ec52865c18272bdf209507bd49c6f8",
    patchBytes: new TextEncoder().encode(patch).byteLength,
    changedFiles: ["docs/dogfood/trusted-self-development-loop.md"],
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    startupDurationMs: 1,
    checkoutDurationMs: 1,
    agentDurationMs: 1,
    validationDurationMs: 1,
    agent: {
      provider: "codex-subscription" as const,
      outcome: "succeeded" as const,
      summary: "Created the requested documentation.",
      eventBytes: 100,
    },
    validation: [
      {
        name: "license" as const,
        command: "node scripts/check-license-headers.mjs",
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
        stdout: "",
        stderr: "",
        outputTruncated: false,
      },
    ],
    network: {
      checkoutHosts: ["github.com" as const],
      modelHosts: ["chatgpt.com"],
      agentToolInternetEnabled: false as const,
      validationInternetEnabled: false as const,
      deniedHttpProbe: true as const,
      deniedTcpProbe: true as const,
    },
    credential: {
      installedAtRuntime: true as const,
      removedBeforeValidation: true as const,
      absentFromEvidence: true as const,
    },
    resources: { diskBytes: 1, memoryBytes: 1 },
  };
}

describe("CloudflareTrustedImplementationBackend", () => {
  it("retains the trusted runner's canonical bug regression validation", async () => {
    const evidence = new MemoryEvidence();
    const implementation = trustedResult();
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => ({
            ...implementation,
            validation: [
              ...implementation.validation,
              {
                name: "bug-regression",
                command: "not-applicable",
                exitCode: 0,
                timedOut: false,
                durationMs: 0,
                stdout: "No bug reproduction was requested",
                stderr: "",
                outputTruncated: false,
              },
            ],
          }),
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );

    await expect(backend.execute(trustedRequest)).resolves.toMatchObject({
      state: "awaiting_approval",
      updates: {
        evidence: [expect.objectContaining({ approvalEligible: true })],
      },
    });
    const retained = new TextDecoder().decode(
      [...evidence.objects.values()][0],
    );
    expect(retained).toContain('"name":"bug-regression"');
  });

  it("rejects an arbitrary validation label as a binding mismatch", async () => {
    const implementation = trustedResult();
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => ({
            ...implementation,
            validation: [
              ...implementation.validation,
              {
                ...implementation.validation[0],
                name: "agent-advisory",
              },
            ],
          }),
          destroy: async () => undefined,
        }),
      },
      new MemoryEvidence(),
      "unused",
    );

    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("retains reproduced-failing then passing regression evidence", async () => {
    const requestWithReproduction: TrustedImplementationRequest = {
      ...trustedRequest,
      planning: {
        planId: `plan_${"b".repeat(40)}`,
        planSha256: "c".repeat(64),
      },
      bugReproduction: {
        applicability: "applicable",
        command: "pnpm vitest run packages/example.test.ts",
      },
    };
    const implementation = trustedResult();
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => ({
            ...implementation,
            regressionEvidence: {
              repositoryUrl: requestWithReproduction.repositoryUrl,
              baseCommit: requestWithReproduction.baseCommit,
              planId: requestWithReproduction.planning!.planId,
              planSha256: requestWithReproduction.planning!.planSha256,
              attemptId: requestWithReproduction.attemptId,
              headPatchSha256: implementation.patchSha256,
              command: "pnpm vitest run packages/example.test.ts",
              preChange: {
                outcome: "reproduced",
                summary: "The regression test failed before the change.",
                output: "1 test failed",
                outputTruncated: false,
              },
              postChange: {
                outcome: "passed",
                summary: "The regression test passed after the change.",
                output: "1 test passed",
                outputTruncated: false,
              },
            },
          }),
          destroy: async () => undefined,
        }),
      },
      new MemoryEvidence(),
      "unused",
    );

    await expect(
      backend.execute(requestWithReproduction),
    ).resolves.toMatchObject({
      state: "awaiting_approval",
      updates: {
        evidence: [expect.objectContaining({ approvalEligible: true })],
      },
    });
  });

  it("classifies trusted validation failure as non-retryable", async () => {
    let destroyed = 0;
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => {
            throw new Error(
              "Container runner /trusted/validate failed with HTTP 400: validation_failed:format[exit=1,timeout=false,truncated=false]",
            );
          },
          destroy: async () => {
            destroyed += 1;
          },
        }),
      },
      new MemoryEvidence(),
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "validation_failed",
      retryable: false,
      message: expect.stringContaining("format[exit=1"),
    });
    expect(destroyed).toBe(1);
  });

  it("retains a failed patch and complete validation diagnostics as immutable evidence", async () => {
    const evidence = new MemoryEvidence();
    const failedResult = {
      ...trustedResult(),
      validationOutcome: "failed" as const,
      validation: [
        {
          name: "format" as const,
          command: "prettier --check -- packages/example.ts",
          exitCode: 1,
          timedOut: false,
          durationMs: 12,
          stdout: "Checking formatting...",
          stderr: "packages/example.ts needs formatting",
          outputTruncated: false,
        },
      ],
    };
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => failedResult,
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );

    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "validation_failed",
      retryable: false,
      message: expect.stringContaining("packages/example.ts needs formatting"),
      evidence: [
        {
          attemptId: trustedRequest.attemptId,
          approvalEligible: false,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    });
    expect(evidence.objects.size).toBe(1);
    const retained = JSON.parse(
      new TextDecoder().decode([...evidence.objects.values()][0]),
    ) as Record<string, unknown>;
    expect(retained.patch).toBe(failedResult.patch);
    expect(JSON.stringify(retained.validation)).toContain(
      "packages/example.ts needs formatting",
    );
    expect(retained).not.toHaveProperty("publicationManifest");
  });

  it("rejects results exceeding request-scoped limits", async () => {
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => trustedResult(),
          destroy: async () => undefined,
        }),
      },
      new MemoryEvidence(),
      "unused",
    );
    await expect(
      backend.execute({ ...trustedRequest, maxPatchBytes: 1 }),
    ).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("rejects an empty trusted implementation patch", async () => {
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => ({
            ...trustedResult(),
            patch: "",
            patchSha256:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            patchBytes: 0,
          }),
          destroy: async () => undefined,
        }),
      },
      new MemoryEvidence(),
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("rejects descendants of an exact file allowlist entry", async () => {
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => ({
            ...trustedResult(),
            changedFiles: [
              "docs/dogfood/trusted-self-development-loop.md/extra.md",
            ],
          }),
          destroy: async () => undefined,
        }),
      },
      new MemoryEvidence(),
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("stores immutable patch evidence without retaining the credential", async () => {
    const evidence = new MemoryEvidence();
    const credential = '{"access_token":"credential-must-not-survive"}';
    let receivedCredential = "";
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async (_request, auth) => {
            receivedCredential = auth;
            return trustedResult();
          },
          destroy: async () => undefined,
        }),
      },
      evidence,
      credential,
    );

    const stage = await backend.execute(trustedRequest);
    expect(receivedCredential).toBe(credential);
    expect(stage).toMatchObject({
      state: "awaiting_approval",
      updates: {
        implementation: {
          patchSha256: trustedResult().patchSha256,
          changedFiles: ["docs/dogfood/trusted-self-development-loop.md"],
        },
      },
    });
    const stored = new TextDecoder().decode([...evidence.objects.values()][0]);
    expect(stored).not.toContain("credential-must-not-survive");
  });

  it("binds replay evidence to the exact retained object bytes", async () => {
    const evidence = new MemoryEvidence();
    const text = `${JSON.stringify(trustedResult(), null, 2)}\n`;
    const bytes = new TextEncoder().encode(text);
    evidence.objects.set(
      `runs/${trustedRequest.runId}/attempts/${trustedRequest.attemptId}/trusted-implementation.json`,
      bytes,
    );
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );
    const stage = await backend.execute(trustedRequest);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(stage.updates?.evidence?.[0]).toMatchObject({
      sha256: digest,
      size: bytes.byteLength,
    });
  });

  it("preserves integrity classification for corrupt existing evidence", async () => {
    const evidence = new MemoryEvidence();
    evidence.objects.set(
      `runs/${trustedRequest.runId}/attempts/${trustedRequest.attemptId}/trusted-implementation.json`,
      new TextEncoder().encode(
        JSON.stringify({ ...trustedResult(), runId: "run_wrong" }),
      ),
    );
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("classifies unparsable existing evidence as non-retryable integrity failure", async () => {
    const evidence = new MemoryEvidence();
    evidence.objects.set(
      `runs/${trustedRequest.runId}/attempts/${trustedRequest.attemptId}/trusted-implementation.json`,
      new TextEncoder().encode("{"),
    );
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
  });

  it("preserves integrity classification for corrupt raced evidence", async () => {
    const invalid = new TextEncoder().encode(
      JSON.stringify({ ...trustedResult(), runId: "run_wrong" }),
    );
    let reads = 0;
    const evidence: EvidenceBucketPort = {
      get: async () =>
        reads++ === 0
          ? null
          : { text: async () => new TextDecoder().decode(invalid) },
      put: async () => null,
    };
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async () => trustedResult(),
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );
    await expect(backend.execute(trustedRequest)).rejects.toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
    });
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

  it("allows a retry to remove an unnecessary prior edit", async () => {
    const evidence = new MemoryEvidence();
    const prior = {
      ...trustedResult(),
      validationOutcome: "failed" as const,
      validation: [
        {
          name: "format" as const,
          command:
            "prettier --check -- docs/dogfood/trusted-self-development-loop.md",
          exitCode: 1,
          timedOut: false,
          durationMs: 1,
          stdout: "",
          stderr: "formatting failed",
          outputTruncated: false,
        },
      ],
    };
    evidence.objects.set(
      `runs/${trustedRequest.runId}/attempts/${trustedRequest.attemptId}/trusted-implementation.json`,
      new TextEncoder().encode(JSON.stringify(prior)),
    );
    const retryRequest = {
      ...trustedRequest,
      attemptId: "run_trusted_container_contract-prepare-2",
      attemptNumber: 2,
      retryFromAttemptId: trustedRequest.attemptId,
      retryContext: "formatting failed",
      allowedPaths: [...trustedRequest.allowedPaths, "docs/replacement.md"],
    };
    let received: TrustedImplementationRequest | undefined;
    const backend = new CloudflareTrustedImplementationBackend(
      {
        getByName: () => ({
          runJob: async () => result(),
          runTrustedJob: async (request) => {
            received = request;
            const patch =
              "diff --git a/docs/replacement.md b/docs/replacement.md\n";
            return {
              ...trustedResult(),
              attemptId: retryRequest.attemptId,
              patch,
              patchSha256:
                "5639ab4d0391265e8ae4291f969b7ee8e7ec4a5d1189b5867d7c6ac729a9922f",
              patchBytes: new TextEncoder().encode(patch).byteLength,
              changedFiles: ["docs/replacement.md"],
              retryLineage: {
                priorAttemptId: prior.attemptId,
                priorPatchSha256: prior.patchSha256,
                priorChangedFiles: prior.changedFiles,
                retainedAllPriorPaths: false,
              },
            };
          },
          destroy: async () => undefined,
        }),
      },
      evidence,
      "unused",
    );

    await expect(backend.execute(retryRequest)).resolves.toMatchObject({
      state: "awaiting_approval",
    });
    expect(received?.retryCandidate).toEqual({
      attemptId: prior.attemptId,
      patch: prior.patch,
      patchSha256: prior.patchSha256,
      changedFiles: prior.changedFiles,
    });
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

  it("classifies malformed replay evidence as retryable", async () => {
    const evidence = new MemoryEvidence();
    evidence.objects.set(
      "runs/run_container_contract/attempts/run_container_contract-prepare-1/execution.json",
      new TextEncoder().encode("not-json"),
    );
    const backend = new CloudflareRepositoryExecutionBackend(
      {
        getByName: () => ({
          runJob: async () => {
            throw new Error("must not execute");
          },
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

  it("classifies malformed evidence after an upload race as retryable", async () => {
    let reads = 0;
    const evidence: EvidenceBucketPort = {
      get: async () => {
        reads += 1;
        return reads === 1 ? null : { text: async () => "not-json" };
      },
      put: async () => null,
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
