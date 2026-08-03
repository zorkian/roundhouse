// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createRun,
  compileWorkflow,
  defaultIssueWorkflowSource,
  MemoryRunRepository,
  type Attempt,
  type RunSnapshot,
  type RunStage,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import {
  acceptCallback,
  callbackPayload,
  CheckpointRejectedError,
  signCallback,
  type AttemptCallback,
} from "./callback.js";
import { D1RunRepository } from "./d1-store.js";
import {
  aggregateReviewAttempts,
  attemptOutcomeTransition,
  ciTransition,
  coordinate,
  effectiveAttemptCapabilities,
  graphCompletedTransition,
  implementationTransition,
  integrateTransition,
  mergeTransition,
  planTransition,
  reviewTransition,
  reproductionTransition,
} from "./coordinator.js";
import { attemptInactivityMilliseconds } from "./attempt-timeouts.js";

// Minimal D1-compatible harness backed by in-memory SQLite, mirroring
// repository-contract.test.mjs, so persistence-backed recovery behavior is
// tested against the deployed data store instead of the in-memory
// repository (which retains fields D1 drops).
class LocalD1Statement {
  values: unknown[] = [];

  constructor(private readonly statement: any) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values);
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async all() {
    return { results: this.statement.all(...this.values), meta: {} };
  }
}

class LocalD1 {
  private readonly database = new DatabaseSync(":memory:");

  constructor() {
    const migrations = new URL("../migrations/", import.meta.url);
    for (const migration of readdirSync(migrations).filter((name) =>
      name.endsWith(".sql"),
    ))
      this.database.exec(readFileSync(new URL(migration, migrations), "utf8"));
  }

  prepare(sql: string) {
    return new LocalD1Statement(this.database.prepare(sql));
  }

