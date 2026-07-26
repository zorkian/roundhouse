// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  createRun,
  MemoryRunRepository,
  type AppliedProfile,
  type Wakeup,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import { coordinate } from "./coordinator.js";
import {
  resolveWorkflowContexts,
  resumeExternalWorkflowEvent,
} from "./workflow-boundaries.js";

const commit = "a".repeat(40);
const head = "b".repeat(40);

async function profileFor(node: string): Promise<AppliedProfile> {
  const workflow = await compileWorkflow(
    `version: 1
triggers:
  github.issue.started: gate
nodes:
  gate:
${node}
`,
    commit,
  );
  return {
    sourcePath: ".roundhouse/profile.yaml",
    sourceCommit: commit,
    version: 2,
    hash: "c".repeat(64),
    workflow,
    paths: { allowed: ["**"], protected: [] },
  };
}

function runWith(profile: AppliedProfile, stage: "plan" | "ci") {
  return {
    ...createRun({
      id: "run_boundary",
      repository: "zorkian/roundhouse",
      issueNumber: 1,
      baseCommit: commit,
      profileVersion: profile.hash,
      profile,
      issue: {
        title: "Boundary",
        body: "Test the boundary",
        url: "https://example.test/1",
        actor: "citizen",
      },
    }),
    stage,
    currentHead: head,
  };
}

describe("workflow boundaries", () => {
  it("waits for ordinary human prose and consumes it once on the same node", async () => {
    const profile = await profileFor(`    executor: human
    role: plan
    human:
      reason: clarification
      audience: participant
    outputs: [human.status]
    transitions:
      - when:
          path: output.human.status
          equals: answered
        terminal: succeeded
      - terminal: failed`);
    const repository = new MemoryRunRepository();
    await repository.create(runWith(profile, "plan"));
    await coordinate(
      repository,
      { submit: vi.fn() },
      { runId: "run_boundary", expectedRevision: 1 },
      1,
    );
    const waiting = await repository.get("run_boundary");
    expect(waiting).toMatchObject({
      status: "waiting",
      currentNodeId: "gate",
      waitingReason: "clarification",
    });
    const resumed = await repository.resume(
      waiting!.id,
      waiting!.revision,
      {
        ...waiting!.issue!,
        clarifications: [{ actor: "citizen", body: "Use the compact layout." }],
      },
      undefined,
      undefined,
      {
        kind: "human",
        reason: "clarification",
        actor: "citizen",
        body: "Use the compact layout.",
      },
    );
    expect(resumed?.resumeSignal).toMatchObject({
      kind: "human",
      actor: "citizen",
      body: "Use the compact layout.",
    });
    await coordinate(
      repository,
      { submit: vi.fn() },
      { runId: resumed!.id, expectedRevision: resumed!.revision },
      2,
    );
    expect(await repository.get("run_boundary")).toMatchObject({
      status: "succeeded",
      currentNodeId: "gate",
    });
    expect(
      repository.events.find(
        (event) =>
          event.kind === "workflow_boundary_audit" &&
          event.payload.kind === "human.resume",
      )?.payload,
    ).toMatchObject({
      workflowHash: profile.workflow?.hash,
      boundHead: head,
      actor: "citizen",
    });
  });

  it("resumes a typed external event durably and rejects the wrong adapter", async () => {
    const profile = await profileFor(`    executor: external.wait
    role: ci
    external:
      adapter: fake-scanner
      event: scan.completed
      result: scan
    outputs: [scan.status]
    transitions:
      - when:
          path: output.scan.status
          equals: clean
        terminal: succeeded
      - terminal: failed`);
    const repository = new MemoryRunRepository();
    await repository.create(runWith(profile, "ci"));
    await coordinate(
      repository,
      { submit: vi.fn() },
      { runId: "run_boundary", expectedRevision: 1 },
      1,
    );
    const waiting = (await repository.get("run_boundary"))!;
    const enqueue = vi.fn(async (_wakeup: Wakeup) => undefined);
    await expect(
      resumeExternalWorkflowEvent(repository, enqueue, {
        runId: waiting.id,
        expectedRevision: waiting.revision,
        adapter: "other",
        event: "scan.completed",
        actor: "scanner",
        payload: { status: "clean" },
      }),
    ).resolves.toBe("ignored");
    await expect(
      resumeExternalWorkflowEvent(repository, enqueue, {
        runId: waiting.id,
        expectedRevision: waiting.revision,
        adapter: "fake-scanner",
        event: "scan.completed",
        actor: "scanner",
        payload: { status: "clean" },
      }),
    ).resolves.toBe("resumed");
    const wakeup = enqueue.mock.calls[0]![0];
    await coordinate(repository, { submit: vi.fn() }, wakeup, 2);
    expect(await repository.get("run_boundary")).toMatchObject({
      status: "succeeded",
      currentNodeId: "gate",
    });
  });

  it("attributes context to its named provider, source, version, and bound head", async () => {
    const provider = {
      id: "architecture-index",
      resolve: vi.fn(async () => ({
        value: { rule: "Keep the boundary narrow" },
        source: "r2://context/architecture.json",
        version: "sha256:1234",
      })),
    };
    const resolved = await resolveWorkflowContexts(
      [
        {
          key: "architecture",
          provider: provider.id,
          query: "security boundary",
        },
      ],
      new Map([[provider.id, provider]]),
      {
        runId: "run_boundary",
        workflowHash: "d".repeat(64),
        nodeId: "plan",
        boundHead: head,
      },
    );
    expect(resolved.values).toEqual({
      architecture: { rule: "Keep the boundary narrow" },
    });
    expect(resolved.audit[0]).toMatchObject({
      kind: "context.resolved",
      provider: "architecture-index",
      source: "r2://context/architecture.json",
      version: "sha256:1234",
      boundHead: head,
    });
  });
});
