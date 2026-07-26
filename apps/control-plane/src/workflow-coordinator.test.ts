// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  immutableAttemptId,
  MemoryRunRepository,
  parseProfile,
  transitionRun,
  type Attempt,
} from "@roundhouse/core";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { coordinate, graphCompletedTransition } from "./coordinator.js";

const commit = "a".repeat(40);

async function workflowRun() {
  const profile = await parseProfile(
    await readFile(".roundhouse/profile.yaml", "utf8"),
    commit,
    (path) => readFile(path, "utf8"),
  );
  return createRun({
    id: "run_graph",
    repository: "zorkian/roundhouse",
    issueNumber: 1,
    baseCommit: commit,
    profileVersion: profile.hash,
    profile,
  });
}

function completed(
  run: Awaited<ReturnType<typeof workflowRun>>,
  result: Readonly<Record<string, unknown>>,
): Attempt {
  return {
    id: `${run.id}_rev_${run.revision}`,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    stage: run.stage,
    role: run.stage,
    state: "completed",
    deadlineAt: 1,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
    acceptedHead: run.currentHead,
    result,
  };
}

describe("workflow-backed coordinator transitions", () => {
  it("uses the compiled node and logs the selected structured branch", async () => {
    const run = await workflowRun();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const transition = graphCompletedTransition(
      run,
      completed(run, {
        qualification: { classification: "bug", summary: "Eligible" },
      }),
    );
    expect(transition).toMatchObject({
      status: "active",
      stage: "reproduce",
      currentNodeId: "investigate",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"message":"workflow_transition_selected"'),
    );
    log.mockRestore();
  });

  it("persists a wait on the current node and resumes its branch", async () => {
    const run = await workflowRun();
    const waiting = transitionRun(
      run,
      run.revision,
      graphCompletedTransition(
        run,
        completed(run, {
          qualification: {
            classification: "unclear",
            summary: "Need context",
          },
        }),
      ),
    );
    expect(waiting).toMatchObject({
      status: "waiting",
      stage: "qualify",
      currentNodeId: "qualify",
      waitingReason: "clarification",
    });
  });

  it("drives the existing agent journey from compiled nodes instead of stage routing", async () => {
    const store = new MemoryRunRepository();
    const initial = await workflowRun();
    await store.create(initial);
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        const acceptedHead =
          attempt.stage === "implement"
            ? "b".repeat(40)
            : attempt.stage === "integrate"
              ? "c".repeat(40)
              : attempt.expectedHead;
        const result =
          attempt.stage === "qualify"
            ? { qualification: { classification: "bug" } }
            : attempt.stage === "reproduce"
              ? { reproduction: { status: "confirmed" } }
              : attempt.stage === "plan"
                ? { plan: { status: "ready" } }
                : attempt.stage === "implement"
                  ? { implementation: { summary: "Implemented" } }
                  : attempt.stage === "integrate"
                    ? {
                        integration: {
                          status: "clean",
                          candidateHead: attempt.expectedHead,
                          baseHead: "d".repeat(40),
                          head: acceptedHead,
                        },
                      }
                    : {
                        review: {
                          status: "clean",
                          findings: [],
                          selections: [
                            {
                              role: "review-security",
                              applicable: false,
                              rationale: "No security changes",
                            },
                            {
                              role: "review-data",
                              applicable: false,
                              rationale: "No data changes",
                            },
                          ],
                        },
                      };
        await store.completeAttempt(
          attempt.id,
          attempt.runRevision,
          acceptedHead,
          result,
        );
      },
    };
    const expectedNodes = [
      "investigate",
      "plan",
      "implement",
      "review",
      "integrate",
      "checks",
    ];
    for (const expectedNode of expectedNodes) {
      const run = (await store.get(initial.id))!;
      const wakeup = { runId: run.id, expectedRevision: run.revision };
      await coordinate(store, dispatcher, wakeup, 1);
      await coordinate(store, dispatcher, wakeup, 1);
      expect(await store.get(initial.id)).toMatchObject({
        status: "active",
        currentNodeId: expectedNode,
      });
    }

    const checks = (await store.get(initial.id))!;
    const ciAttempt: Attempt = {
      id: immutableAttemptId(checks.id, checks.revision),
      runId: checks.id,
      runRevision: checks.revision,
      kind: "external",
      nodeId: checks.currentNodeId,
      executor: "github.checks",
      stage: "ci",
      role: "github-checks",
      state: "created",
      deadlineAt: 1,
      baseCommit: checks.baseCommit,
      expectedHead: checks.currentHead,
    };
    await store.createAttempt(ciAttempt);
    await store.completeAttempt(
      ciAttempt.id,
      checks.revision,
      checks.currentHead,
      { ci: { status: "success", head: checks.currentHead } },
    );
    await coordinate(
      store,
      dispatcher,
      { runId: checks.id, expectedRevision: checks.revision },
      1,
    );
    const merge = (await store.get(initial.id))!;
    expect(merge).toMatchObject({
      status: "active",
      currentNodeId: "merge",
      stage: "merge",
    });

    const mergeCommit = "e".repeat(40);
    const mergeAttempt: Attempt = {
      id: immutableAttemptId(merge.id, merge.revision),
      runId: merge.id,
      runRevision: merge.revision,
      kind: "external",
      nodeId: merge.currentNodeId,
      executor: "github.merge",
      stage: "merge",
      role: "github-merge",
      state: "created",
      deadlineAt: 1,
      baseCommit: merge.baseCommit,
      expectedHead: merge.currentHead,
    };
    await store.createAttempt(mergeAttempt);
    await store.completeAttempt(mergeAttempt.id, merge.revision, mergeCommit, {
      merge: {
        status: "merged",
        head: merge.currentHead,
        mergeCommit,
      },
    });
    await coordinate(
      store,
      dispatcher,
      { runId: merge.id, expectedRevision: merge.revision },
      1,
    );
    expect(await store.get(initial.id)).toMatchObject({
      status: "succeeded",
      currentNodeId: "merge",
      stage: "merge",
      currentHead: mergeCommit,
    });
    expect(store.events).toHaveLength(8);
    expect(store.events[0]).toMatchObject({
      runId: initial.id,
      kind: "workflow_transition",
      payload: {
        workflowHash: initial.workflowHash,
        fromNodeId: "qualify",
        toNodeId: "investigate",
        executor: "agent.read",
        inputHead: initial.baseCommit,
      },
    });
  });
});
