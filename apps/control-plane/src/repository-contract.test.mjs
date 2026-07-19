// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createRun, MemoryRunRepository } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { D1RunRepository } from "./d1-store.js";

class LocalD1Statement {
  values = [];

  constructor(statement) {
    this.statement = statement;
  }

  bind(...values) {
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
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(
      readFileSync(
        new URL("../migrations/0001_v2_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL("../migrations/0002_attempt_base_commit.sql", import.meta.url),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL("../migrations/0003_github_intake.sql", import.meta.url),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL("../migrations/0004_github_issue_state.sql", import.meta.url),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL("../migrations/0005_model_usage.sql", import.meta.url),
        "utf8",
      ),
    );
  }

  prepare(sql) {
    return new LocalD1Statement(this.database.prepare(sql));
  }
}

const input = {
  id: "run_contract",
  repository: "zorkian/roundhouse",
  issueNumber: 42,
  baseCommit: "a".repeat(40),
  profileVersion: "v2",
};

function repositoryContract(label, createRepository) {
  describe(`${label} run repository`, () => {
    it("shares revision, lease, attempt, callback, and recovery behavior", async () => {
      const repository = createRepository();
      const run = createRun(input);
      await repository.create(run);
      await expect(repository.get(run.id)).resolves.toEqual(run);

      const lease = {
        attemptId: "run_contract_rev_1",
        runRevision: 1,
        expiresAt: 200,
      };
      await expect(repository.claimLease(run.id, 1, lease, 100)).resolves.toBe(
        true,
      );
      await expect(
        repository.claimLease(
          run.id,
          1,
          { ...lease, attemptId: "different_attempt" },
          101,
        ),
      ).resolves.toBe(false);
      await expect(
        repository.releaseLease(run.id, 1, "different_attempt"),
      ).resolves.toBe(false);
      await expect(
        repository.releaseLease(run.id, 1, lease.attemptId),
      ).resolves.toBe(true);
      await expect(repository.claimLease(run.id, 1, lease, 101)).resolves.toBe(
        true,
      );
      await expect(repository.expiredLeases(200)).resolves.toEqual([
        { runId: run.id, expectedRevision: 1 },
      ]);

      const attempt = {
        id: lease.attemptId,
        runId: run.id,
        runRevision: 1,
        kind: "agent",
        stage: "qualify",
        role: "qualification",
        state: "created",
        deadlineAt: 200,
        baseCommit: run.baseCommit,
        expectedHead: run.baseCommit,
      };
      await expect(repository.createAttempt(attempt)).resolves.toBe("created");
      await expect(
        repository.createAttempt({ ...attempt, deadlineAt: 300 }),
      ).resolves.toBe("exists");
      await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
        state: "created",
        deadlineAt: 300,
      });
      await repository.markDispatched(attempt.id);
      await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
        state: "dispatched",
      });
      await expect(
        repository.completeAttempt(attempt.id, 1, "b".repeat(40), {
          outcome: "ok",
        }),
      ).resolves.toBe("completed");
      await expect(
        repository.createAttempt({ ...attempt, deadlineAt: 400 }),
      ).resolves.toBe("exists");
      await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
        state: "completed",
        deadlineAt: 300,
      });
      await expect(
        repository.latestCompletedAttempt(run.id, "qualify", 2),
      ).resolves.toMatchObject({ id: attempt.id, runRevision: 1 });
      await expect(
        repository.completeAttempt(attempt.id, 1, "b".repeat(40), {
          outcome: "ok",
        }),
      ).resolves.toBe("duplicate");

      await expect(
        repository.transition(run.id, 1, {
          status: "active",
          stage: "implement",
        }),
      ).resolves.toMatchObject({ revision: 2, stage: "implement" });
      await expect(
        repository.transition(run.id, 1, {
          status: "active",
          stage: "validate",
        }),
      ).resolves.toBeUndefined();
    });

    it("resumes clarification with the updated issue conversation", async () => {
      const repository = createRepository();
      const run = createRun({
        ...input,
        id: "run_clarification",
        issue: {
          title: "Needs context",
          body: "Original report",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "reporter",
        },
      });
      await repository.create(run);
      const waiting = await repository.transition(run.id, 1, {
        status: "waiting",
        stage: "qualify",
        waitingReason: "clarification",
      });
      await expect(
        repository.resumeClarification(run.id, waiting.revision, {
          ...run.issue,
          clarifications: [{ actor: "citizen", body: "More context" }],
        }),
      ).resolves.toMatchObject({
        status: "active",
        stage: "qualify",
        revision: 3,
        issue: { clarifications: [{ actor: "citizen", body: "More context" }] },
      });
    });
  });
}

repositoryContract("memory", () => new MemoryRunRepository());
repositoryContract("D1", () => new D1RunRepository(new LocalD1(), () => 100));

it("renews a D1 attempt lease from recorded activity", async () => {
  const repository = new D1RunRepository(new LocalD1(), () => 100);
  const run = createRun(input);
  await repository.create(run);
  const attempt = {
    id: "run_contract_rev_1",
    runId: run.id,
    runRevision: 1,
    kind: "agent",
    stage: "qualify",
    role: "qualification",
    state: "created",
    deadlineAt: 200,
    baseCommit: run.baseCommit,
    expectedHead: run.baseCommit,
  };
  await repository.claimLease(
    run.id,
    1,
    { attemptId: attempt.id, runRevision: 1, expiresAt: 200 },
    100,
  );
  await repository.createAttempt(attempt);
  await repository.markDispatched(attempt.id);

  await expect(repository.recordModelCall(attempt.id, 600)).resolves.toBe(true);
  await expect(repository.expiredLeases(599)).resolves.toEqual([]);
  await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
    deadlineAt: 600,
  });
  await expect(
    repository.recordActivity(attempt.id, 700, {
      phase: "command_output",
      operation: "codex exec",
      durationMs: 30_000,
      stdoutBytes: 100,
      stderrBytes: 0,
    }),
  ).resolves.toBe(true);
  await expect(
    repository.recordModelUsage({
      callId: "response_1",
      attemptId: attempt.id,
      model: "openai/gpt-5.6-sol",
      totalTokens: 123,
    }),
  ).resolves.toBe("created");
  await expect(
    repository.attemptDiagnosticSnapshot(attempt.id),
  ).resolves.toEqual({
    state: "dispatched",
    deadlineAt: 700,
    updatedAt: 100,
    modelCalls: 1,
    completedModelCalls: 1,
    lastProgress: {
      phase: "command_output",
      operation: "codex exec",
      durationMs: 30_000,
      stdoutBytes: 100,
      stderrBytes: 0,
    },
  });
  await expect(repository.expiredLeases(699)).resolves.toEqual([]);
  await expect(repository.expiredLeases(700)).resolves.toEqual([
    { runId: run.id, expectedRevision: 1 },
  ]);
});
