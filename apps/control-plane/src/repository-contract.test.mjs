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
        expectedHead: run.baseCommit,
      };
      await expect(repository.createAttempt(attempt)).resolves.toBe("created");
      await expect(repository.createAttempt(attempt)).resolves.toBe("exists");
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
  });
}

repositoryContract("memory", () => new MemoryRunRepository());
repositoryContract("D1", () => new D1RunRepository(new LocalD1(), () => 100));