  async batch(statements: LocalD1Statement[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const sourceCommit = "a".repeat(40);
const workflow = await compileWorkflow(
  defaultIssueWorkflowSource,
  sourceCommit,
);
const input = {
  id: "run_slice",
  repository: "zorkian/roundhouse",
  issueNumber: 1,
  baseCommit: sourceCommit,
  profileVersion: "v2",
  profile: {
    sourcePath: ".roundhouse/profile.yaml" as const,
    sourceCommit,
    version: 1 as const,
    hash: "b".repeat(64),
    workflow,
    paths: { allowed: ["**"], protected: [".github/workflows/**"] },
  },
};
const validator = { validate: async () => undefined };

function runFixture(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return { ...createRun(input), ...overrides };
}

function attemptFixture(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: "run_slice_rev_1",
    runId: input.id,
    runRevision: 1,
    kind: "agent",
    stage: "qualify",
    role: "qualify",
    state: "completed",
    deadlineAt: 1_000,
    baseCommit: input.baseCommit,
    expectedHead: input.baseCommit,
    ...overrides,
  };
}

async function callbackFor(
  attempt: Attempt,
  head: string,
  secret: string,
  classification = "bug",
): Promise<AttemptCallback> {
  const unsigned = {
    attemptId: attempt.id,
    expectedRevision: attempt.runRevision,
    checkpoint: {
      repositoryId: "artifact-repo-id",
      repository: attempt.runId,
      baseCommit: attempt.baseCommit,
      inputHead: attempt.expectedHead,
      outputHead: head,
      ref: `refs/heads/roundhouse/${attempt.runId}`,
      changedPaths: attempt.stage === "implement" ? ["src/fix.ts"] : [],
    },
    artifactTokenId: `token-${attempt.id}`,
    result:
      attempt.stage === "reproduce"
        ? {
            outcome: "ok",
            checkpoint: head,
            reproduction: {
              status: "confirmed",
              summary: "Reproduced",
            },
          }
        : attempt.stage === "plan"
          ? {
              outcome: "ok",
              checkpoint: head,
              plan: {
                status: "ready",
                summary: "Small implementation plan",
              },
            }
          : attempt.stage === "implement"
            ? {
                outcome: "ok",
                checkpoint: head,
                implementation: {
                  summary: "Implemented the change",
                  pullRequestTitle: "Fix the behavior",
                  pullRequestBody: "Implements the requested behavior.",
                  validation: [],
                },
              }
            : attempt.stage === "review"
              ? {
                  outcome: "ok",
                  checkpoint: head,
                  review: {
                    status: "clean",
                    summary: "The candidate is correct",
                    findings: [],
                    ...(attempt.role === "review-holistic"
                      ? {
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
                        }
                      : {}),
                  },
                }
              : attempt.stage === "integrate"
                ? {
                    outcome: "ok",
                    checkpoint: head,
                    integration: {
                      status: "clean",
                      candidateHead: attempt.expectedHead,
                      baseHead: "d".repeat(40),
                      head,
                    },
                  }
                : {
                    outcome: "ok",
                    checkpoint: head,
                    qualification: {
                      classification,
                      summary:
                        classification === "bug"
                          ? "Eligible bug"
                          : "No change needed",
                    },
                  },
  };
  return {
    ...unsigned,
    signature: await signCallback(secret, callbackPayload(unsigned)),
  };
}

describe("single coordinator", () => {
  it("mints node authority and only attenuates the read-only integration review", () => {
    const investigate = workflow.nodes.investigate!;
    expect(
      effectiveAttemptCapabilities(investigate, "renamed-investigation-role"),
    ).toEqual([
      "commands.execute",
      "context.read",
      "environment.project",
      "network.project",
      "preview.capture",
      "repository.read",
      "research.public",
    ]);

    const integration = workflow.nodes.integrate!;
    expect(effectiveAttemptCapabilities(integration, "integrate")).toEqual([
      "artifact.write",
      "commands.execute",
      "repository.read",
    ]);
    expect(
      effectiveAttemptCapabilities(integration, "review-integration"),
    ).toEqual(["repository.read"]);
  });

  it("reconciles a superseded branch through implementation and invalidates stale gates", () => {
    const observedHead = "e".repeat(40);
    const run = runFixture({
      stage: "integrate",
      currentNodeId: "integrate",
      currentHead: "d".repeat(40),
      candidateHead: "b".repeat(40),
      reviewedHead: "b".repeat(40),
      targetBaseHead: "c".repeat(40),
      integrationHead: "d".repeat(40),
    });
    const attempt = attemptFixture({
      id: "run_slice_rev_6",
      runRevision: run.revision,
      nodeId: "integrate",
      executor: "validate",
      stage: "integrate",
      role: "integrate",
      capabilities: workflow.nodes.integrate!.capabilities,
      expectedHead: run.currentHead,
      acceptedHead: observedHead,
      outcome: {
        kind: "branch_superseded",
        source: "checkpoint_publisher",
        status: 409,
        detail: `publish_branch_changed:${observedHead}`,
        observedHead,
      },
    });

    expect(attemptOutcomeTransition(run, attempt)).toEqual({
      status: "active",
      stage: "implement",
      currentNodeId: "implement",
      acceptedHead: observedHead,
      heads: {
        candidateHead: observedHead,
        reviewedHead: null,
        targetBaseHead: null,
        integrationHead: null,
      },
    });
  });

  it("fails a holistic review that omits a specialist decision", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 5,
      stage: "review",
      currentNodeId: "review",
      currentHead: "b".repeat(40),
    });
    await store.create(run);
    store.attempts.set("holistic", {
      id: "holistic",
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review-holistic",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          summary: "Looks good",
          findings: [],
          selections: [
            {
              role: "review-security",
              applicable: false,
              rationale: "No security changes",
            },
          ],
        },
      },
    });

    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 5 },
        100,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "failed",
      stage: "review",
    });
  });

  it("does not dispatch a conditional reviewer that was not selected", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 5,
      stage: "review",
      currentNodeId: "review",
      currentHead: "b".repeat(40),
    });
    await store.create(run);
    store.attempts.set("holistic", {
      id: "holistic",
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review-holistic",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          summary: "Looks good",
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
      },
    });
    const submit = vi.fn(async () => undefined);
    await expect(
      coordinate(
        store,
        { submit },
        { runId: input.id, expectedRevision: 5 },
        100,
      ),
    ).resolves.toBe("dispatched");
    expect(submit).not.toHaveBeenCalled();
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
    });
  });

  it("blocks only findings at a reviewer's configured severities", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 5,
      stage: "review",
      currentNodeId: "review",
      currentHead: "b".repeat(40),
    });
    await store.create(run);
    const reviewAttempt = (
      id: string,
      role: "review-holistic" | "review-security",
      review: Record<string, unknown>,
    ): Attempt => ({
      id,
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: { review },
    });
    store.attempts.set(
      "holistic",
      reviewAttempt("holistic", "review-holistic", {
        status: "clean",
        findings: [],
        selections: [
          {
            role: "review-security",
            applicable: true,
            rationale: "Authorization changed",
          },
          {
            role: "review-data",
            applicable: false,
            rationale: "No data changes",
          },
        ],
      }),
    );
    store.attempts.set(
      "security",
      reviewAttempt("security", "review-security", {
        status: "clean",
        findings: [
          {
            title: "Minor note",
            details: "Non-blocking issue",
            file: "src/auth.ts",
            severity: "low",
          },
          {
            title: "Authorization bypass",
            details: "Missing permission check",
            file: "src/auth.ts",
            severity: "high",
          },
        ],
      }),
    );

    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 5 },
      100,
    );
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
    });
  });

  it("does not aggregate when any required review is for another head", () => {
    const currentHead = "b".repeat(40);
    const staleHead = "c".repeat(40);
    const reviewAttempt = (
      role: "review-holistic" | "review-security",
      expectedHead: string,
      review: Record<string, unknown>,
    ): Attempt => ({
      id: role,
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead,
      acceptedHead: expectedHead,
      result: { review },
    });
    const holistic = reviewAttempt("review-holistic", staleHead, {
      status: "clean",
      findings: [],
      selections: [
        {
          role: "review-security",
          applicable: true,
          rationale: "Authorization changed",
        },
        {
          role: "review-data",
          applicable: false,
          rationale: "No data changes",
        },
      ],
    });
    const security = reviewAttempt("review-security", currentHead, {
      status: "clean",
      findings: [],
    });

    expect(aggregateReviewAttempts([holistic, security])).toBeUndefined();
  });

  it("claims exactly one revision-bound attempt for duplicate wakeups", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    const submitted: Attempt[] = [];
    const dispatch = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    await expect(
      coordinate(
        store,
        dispatch,
        { runId: input.id, expectedRevision: 1 },
        100,
      ),
    ).resolves.toBe("dispatched");
    await expect(
      coordinate(
        store,
        dispatch,
        { runId: input.id, expectedRevision: 1 },
        101,
      ),
    ).resolves.toBe("duplicate");
    expect(submitted).toHaveLength(1);
  });

  it("rejects stale wakeups and makes fully signed duplicate callbacks harmless", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 2 },
        100,
      ),
    ).resolves.toBe("stale");
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "attempt-specific-secret",
    );
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, callback),
    ).resolves.toBe("completed");
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, callback),
    ).resolves.toBe("duplicate");
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, {
        ...callback,
        result: { outcome: "tampered" },
      }),
    ).resolves.toBe("unauthorized");
  });

  it("routes a deterministically rejected checkpoint back through the coordinator", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "checkpoint-rejection-secret",
    );
    await expect(
      acceptCallback(
        store,
        "checkpoint-rejection-secret",
        {
          validate: async () => {
            throw new CheckpointRejectedError(
              422,
              '{"error":"invalid_checkpoint","detail":"protected_path_changed"}',
            );
          },
        },
        callback,
      ),
    ).resolves.toBe("rejected");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 1,
    });
    await expect(store.getAttempt(attempt.id)).resolves.toMatchObject({
      state: "completed",
      outcome: {
        kind: "checkpoint_rejected",
        source: "checkpoint_validator",
        status: 422,
        detail:
          '{"error":"invalid_checkpoint","detail":"protected_path_changed"}',
      },
    });
    await expect(
      acceptCallback(
        store,
        "checkpoint-rejection-secret",
        { validate: async () => undefined },
        callback,
      ),
    ).resolves.toBe("duplicate");
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      currentNodeId: "qualify",
      revision: 2,
    });
  });

  it("leaves transient checkpoint validation failures recoverable", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "transient-validation-secret",
    );
    await expect(
      acceptCallback(
        store,
        "transient-validation-secret",
        {
          validate: async () => {
            throw new Error("checkpoint_validator_unavailable");
          },
        },
        callback,
      ),
    ).rejects.toThrow("checkpoint_validator_unavailable");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 1,
    });
    await expect(store.getAttempt(attempt.id)).resolves.toMatchObject({
      state: "dispatched",
    });
  });

  it("recovers callback loss and interruption through lease expiry", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let dispatches = 0;
    const dispatcher = {
      submit: async () => {
        dispatches += 1;
      },
    };
    await coordinate(
      store,
      dispatcher,
      { runId: input.id, expectedRevision: 1 },
      100,
      50,
    );
    await expect(store.expiredLeases(149)).resolves.toEqual([]);
    await expect(store.expiredLeases(150)).resolves.toEqual([
      { runId: input.id, expectedRevision: 1 },
    ]);
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 1 },
        150,
        50,
      ),
    ).resolves.toBe("dispatched");
    expect(dispatches).toBe(2);
  });

  it("releases a failed dispatch for the existing queue retry", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let dispatches = 0;
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            dispatches += 1;
            throw new Error("lost_response");
          },
        },
        { runId: input.id, expectedRevision: 1 },
        100,
      ),
    ).rejects.toThrow("lost_response");
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "created",
    });
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            dispatches += 1;
          },
        },
        { runId: input.id, expectedRevision: 1 },
        101,
      ),
    ).resolves.toBe("dispatched");
    expect(dispatches).toBe(2);
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "dispatched",
      deadlineAt: 101 + attemptInactivityMilliseconds,
    });
  });

  it("reports an implementation start only after a durable dispatch", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 4,
      stage: "implement",
      currentNodeId: "implement",
    });
    await store.create(run);
    const order: string[] = [];
    const markDispatched = store.markDispatched.bind(store);
    store.markDispatched = async (attemptId: string) => {
      order.push("markDispatched");
      await markDispatched(attemptId);
    };
    const started: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            order.push("submit");
          },
        },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
            order.push("reportStarted");
            started.push(attempt);
          },
        },
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched", "reportStarted"]);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      id: "run_slice_rev_4",
      stage: "implement",
      role: "implement",
    });
  });

  it("does not report a start for earlier-stage dispatches", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let started = 0;
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).resolves.toBe("dispatched");
    expect(started).toBe(0);
  });

  it("does not report a start when implementation submission fails", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 4,
      stage: "implement",
      currentNodeId: "implement",
    });
    await store.create(run);
    let started = 0;
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            throw new Error("lost_response");
          },
        },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).rejects.toThrow("lost_response");
    expect(started).toBe(0);
  });

  it("does not report a start when durable dispatch marking fails", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 4,
      stage: "implement",
      currentNodeId: "implement",
    });
    await store.create(run);
    store.markDispatched = async () => {
      throw new Error("store_unavailable");
    };
    let started = 0;
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).rejects.toThrow("store_unavailable");
    expect(started).toBe(0);
  });

  it("retries a lost start report on the next wakeup without redispatching", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 4,
      stage: "implement",
      currentNodeId: "implement",
    });
    await store.create(run);
    let submitted = 0;
    const dispatcher = {
      submit: async () => {
        submitted += 1;
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        coordinate(
          store,
          dispatcher,
          { runId: input.id, expectedRevision: 4 },
          100,
          50,
          {
            report: async () => undefined,
            reportStarted: async () => {
              throw new Error("github_unavailable");
            },
          },
        ),
      ).resolves.toBe("dispatched");
    } finally {
      log.mockRestore();
    }
    const started: Attempt[] = [];
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 4 },
        101,
        50,
        {
          report: async () => undefined,
          reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
            started.push(attempt);
          },
        },
      ),
    ).resolves.toBe("duplicate");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      id: "run_slice_rev_4",
      stage: "implement",
      state: "dispatched",
    });
    expect(submitted).toBe(1);
  });

  it("resumes a created handoff instead of waiting for its lease to expire", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 4,
      stage: "implement",
      currentNodeId: "implement",
    });
    await store.create(run);
    await store.createAttempt({
      id: "run_slice_rev_4",
      runId: input.id,
      runRevision: 4,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "created",
      deadlineAt: 150,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    });
    await store.claimLease(
      input.id,
      4,
      { attemptId: "run_slice_rev_4", runRevision: 4, expiresAt: 150 },
      100,
    );
    let submitted = 0;
    let started = 0;
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            submitted += 1;
          },
        },
        { runId: input.id, expectedRevision: 4 },
        101,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).resolves.toBe("dispatched");
    expect(submitted).toBe(1);
    expect(started).toBe(1);
    await expect(store.getAttempt("run_slice_rev_4")).resolves.toMatchObject({
      state: "dispatched",
    });
    expect(
      store.events
        .filter(({ kind }) => kind === "attempt_dispatch_resume")
        .map(({ payload }) => payload.phase),
    ).toEqual([
      "created_attempt_dispatch_resume_started",
      "created_attempt_dispatch_resume_completed",
    ]);
  });

  it("reports a holistic review start after dispatch but stays silent for specialists", async () => {
    const store = new MemoryRunRepository();
    const run = runFixture({
      revision: 5,
      stage: "review",
      currentNodeId: "review",
      currentHead: "b".repeat(40),
    });
    await store.create(run);
    const order: string[] = [];
    const markDispatched = store.markDispatched.bind(store);
    store.markDispatched = async (attemptId: string) => {
      order.push("markDispatched");
      await markDispatched(attemptId);
    };
    const started: Attempt[] = [];
    const reporter = {
      report: async () => undefined,
      reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
        order.push("reportStarted");
        started.push(attempt);
      },
    };
    const dispatcher = {
      submit: async () => {
        order.push("submit");
      },
    };
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        100,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched", "reportStarted"]);
    expect(started.map((attempt) => attempt.role)).toEqual(["review-holistic"]);
    const holistic = await store.getAttempt("run_slice_rev_5_review-holistic");
    if (!holistic) throw new Error("missing_attempt");
    store.attempts.set(holistic.id, {
      ...holistic,
      state: "completed",
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          findings: [],
          selections: [
            {
              role: "review-security",
              applicable: true,
              rationale: "Authorization changed",
            },
            {
              role: "review-data",
              applicable: false,
              rationale: "No data changes",
            },
          ],
        },
      },
    });
    order.length = 0;
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        200,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched"]);
    expect(started).toHaveLength(1);
    await expect(
      store.getAttempt("run_slice_rev_5_review-security"),
    ).resolves.toMatchObject({ state: "dispatched" });
  });

  it("advances a recorded qualification only through the coordinator", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "callback-retry-secret",
    );
    await acceptCallback(store, "callback-retry-secret", validator, callback);
    await expect(
      acceptCallback(store, "callback-retry-secret", validator, callback),
    ).resolves.toBe("duplicate");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "qualify",
      revision: 1,
    });
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "reproduce",
      revision: 2,
    });
  });

  it("requalifies a reopened no-change conclusion on a distinct attempt", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const first = await store.getAttempt("run_slice_rev_1");
    if (!first) throw new Error("missing_attempt");
    await acceptCallback(
      store,
      "reopen-secret",
      validator,
      await callbackFor(first, input.baseCommit, "reopen-secret", "duplicate"),
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "succeeded",
      stage: "qualify",
      revision: 2,
    });

    const reopened = await store.resume(input.id, 2, {
      title: "Report",
      body: "Details",
      url: "https://github.com/zorkian/roundhouse/issues/1",
      actor: "reporter",
      clarifications: [{ actor: "citizen", body: "This is not a duplicate." }],
    });
    if (!reopened) throw new Error("reopen_failed");

    const submitted: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async (attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 3 },
        300,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      id: "run_slice_rev_3",
      runRevision: 3,
      stage: "qualify",
    });

    // The prior completed attempt remains queryable behind the new revision.
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "completed",
    });
    await expect(
      store.latestCompletedAttempt(input.id, "qualify", 3),
    ).resolves.toMatchObject({ id: "run_slice_rev_1", runRevision: 1 });
  });

  it("does not hold workflow progress behind GitHub reporting", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    await acceptCallback(
      store,
      "report-retry-secret",
      validator,
      await callbackFor(attempt, input.baseCommit, "report-retry-secret"),
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
        50,
        {
          report: async () => {
            throw new Error("github_response_lost");
          },
        },
      ),
    ).rejects.toThrow("github_response_lost");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "reproduce",
      revision: 2,
    });
  });

  it("maps reproduction evidence to explicit lifecycle outcomes", () => {
    const attempt = attemptFixture({
      id: "run_slice_rev_2",
      runRevision: 2,
      stage: "reproduce",
      role: "reproduce",
    });
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "confirmed" } },
      }),
    ).toEqual({ status: "active", stage: "plan" });
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "not_reproduced" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    });
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "blocked" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    });
  });

  it("maps planning to implementation or another prose clarification", () => {
    const attempt = attemptFixture({
      id: "run_slice_rev_3",
      runRevision: 3,
      stage: "plan",
      role: "plan",
    });
    expect(
      planTransition({
        ...attempt,
        result: { plan: { status: "ready" } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(
      planTransition({
        ...attempt,
        result: { plan: { status: "needs_clarification" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "plan",
      waitingReason: "clarification",
    });
  });

  it("reviews the validated implementation checkpoint next", () => {
    const head = "b".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_4",
      runRevision: 4,
      stage: "implement",
      role: "implement",
      acceptedHead: head,
      result: { implementation: { summary: "Done" } },
    });
    expect(implementationTransition(attempt)).toEqual({
      status: "active",
      stage: "review",
      acceptedHead: head,
      heads: { candidateHead: head },
    });
  });

  it("completes screenshot-only implementation without empty review and CI work", () => {
    const head = "b".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_4",
      runRevision: 4,
      stage: "implement",
      role: "implement",
      expectedHead: head,
      acceptedHead: head,
      result: {
        implementation: {
          summary: "Visual verification complete",
          screenshots: [{ url: "https://example.test/screenshot" }],
        },
      },
    });
    expect(implementationTransition(attempt)).toEqual({
      status: "succeeded",
      stage: "implement",
      acceptedHead: head,
    });
  });

  it("routes a changed screenshot candidate to operator visual feedback", () => {
    const inputHead = "a".repeat(40);
    const outputHead = "b".repeat(40);
    const run = runFixture({
      status: "active",
      stage: "implement",
      currentNodeId: "implement",
      currentHead: inputHead,
      revision: 4,
    });
    const attempt = attemptFixture({
      id: "run_slice_rev_4",
      runRevision: 4,
      stage: "implement",
      role: "implement",
      expectedHead: inputHead,
      acceptedHead: outputHead,
      result: {
        implementation: {
          summary: "Adjusted the mobile layout",
          screenshots: [
            { url: "https://example.test/before", description: "Before" },
            { url: "https://example.test/after", description: "After" },
          ],
        },
      },
    });
    expect(graphCompletedTransition(run, attempt)).toEqual({
      status: "active",
      stage: "review",
      currentNodeId: "approval",
      acceptedHead: outputHead,
      heads: { candidateHead: outputHead },
    });
  });

  it("returns screenshot evidence to review when a candidate already exists", () => {
    const head = "b".repeat(40);
    const run = runFixture({
      status: "active",
      stage: "implement",
      currentNodeId: "implement",
      currentHead: head,
      candidateHead: head,
      revision: 12,
    });
    const attempt = attemptFixture({
      id: "run_slice_rev_12",
      runRevision: 12,
      stage: "implement",
      role: "implement",
      expectedHead: head,
      acceptedHead: head,
      result: {
        implementation: {
          summary: "Added the requested visual evidence",
          screenshots: [{ url: "https://example.test/screenshot" }],
        },
      },
    });

    expect(graphCompletedTransition(run, attempt)).toEqual({
      status: "active",
      stage: "review",
      currentNodeId: "review",
      acceptedHead: head,
    });
  });

  it("advances a clean review to integration and returns findings to implementation", () => {
    const attempt = attemptFixture({
      id: "run_slice_rev_5",
      runRevision: 5,
      stage: "review",
      role: "review",
      expectedHead: "b".repeat(40),
    });
    expect(
      reviewTransition({
        ...attempt,
        result: { review: { status: "clean", findings: [] } },
      }),
    ).toEqual({
      status: "active",
      stage: "integrate",
      heads: {
        reviewedHead: "b".repeat(40),
        targetBaseHead: null,
        integrationHead: null,
      },
    });
    expect(
      reviewTransition({
        ...attempt,
        result: {
          review: {
            status: "changes_requested",
            findings: [{ title: "Regression" }],
          },
        },
      }),
    ).toEqual({ status: "active", stage: "implement" });
  });

  it("integrates a reviewed candidate with the selected base", () => {
    const candidate = "b".repeat(40);
    const base = "d".repeat(40);
    const integration = "e".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_6",
      runRevision: 6,
      stage: "integrate",
      role: "integrate",
      expectedHead: candidate,
      acceptedHead: integration,
      result: {
        integration: {
          status: "clean",
          candidateHead: candidate,
          baseHead: base,
          head: integration,
        },
      },
    });
    expect(integrateTransition(attempt)).toEqual({
      status: "active",
      stage: "ci",
      acceptedHead: integration,
      heads: { targetBaseHead: base, integrationHead: integration },
    });
    expect(
      integrateTransition({
        ...attempt,
        acceptedHead: candidate,
        result: {
          integration: {
            status: "conflict",
            candidateHead: candidate,
            baseHead: base,
            conflicts: [{ path: "src/route.ts", hunks: "@@" }],
          },
        },
      }),
    ).toEqual({
      status: "active",
      stage: "integrate",
      heads: { targetBaseHead: base, integrationHead: null },
    });
    expect(
      integrateTransition({
        ...attempt,
        result: {
          integration: { status: "clean", baseHead: base, head: candidate },
        },
      }),
    ).toEqual({ status: "failed", stage: "integrate" });
  });

  it("dispatches mechanical integration without a model and conflict resolution exactly once", async () => {
    const store = new MemoryRunRepository();
    const candidate = "b".repeat(40);
    const base = "d".repeat(40);
    const resolved = "e".repeat(40);
    await store.create(
      runFixture({
        revision: 6,
        stage: "integrate",
        currentNodeId: "integrate",
        currentHead: candidate,
        candidateHead: candidate,
        reviewedHead: candidate,
      }),
    );
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    // Mechanical integration is dispatched for the reviewed candidate.
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 6 },
        100,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted[0]).toMatchObject({
      role: "integrate",
      stage: "integrate",
      expectedHead: candidate,
    });
    // A duplicate wakeup does not dispatch a second integration attempt.
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 6 },
        101,
      ),
    ).resolves.toBe("duplicate");
    expect(submitted).toHaveLength(1);
    // A conflicted mechanical merge keeps the run in integration and routes
    // the next wakeup to one narrowly scoped conflict-resolution attempt.
    await store.completeAttempt(submitted[0]!.id, 6, candidate, {
      integration: {
        status: "conflict",
        candidateHead: candidate,
        baseHead: base,
        conflicts: [{ path: "src/route.ts", hunks: "@@" }],
      },
    });
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 6 },
      102,
    );
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 7,
      targetBaseHead: base,
      reviewedHead: candidate,
    });
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 7 },
        103,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted[1]).toMatchObject({
      role: "conflict-resolution",
      stage: "integrate",
      expectedHead: candidate,
    });
    // The resolved integration commit stays in integration with every
    // identity bound until its conflict-resolution delta is reviewed.
    await store.completeAttempt(submitted[1]!.id, 7, resolved, {
      integration: {
        status: "clean",
        candidateHead: candidate,
        baseHead: base,
        head: resolved,
        resolution: {
          summary: "Resolved",
          resolvedFiles: ["src/route.ts"],
          validation: [],
        },
      },
    });
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 7 },
      104,
    );
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 8,
      currentHead: resolved,
      candidateHead: candidate,
      reviewedHead: candidate,
      targetBaseHead: base,
      integrationHead: resolved,
    });
    // The next wakeup dispatches the integration-delta review against the
    // resolved integration head; the candidate review is not rerun.
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 8 },
        105,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted[2]).toMatchObject({
      role: "review-integration",
      stage: "integrate",
      expectedHead: resolved,
    });
    await store.completeAttempt(submitted[2]!.id, 8, resolved, {
      review: { status: "clean", findings: [] },
    });
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 8 },
      106,
    );
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "ci",
      revision: 9,
      currentHead: resolved,
      candidateHead: candidate,
      reviewedHead: candidate,
      targetBaseHead: base,
      integrationHead: resolved,
    });
    expect(submitted).toHaveLength(3);
  });

  it("does not reuse an older integration cycle when a reviewed candidate re-enters integration", async () => {
    const store = new MemoryRunRepository();
    const candidate = "b".repeat(40);
    const oldBase = "d".repeat(40);
    const oldResolution = "e".repeat(40);
    await store.create(
      runFixture({
        revision: 12,
        stage: "integrate",
        currentNodeId: "integrate",
        currentHead: candidate,
        candidateHead: candidate,
        reviewedHead: candidate,
        targetBaseHead: undefined,
        integrationHead: undefined,
      }),
    );
    await store.createAttempt({
      id: "run_slice_rev_8",
      runId: input.id,
      runRevision: 8,
      kind: "agent",
      stage: "integrate",
      role: "conflict-resolution",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: oldBase,
      expectedHead: candidate,
    });
    await store.completeAttempt("run_slice_rev_8", 8, oldResolution, {
      integration: {
        status: "clean",
        candidateHead: candidate,
        baseHead: oldBase,
        head: oldResolution,
      },
    });
    await store.createAttempt({
      id: "run_slice_rev_9",
      runId: input.id,
      runRevision: 9,
      kind: "agent",
      stage: "integrate",
      role: "review-integration",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: oldBase,
      expectedHead: oldResolution,
    });
    await store.completeAttempt("run_slice_rev_9", 9, oldResolution, {
      review: {
        status: "changes_requested",
        findings: [{ title: "Old integration finding" }],
      },
    });
    const submitted: Attempt[] = [];

    await expect(
      coordinate(
        store,
        {
          submit: async (attempt: Attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 12 },
        100,
      ),
    ).resolves.toBe("dispatched");

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      role: "integrate",
      baseCommit: input.baseCommit,
      expectedHead: candidate,
    });
    expect(
      store.events.some(
        (event) =>
          event.kind === "integration_role_selected" &&
          event.payload.reason === "mechanical_integration_required",
      ),
    ).toBe(true);
  });

  it("rejects integration results with mismatched candidate or base identities", () => {
    const candidate = "b".repeat(40);
    const published = "c".repeat(40);
    const base = "d".repeat(40);
    const resolved = "e".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_7",
      runRevision: 7,
      stage: "integrate",
      role: "conflict-resolution",
      baseCommit: base,
      expectedHead: candidate,
      acceptedHead: resolved,
      result: {
        integration: {
          status: "clean",
          candidateHead: candidate,
          baseHead: base,
          head: resolved,
        },
      },
    });
    expect(integrateTransition(attempt)).toEqual({
      status: "active",
      stage: "integrate",
      acceptedHead: resolved,
      heads: { targetBaseHead: base, integrationHead: resolved },
    });
    // Reintegration may check out a prior published/resolution tip while still
    // advertising the reviewed candidate identity for role selection.
    expect(
      integrateTransition({
        ...attempt,
        expectedHead: published,
        result: {
          integration: {
            status: "clean",
            candidateHead: candidate,
            baseHead: base,
            head: resolved,
          },
        },
      }),
    ).toEqual({
      status: "active",
      stage: "integrate",
      acceptedHead: resolved,
      heads: { targetBaseHead: base, integrationHead: resolved },
    });
    // A conflict resolution without a concrete candidate identity is stale.
    expect(
      integrateTransition({
        ...attempt,
        result: {
          integration: {
            status: "clean",
            baseHead: base,
            head: resolved,
          },
        },
      }),
    ).toEqual({ status: "failed", stage: "integrate" });
    // A conflict resolution that reports a base other than the selected
    // target base carried on the attempt is stale.
    expect(
      integrateTransition({
        ...attempt,
        result: {
          integration: {
            status: "clean",
            candidateHead: candidate,
            baseHead: "9".repeat(40),
            head: resolved,
          },
        },
      }),
    ).toEqual({ status: "failed", stage: "integrate" });
    // A failed integration-delta review returns to conflict resolution, not
    // to general implementation.
    expect(
      integrateTransition({
        ...attempt,
        role: "review-integration",
        expectedHead: resolved,
        acceptedHead: resolved,
        result: {
          review: {
            status: "changes_requested",
            findings: [{ title: "Bad resolution" }],
          },
        },
      }),
    ).toEqual({
      status: "active",
      stage: "integrate",
      heads: { integrationHead: null },
    });
    expect(
      integrateTransition({
        ...attempt,
        role: "review-integration",
        expectedHead: resolved,
        acceptedHead: resolved,
        result: { review: { status: "clean", findings: [] } },
      }),
    ).toEqual({
      status: "active",
      stage: "ci",
      acceptedHead: resolved,
      heads: { integrationHead: resolved },
    });
  });

  it("advances a reintegration conflict resolution to delta review using the reviewed candidate identity", async () => {
    const store = new MemoryRunRepository();
    const candidate = "b".repeat(40);
    const published = "c".repeat(40);
    const base = "d".repeat(40);
    const resolved = "e".repeat(40);
    // Simulate the post-transition state after conflict resolution checked out
    // a prior published tip but recorded the reviewed candidate identity.
    await store.create(
      runFixture({
        revision: 12,
        stage: "integrate",
        currentNodeId: "integrate",
        currentHead: resolved,
        candidateHead: candidate,
        reviewedHead: candidate,
        targetBaseHead: base,
        integrationHead: resolved,
      }),
    );
    await store.createAttempt({
      id: "run_slice_rev_11",
      runId: input.id,
      runRevision: 11,
      kind: "agent",
      stage: "integrate",
      role: "conflict-resolution",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: base,
      expectedHead: published,
      acceptedHead: resolved,
      result: {
        integration: {
          status: "clean",
          candidateHead: candidate,
          baseHead: base,
          head: resolved,
          resolution: {
            summary: "Resolved",
            resolvedFiles: ["src/route.ts"],
            validation: [],
          },
        },
      },
    });
    const submitted: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async (attempt: Attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 12 },
        101,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      role: "review-integration",
      stage: "integrate",
      expectedHead: resolved,
    });
    expect(
      store.events.some(
        (event) =>
          event.kind === "integration_role_selected" &&
          event.payload.reason === "current_conflict_resolution_completed",
      ),
    ).toBe(true);
  });

  it("retries mechanical integration against a moved base without repeating earlier stages", async () => {
    const store = new MemoryRunRepository();
    const candidate = "b".repeat(40);
    await store.create(
      runFixture({
        revision: 8,
        stage: "integrate",
        currentNodeId: "integrate",
        currentHead: candidate,
        candidateHead: candidate,
        reviewedHead: candidate,
        targetBaseHead: "d".repeat(40),
      }),
    );
    // The previous integration generation completed cleanly against an older
    // base; a moved base retries the no-model mechanical merge, not conflict
    // resolution or general implementation.
    await store.createAttempt({
      id: "run_slice_rev_6",
      runId: input.id,
      runRevision: 6,
      kind: "agent",
      stage: "integrate",
      role: "integrate",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: candidate,
    });
    await store.completeAttempt("run_slice_rev_6", 6, "e".repeat(40), {
      integration: {
        status: "clean",
        candidateHead: candidate,
        baseHead: "d".repeat(40),
        head: "e".repeat(40),
      },
    });
    const submitted: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async (attempt: Attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 8 },
        100,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted[0]).toMatchObject({
      role: "integrate",
      stage: "integrate",
      expectedHead: candidate,
    });
  });

  it("resolves a reintegration conflict from the published branch head", async () => {
    const store = new MemoryRunRepository();
    const reviewed = "b".repeat(40);
    const published = "e".repeat(40);
    const movedBase = "f".repeat(40);
    await store.create(
      runFixture({
        revision: 10,
        stage: "integrate",
        currentNodeId: "integrate",
        currentHead: published,
        candidateHead: reviewed,
        reviewedHead: reviewed,
        targetBaseHead: movedBase,
      }),
    );
    await store.createAttempt({
      id: "run_slice_rev_9",
      runId: input.id,
      runRevision: 9,
      kind: "agent",
      stage: "integrate",
      role: "integrate",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: reviewed,
      acceptedHead: reviewed,
      result: {
        integration: {
          status: "conflict",
          candidateHead: reviewed,
          baseHead: movedBase,
          conflicts: [{ path: "src/route.ts", hunks: "@@" }],
        },
      },
    });
    const submitted: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async (attempt: Attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 10 },
        100,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted[0]).toMatchObject({
      role: "conflict-resolution",
      stage: "integrate",
      baseCommit: movedBase,
      expectedHead: published,
    });
  });

  it("requires exact successful CI before merge", () => {
    const head = "b".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_6",
      runRevision: 6,
      kind: "external",
      stage: "ci",
      role: "github-checks",
      expectedHead: head,
      acceptedHead: head,
      result: { ci: { status: "success", head } },
    });
    expect(ciTransition(attempt)).toEqual({
      status: "active",
      stage: "merge",
      acceptedHead: head,
    });
    expect(
      ciTransition({
        ...attempt,
        result: { ci: { status: "failure", head } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(
      ciTransition({
        ...attempt,
        result: {
          ci: {
            status: "failure",
            head,
            reason: "diagnostics_unavailable",
            diagnosticsError: "github_get_404",
          },
        },
      }),
    ).toEqual({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
    });
    expect(
      ciTransition({
        ...attempt,
        result: {
          ci: { status: "failure", head, reason: "evidence_consumed" },
        },
      }),
    ).toEqual({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
    });
    expect(
      ciTransition({
        ...attempt,
        result: { ci: { status: "failure", head, reason: "base_conflict" } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(ciTransition({ ...attempt, acceptedHead: "c".repeat(40) })).toEqual({
      status: "failed",
      stage: "ci",
    });
  });

  it("records the merge commit as the terminal run head", () => {
    const mergeCommit = "c".repeat(40);
    const attempt = attemptFixture({
      id: "run_slice_rev_7",
      runRevision: 7,
      kind: "external",
      stage: "merge",
      role: "github-merge",
      expectedHead: "b".repeat(40),
      acceptedHead: mergeCommit,
      result: {
        merge: { status: "merged", head: "b".repeat(40), mergeCommit },
      },
    });
    expect(mergeTransition(attempt)).toEqual({
      status: "succeeded",
      stage: "merge",
      acceptedHead: mergeCommit,
    });
  });

  it("runs qualification through exact-commit review before CI", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    const wakeups = [{ runId: input.id, expectedRevision: 1 }];
    const stages: RunStage[] = [];
    let previousHead = input.baseCommit;
    while (wakeups.length) {
      const wakeup = wakeups.shift();
      if (!wakeup) break;
      let dispatched: Attempt | undefined;
      await coordinate(
        store,
        {
          submit: async (attempt) => {
            dispatched = attempt;
            stages.push(attempt.stage);
          },
        },
        wakeup,
        wakeup.expectedRevision * 100,
      );
      if (!dispatched) throw new Error("attempt_not_dispatched");
      expect(dispatched.expectedHead).toBe(previousHead);
      const outputHead =
        dispatched.stage === "implement"
          ? "b".repeat(40)
          : dispatched.stage === "integrate"
            ? "c".repeat(40)
            : previousHead;
      const callback = await callbackFor(
        dispatched,
        outputHead,
        "journey-secret",
      );
      await acceptCallback(store, "journey-secret", validator, callback);
      await coordinate(store, { submit: async () => undefined }, wakeup, 200);
      previousHead = outputHead;
      const current = await store.get(input.id);
      if (
        current?.status === "active" &&
        new Set(["reproduce", "plan", "implement", "review", "integrate"]).has(
          current.stage,
        )
      )
        wakeups.push({ runId: current.id, expectedRevision: current.revision });
    }
    expect(stages).toEqual([
      "qualify",
      "reproduce",
      "plan",
      "implement",
      "review",
      "integrate",
    ]);
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "ci",
      revision: 7,
      currentHead: "c".repeat(40),
      candidateHead: "b".repeat(40),
      reviewedHead: "b".repeat(40),
      targetBaseHead: "d".repeat(40),
      integrationHead: "c".repeat(40),
    });
  });
});

describe("model competitions", () => {
  const competitionWorkflowSource = `
version: 1
triggers:
  github.issue.started: qualify
nodes:
  qualify:
    executor: agent.read
    role: qualify
    agent:
      task: qualification
      inputs:
        issue: trigger.issue
      result:
        key: qualification
        schema: roundhouse.qualification.v1
      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: anthropic/claude-beta, reasoning: medium }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }
    capabilities:
      - repository.read
      - context.read
    outputs:
      - qualification.classification
    transitions:
      - when:
          path: output.qualification.classification
          equals: bug
        terminal: succeeded
      - terminal: failed
`;
  const competitionInput = async () => {
    const competitionWorkflow = await compileWorkflow(
      competitionWorkflowSource,
      sourceCommit,
    );
    return {
      ...input,
      id: "run_competition",
      profile: { ...input.profile, workflow: competitionWorkflow },
    };
  };
  const qualificationResult = (summary: string) => ({
    qualification: {
      classification: "bug",
      summary,
      acceptanceCriteria: [],
      uncertainties: [],
      sources: [],
    },
  });
  const judgement = (selected = "alpha") => ({
    judgement: {
      selected,
      scores: [
        { candidateId: "alpha", score: 9, rationale: "Stronger analysis" },
        { candidateId: "beta", score: 6, rationale: "Weaker analysis" },
      ],
    },
  });

  it("fans out candidates with identical bindings, judges, and promotes only the winner", async () => {
    const competition = await competitionInput();
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    const promoted: { winner: Attempt; judgement: unknown }[] = [];
    const promoter = {
      promote: async (run: RunSnapshot, winner: Attempt, decision: never) => {
        promoted.push({ winner, judgement: decision });
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    const step = (now: number) =>
      coordinate(
        store,
        dispatcher,
        wakeup,
        now,
        undefined,
        undefined,
        promoter,
      );

    await expect(step(100)).resolves.toBe("dispatched");
    // All candidates fan out concurrently in one coordination pass.
    expect(submitted).toHaveLength(2);
    const alpha = submitted[0]!;
    expect(alpha.role).toBe("qualify-candidate-alpha");
    expect(alpha.competition).toEqual({
      purpose: "candidate",
      candidateId: "alpha",
    });
    expect(alpha.expectedHead).toBe(competition.baseCommit);
    expect(alpha.nodeId).toBe("qualify");
    const beta = submitted[1]!;
    expect(beta.role).toBe("qualify-candidate-beta");
    expect(beta.expectedHead).toBe(alpha.expectedHead);
    // While candidates are running, revisits wait without redispatching.
    await expect(step(101)).resolves.toBe("duplicate");
    expect(submitted).toHaveLength(2);

    // The judge is never dispatched while any candidate is incomplete.
    await store.completeAttempt(
      alpha.id,
      1,
      alpha.expectedHead,
      qualificationResult("alpha"),
    );
    await expect(step(102)).resolves.toBe("duplicate");
    expect(submitted).toHaveLength(2);

    await store.completeAttempt(
      beta.id,
      1,
      beta.expectedHead,
      qualificationResult("beta"),
    );
    await expect(step(104)).resolves.toBe("dispatched");
    expect(submitted).toHaveLength(3);
    const judge = submitted[2]!;
    expect(judge.role).toBe("qualify-judge");
    expect(judge.competition).toEqual({ purpose: "judge" });
    expect(judge.capabilities).not.toContain("artifact.write");

    await store.completeAttempt(judge.id, 1, judge.expectedHead, judgement());
    await expect(step(105)).resolves.toBe("dispatched");

    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.winner.id).toBe(alpha.id);
    const canonical = await store.getAttempt("run_competition_rev_1");
    expect(canonical?.state).toBe("completed");
    expect(canonical?.role).toBe("qualify");
    expect(canonical?.competition?.purpose).toBe("selected");
    expect(canonical?.result).toEqual(qualificationResult("alpha"));
    // The run advanced on the winner's result alone.
    await expect(store.get(competition.id)).resolves.toMatchObject({
      status: "succeeded",
    });
    // Losing candidates remain as evidence but are never canonical.
    const losers = await store.attemptsForRevision(competition.id, 1);
    expect(losers.find((attempt) => attempt.id === beta.id)?.state).toBe(
      "completed",
    );
    // Revisiting is idempotent: no further dispatch or transition.
    await expect(step(106)).resolves.toBe("stale");
  });

  it("fails the stage on an invalid judgement instead of choosing a fallback", async () => {
    const competition = await competitionInput();
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    const step = (now: number) => coordinate(store, dispatcher, wakeup, now);
    await step(100);
    await store.completeAttempt(
      submitted[0]!.id,
      1,
      submitted[0]!.expectedHead,
      qualificationResult("alpha"),
    );
    await step(101);
    await store.completeAttempt(
      submitted[1]!.id,
      1,
      submitted[1]!.expectedHead,
      qualificationResult("beta"),
    );
    await step(102);
    await store.completeAttempt(
      submitted[2]!.id,
      1,
      submitted[2]!.expectedHead,
      {
        judgement: {
          selected: "gamma",
          scores: [
            { candidateId: "alpha", score: 9, rationale: "Strong" },
            { candidateId: "beta", score: 6, rationale: "Weak" },
          ],
        },
      },
    );
    await expect(step(103)).resolves.toBe("dispatched");
    await expect(store.get(competition.id)).resolves.toMatchObject({
      status: "failed",
    });
    expect(await store.getAttempt("run_competition_rev_1")).toBeUndefined();
  });

  it("fails the stage when any candidate fails", async () => {
    const competition = await competitionInput();
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    await coordinate(store, dispatcher, wakeup, 100);
    await store.failAttempt(submitted[0]!.id, 1, {
      failure: { reason: "execution_failed" },
    });
    await expect(coordinate(store, dispatcher, wakeup, 101)).resolves.toBe(
      "dispatched",
    );
    await expect(store.get(competition.id)).resolves.toMatchObject({
      status: "failed",
    });
    expect(submitted).toHaveLength(2);
  });

  it("resumes a candidate recorded before an interrupted dispatch handoff", async () => {
    const competition = await competitionInput();
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    let interrupt = true;
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        // The attempt is recorded before submit; interrupt the first handoff
        // to simulate a crash between recording and dispatch.
        if (interrupt && submitted.length === 0)
          throw new Error("handoff_interrupted");
        submitted.push(attempt);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    interrupt = true;
    await expect(coordinate(store, dispatcher, wakeup, 100)).rejects.toThrow(
      "handoff_interrupted",
    );
    const recorded = await store.getAttempt(
      "run_competition_rev_1_qualify-candidate-alpha",
    );
    expect(recorded?.state).toBe("created");
    // The next wakeup resumes the recorded candidate instead of waiting
    // forever, and the remaining fan-out proceeds.
    interrupt = false;
    await expect(coordinate(store, dispatcher, wakeup, 101)).resolves.toBe(
      "dispatched",
    );
    expect(submitted.map((attempt) => attempt.role)).toEqual([
      "qualify-candidate-alpha",
      "qualify-candidate-beta",
    ]);
    await expect(
      store.getAttempt("run_competition_rev_1_qualify-candidate-alpha"),
    ).resolves.toMatchObject({ state: "dispatched" });
  });

  it("gives the judge only read-only capabilities on a write-capable stage", async () => {
    const writeWorkflow = await compileWorkflow(
      `
version: 1
triggers:
  github.issue.started: qualify
nodes:
  qualify:
    executor: agent.read
    role: qualify
    agent:
      task: qualification
      inputs:
        issue: trigger.issue
      result:
        key: qualification
        schema: roundhouse.qualification.v1
      model: { id: openai/gpt-5.6-sol, reasoning: low }
    capabilities:
      - repository.read
      - context.read
    outputs:
      - qualification.classification
      - reproduction.status
      - plan.status
    transitions:
      - to: implement
  implement:
    executor: agent.write
    role: implement
    agent:
      task: implementation
      inputs:
        issue: trigger.issue
        qualification: nodes.qualify.qualification
        reproduction: nodes.qualify.reproduction
        plan: nodes.qualify.plan
      result:
        key: implementation
        schema: roundhouse.implementation.v1
      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: anthropic/claude-beta, reasoning: medium }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }
    capabilities:
      - repository.read
      - artifact.write
      - commands.execute
      - environment.project
      - network.project
      - preview.capture
    outputs:
      - implementation.summary
    transitions:
      - terminal: succeeded
`,
      sourceCommit,
    );
    const competition = {
      ...input,
      id: "run_competition",
      profile: { ...input.profile, workflow: writeWorkflow },
    };
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    const step = (now: number) => coordinate(store, dispatcher, wakeup, now);
    await step(100);
    // Advance the single-model qualification node to reach the competition.
    const qualify = submitted.find((attempt) => attempt.role === "qualify")!;
    await store.completeAttempt(qualify.id, 1, qualify.expectedHead, {
      qualification: {
        classification: "bug",
        summary: "qualify",
        acceptanceCriteria: [],
        uncertainties: [],
        sources: [],
      },
      reproduction: { status: "reproduced" },
      plan: { status: "ready" },
    });
    await step(101);
    // Advancing to the implement node bumped the run revision.
    const implementWakeup = { runId: competition.id, expectedRevision: 2 };
    await coordinate(store, dispatcher, implementWakeup, 102);
    const candidates = submitted.filter(
      (attempt) => attempt.competition?.purpose === "candidate",
    );
    expect(candidates).toHaveLength(2);
    // Candidates keep the stage's write capabilities.
    expect(candidates[0]!.capabilities).toContain("artifact.write");
    for (const candidate of candidates)
      await store.completeAttempt(candidate.id, 2, candidate.expectedHead, {
        implementation: { summary: candidate.role },
      });
    await coordinate(store, dispatcher, implementWakeup, 103);
    const judge = submitted.find(
      (attempt) => attempt.role === "implement-judge",
    )!;
    // The judge receives only the read-only subset: no command,
    // environment, network, preview, publication, or write authority.
    expect(judge.capabilities).toEqual(["repository.read"]);
  });

  it("records the selection durably before publication and resumes an interrupted promotion", async () => {
    const competition = await competitionInput();
    const store = new MemoryRunRepository();
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    const promoted: string[] = [];
    let failPromotion = true;
    const promoter = {
      promote: async (_run: RunSnapshot, winner: Attempt) => {
        if (failPromotion) throw new Error("publication_interrupted");
        promoted.push(winner.id);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    const step = (now: number) =>
      coordinate(
        store,
        dispatcher,
        wakeup,
        now,
        undefined,
        undefined,
        promoter,
      );
    await step(100);
    for (const candidate of [...submitted])
      await store.completeAttempt(
        candidate.id,
        1,
        candidate.expectedHead,
        qualificationResult(candidate.role),
      );
    await step(101);
    const judge = submitted.find(
      (attempt) => attempt.role === "qualify-judge",
    )!;
    await store.completeAttempt(judge.id, 1, judge.expectedHead, judgement());
    // The promoter fails after the selection is durably recorded.
    await expect(step(102)).rejects.toThrow("publication_interrupted");
    const recorded = await store.getAttempt("run_competition_rev_1");
    expect(recorded?.competition?.purpose).toBe("selected");
    expect(recorded?.state).toBe("dispatched");
    // The next wakeup resumes the recorded selection instead of restarting
    // the competition, and completes the promotion exactly once.
    failPromotion = false;
    await expect(step(103)).resolves.toBe("dispatched");
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toBe(submitted[0]!.id);
    const canonical = await store.getAttempt("run_competition_rev_1");
    expect(canonical?.state).toBe("completed");
    await expect(store.get(competition.id)).resolves.toMatchObject({
      status: "succeeded",
    });
  });

  // Same interrupted-promotion scenario against the D1-backed store, which
  // drops the in-memory-only result/acceptedHead on attempt creation. The
  // recovered canonical attempt must still complete with the winner's result
  // and accepted commit, reconstructed from the durable winner attempt.
  it("recovers the winner result and head from durable state after an interrupted publication", async () => {
    const competition = await competitionInput();
    const store = new D1RunRepository(new LocalD1() as never);
    await store.create(createRun(competition));
    const submitted: Attempt[] = [];
    const dispatcher = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    let failPromotion = true;
    const promoted: string[] = [];
    const promoter = {
      promote: async (_run: RunSnapshot, winner: Attempt) => {
        if (failPromotion) throw new Error("publication_interrupted");
        promoted.push(winner.id);
      },
    };
    const wakeup = { runId: competition.id, expectedRevision: 1 };
    const step = (now: number) =>
      coordinate(
        store,
        dispatcher,
        wakeup,
        now,
        undefined,
        undefined,
        promoter,
      );
    await step(100);
    const winnerHead = "e".repeat(40);
    for (const candidate of [...submitted])
      await store.completeAttempt(
        candidate.id,
        1,
        candidate.competition?.purpose === "candidate" &&
          candidate.competition.candidateId === "alpha"
          ? winnerHead
          : candidate.expectedHead,
        qualificationResult(candidate.role),
      );
    await step(101);
    const judge = submitted.find(
      (attempt) => attempt.role === "qualify-judge",
    )!;
    await store.completeAttempt(judge.id, 1, judge.expectedHead, judgement());
    // The selection is inserted durably, then publication fails.
    await expect(step(102)).rejects.toThrow("publication_interrupted");
    const recorded = await store.getAttempt("run_competition_rev_1");
    expect(recorded?.competition?.purpose).toBe("selected");
    expect(recorded?.result).toBeUndefined();
    // Recovery completes the canonical attempt with the winner's result and
    // accepted head even though the selection row never stored them.
    failPromotion = false;
    await expect(step(103)).resolves.toBe("dispatched");
    expect(promoted).toEqual([submitted[0]!.id]);
    const canonical = await store.getAttempt("run_competition_rev_1");
    expect(canonical?.state).toBe("completed");
    expect(canonical?.acceptedHead).toBe(winnerHead);
    expect(canonical?.result).toEqual(
      qualificationResult("qualify-candidate-alpha"),
    );
    await expect(store.get(competition.id)).resolves.toMatchObject({
      status: "succeeded",
    });
  });
});
