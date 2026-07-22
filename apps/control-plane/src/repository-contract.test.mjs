// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createRun,
  MemoryRunRepository,
  parseProfile,
  waitingReasons,
} from "@roundhouse/core";
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
    this.database.exec(
      readFileSync(
        new URL("../migrations/0007_model_provider_usage.sql", import.meta.url),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL(
          "../migrations/0008_model_usage_provider_identity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    this.database.exec(
      readFileSync(
        new URL("../migrations/0009_cache_creation_usage.sql", import.meta.url),
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
  profile: {
    sourcePath: ".roundhouse/profile.yaml",
    sourceCommit: "a".repeat(40),
    version: 1,
    hash: "v2",
    paths: { allowed: ["**"], protected: [] },
  },
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

    it("reopens a concluded no-change qualification with compare-and-set semantics", async () => {
      const repository = createRepository();
      const run = createRun({
        ...input,
        id: "run_reopen",
        issue: {
          title: "Already fixed?",
          body: "Original report",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "reporter",
        },
      });
      await repository.create(run);
      const attempt = {
        id: "run_reopen_rev_1",
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
      await repository.createAttempt(attempt);
      await expect(
        repository.completeAttempt(attempt.id, 1, run.baseCommit, {
          qualification: {
            classification: "already_satisfied",
            summary: "Looks addressed.",
          },
        }),
      ).resolves.toBe("completed");
      const concluded = await repository.transition(run.id, 1, {
        status: "succeeded",
        stage: "qualify",
      });

      await expect(
        repository.resume(run.id, 1, concluded.issue),
      ).resolves.toBeUndefined();
      const reopened = await repository.resume(run.id, concluded.revision, {
        ...concluded.issue,
        clarifications: [
          {
            actor: "citizen",
            body: "Still broken, here is evidence.",
            url: "https://github.com/zorkian/roundhouse/issues/42#issuecomment-1",
          },
        ],
      });
      expect(reopened).toMatchObject({
        status: "active",
        stage: "qualify",
        revision: 3,
        issue: {
          clarifications: [
            {
              actor: "citizen",
              body: "Still broken, here is evidence.",
              url: "https://github.com/zorkian/roundhouse/issues/42#issuecomment-1",
            },
          ],
        },
      });
      await expect(repository.get(run.id)).resolves.toEqual(reopened);

      // The same revision cannot be reopened twice, and the reopened
      // revision can hold a fresh lease for the new qualification attempt.
      await expect(
        repository.resume(run.id, concluded.revision, concluded.issue),
      ).resolves.toBeUndefined();
      await expect(
        repository.claimLease(
          run.id,
          3,
          { attemptId: "run_reopen_rev_3", runRevision: 3, expiresAt: 300 },
          100,
        ),
      ).resolves.toBe(true);

      // The prior completed attempt remains queryable behind the new revision.
      await expect(
        repository.latestCompletedAttempt(run.id, "qualify", reopened.revision),
      ).resolves.toMatchObject({ id: attempt.id, runRevision: 1 });
      await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
        state: "completed",
      });

      // Reconsideration can conclude no-change and be reopened again.
      const second = {
        ...attempt,
        id: "run_reopen_rev_3",
        runRevision: 3,
      };
      await repository.createAttempt(second);
      await expect(
        repository.completeAttempt(second.id, 3, run.baseCommit, {
          qualification: {
            classification: "unsupported",
            summary: "Still cannot take this on.",
          },
        }),
      ).resolves.toBe("completed");
      const reconcluded = await repository.transition(run.id, 3, {
        status: "succeeded",
        stage: "qualify",
      });
      await expect(
        repository.resume(run.id, reconcluded.revision, reconcluded.issue),
      ).resolves.toMatchObject({
        status: "active",
        stage: "qualify",
        revision: 5,
      });
      await expect(
        repository.latestCompletedAttempt(run.id, "qualify", 5),
      ).resolves.toMatchObject({ id: second.id, runRevision: 3 });
    });

    it("refuses to reopen terminal runs beyond qualification", async () => {
      const repository = createRepository();
      const run = createRun({
        ...input,
        id: "run_closed",
        issue: {
          title: "Merged",
          body: "Original report",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "reporter",
        },
      });
      await repository.create(run);
      await repository.transition(run.id, 1, {
        status: "succeeded",
        stage: "merge",
      });
      await expect(repository.resume(run.id, 2, run.issue)).rejects.toThrow(
        "run_not_resumable",
      );
      await expect(repository.get(run.id)).resolves.toMatchObject({
        status: "succeeded",
        stage: "merge",
        revision: 2,
      });
    });

    it.each(waitingReasons)("resumes a %s wait", async (reason) => {
      const repository = createRepository();
      const { profile: _profile, ...profilelessInput } = input;
      const run = createRun({
        ...(reason === "profile_error" ? profilelessInput : input),
        id: `run_waiting_${reason}`,
        ...(reason === "profile_error"
          ? { profileError: "Repository profile is missing or invalid" }
          : {}),
        issue: {
          title: "Paused work",
          body: "Original report",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "reporter",
        },
      });
      await repository.create(run);
      const waiting = await repository.transition(run.id, 1, {
        status: "waiting",
        stage: "implement",
        waitingReason: reason,
      });
      const profile =
        reason === "profile_error"
          ? await parseProfile(
              'version: 1\npaths:\n  allowed: ["**"]\n  protected: []\n',
              "b".repeat(40),
            )
          : undefined;
      const resumed = await repository.resume(
        run.id,
        waiting.revision,
        run.issue,
        profile,
      );
      expect(resumed).toMatchObject({
        status: "active",
        stage: "implement",
        revision: 3,
      });
      expect(resumed).not.toHaveProperty("waitingReason");
      if (profile) {
        expect(resumed).toMatchObject({
          profile,
          profileVersion: profile.hash,
        });
        expect(resumed).not.toHaveProperty("profileError");
      }
      await expect(repository.get(run.id)).resolves.toEqual(resumed);
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
        repository.resume(run.id, waiting.revision, {
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

    it("detects CI failure evidence consumed by an earlier revision only", async () => {
      const repository = createRepository();
      const run = createRun({ ...input, id: "run_ci_evidence" });
      await repository.create(run);
      const head = "b".repeat(40);
      const evidenceKey = `${head}:11:31:1`;
      const attempt = {
        id: "run_ci_evidence_rev_1",
        runId: run.id,
        runRevision: 1,
        kind: "external",
        stage: "ci",
        role: "github-checks",
        state: "created",
        deadlineAt: 200,
        baseCommit: run.baseCommit,
        expectedHead: head,
      };
      await repository.createAttempt(attempt);
      await expect(
        repository.consumedCiEvidence(run.id, evidenceKey, 2),
      ).resolves.toBe(false);
      await expect(
        repository.completeAttempt(attempt.id, 1, head, {
          ci: {
            status: "failure",
            head,
            diagnostics: {
              evidenceKey,
              untrusted: true,
              notice: "untrusted diagnostic data",
              failures: [],
            },
          },
        }),
      ).resolves.toBe("completed");

      await expect(
        repository.consumedCiEvidence(run.id, evidenceKey, 2),
      ).resolves.toBe(true);
      // The same revision is not yet history, and other keys or runs do not
      // match the recorded evidence.
      await expect(
        repository.consumedCiEvidence(run.id, evidenceKey, 1),
      ).resolves.toBe(false);
      await expect(
        repository.consumedCiEvidence(run.id, `${head}:11:31:2`, 2),
      ).resolves.toBe(false);
      await expect(
        repository.consumedCiEvidence("run_contract", evidenceKey, 2),
      ).resolves.toBe(false);
    });

    it("records an attempt failure without accepting later completion", async () => {
      const repository = createRepository();
      const run = createRun({ ...input, id: "run_failed_attempt" });
      await repository.create(run);
      const attempt = {
        id: "run_failed_attempt_rev_1",
        runId: run.id,
        runRevision: 1,
        kind: "agent",
        stage: "implement",
        role: "implement",
        state: "dispatched",
        deadlineAt: 200,
        baseCommit: run.baseCommit,
        expectedHead: run.baseCommit,
      };
      await repository.createAttempt(attempt);
      await expect(
        repository.failAttempt(attempt.id, 1, {
          failure: { reason: "budget", source: "model_provider" },
        }),
      ).resolves.toBe("failed");
      await expect(repository.getAttempt(attempt.id)).resolves.toMatchObject({
        state: "failed",
        result: {
          failure: { reason: "budget", source: "model_provider" },
        },
      });
      await expect(repository.failAttempt(attempt.id, 1, {})).resolves.toBe(
        "duplicate",
      );
      await expect(
        repository.completeAttempt(attempt.id, 1, run.baseCommit, {}),
      ).resolves.toBe("stale");
    });
  });
}

repositoryContract("memory", () => new MemoryRunRepository());
repositoryContract("D1", () => new D1RunRepository(new LocalD1(), () => 100));

it("preserves the explicit path profile through D1 persistence", async () => {
  const commit = "a".repeat(40);
  const v1 = await parseProfile(
    'version: 1\npaths:\n  allowed: ["**"]\n  protected: [".github/workflows/**"]\n',
    commit,
  );
  const repository = new D1RunRepository(new LocalD1(), () => 100);
  const run = createRun({
    ...input,
    id: "run_profile_v1",
    profileVersion: v1.hash,
    profile: v1,
  });
  await repository.create(run);

  await expect(repository.get(run.id)).resolves.toEqual(run);
  const reloaded = await repository.get(run.id);
  expect(reloaded.profile).toMatchObject({
    version: 1,
    sourcePath: ".roundhouse/profile.yaml",
    sourceCommit: commit,
    hash: v1.hash,
    paths: { allowed: ["**"], protected: [".github/workflows/**"] },
  });
});

it("resolves D1 run details by repository name for numeric GitHub enrollment", async () => {
  const repository = new D1RunRepository(new LocalD1(), () => 100);
  const run = createRun({
    ...input,
    id: "run_details_lookup",
    githubRepositoryId: 1297678423,
  });
  await repository.create(run);

  const details = await repository.detailsByIssue("zorkian/roundhouse", 42);
  expect(details?.run).toEqual(run);
  expect(details?.createdAt).toBe(100);
  expect(details?.attempts).toEqual([]);
  await expect(
    repository.detailsByIssue("zorkian/roundhouse", 43),
  ).resolves.toBeUndefined();
  await expect(
    repository.detailsByIssue("unknown/repository", 42),
  ).resolves.toBeUndefined();
});

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
      operation: "pi agent",
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
      provider: "openai",
      totalTokens: 123,
    }),
  ).resolves.toBe("created");
  await expect(
    repository.recordModelUsage({
      callId: "response_1",
      attemptId: attempt.id,
      model: "moonshotai/kimi-k3",
      provider: "moonshotai",
      totalTokens: 50,
    }),
  ).resolves.toBe("created");
  await expect(
    repository.attemptDiagnosticSnapshot(attempt.id),
  ).resolves.toEqual({
    state: "dispatched",
    deadlineAt: 700,
    updatedAt: 100,
    modelCalls: 1,
    completedModelCalls: 2,
    lastProgress: {
      phase: "command_output",
      operation: "pi agent",
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
