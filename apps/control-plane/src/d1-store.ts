// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  parseModelRoute,
  resumeRun,
  transitionRun,
  type AppliedProfile,
  type Attempt,
  type IssueSnapshot,
  type Lease,
  type ModelUsage,
  type ModelRoute,
  type RunRepository,
  type RunResumeSignal,
  type RunSnapshot,
  type RunStage,
  type RunTransition,
  type Wakeup,
} from "@roundhouse/core";
import type { AttemptCompletion } from "./callback.js";

interface Result<T> {
  results?: T[];
  meta: { changes?: number };
}
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run<T = unknown>(): Promise<Result<T>>;
  all<T>(): Promise<Result<T>>;
}
export interface D1Like {
  prepare(sql: string): Statement;
}

type RunRow = { document_json: string };
type AttemptRow = {
  id: string;
  run_id: string;
  run_revision: number;
  kind: Attempt["kind"];
  node_id: string | null;
  executor: Attempt["executor"] | null;
  stage: Attempt["stage"];
  role: string;
  state: Attempt["state"];
  deadline_at: number;
  base_commit: string;
  expected_head: string;
  accepted_head: string | null;
  result_json: string | null;
  routing_json: string | null;
  capabilities_json: string | null;
  outcome_json: string | null;
};

export type AttemptExecutionRecordOutcome = "recorded" | "duplicate" | "stale";

export interface RunDetails {
  readonly run: RunSnapshot;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly attempts: readonly (Attempt & {
    readonly createdAt: number;
    readonly updatedAt: number;
  })[];
  readonly usage?: readonly (ModelUsage & { readonly createdAt?: number })[];
  readonly events?: readonly {
    readonly attemptId?: string;
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly createdAt: number;
  }[];
}

export interface RunSummary {
  readonly run: RunSnapshot;
  readonly githubIssueState: "open" | "closed";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly usage?: readonly ModelUsage[];
}

export interface AttemptDiagnosticSnapshot {
  readonly state: Attempt["state"];
  readonly deadlineAt: number;
  readonly updatedAt: number;
  readonly modelCalls: number;
  readonly completedModelCalls: number;
  readonly lastProgress?: Readonly<Record<string, unknown>>;
}

type UsageRow = {
  call_id: string;
  attempt_id: string;
  model: string;
  provider: string | null;
  configured_model: string | null;
  routing_rule: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  reasoning_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  created_at?: number;
};
const usageFromRow = (
  row: UsageRow,
): ModelUsage & { readonly createdAt?: number } => ({
  callId: row.call_id,
  attemptId: row.attempt_id,
  model: row.model,
  ...(row.provider === null ? {} : { provider: row.provider }),
  ...(row.configured_model === null
    ? {}
    : { configuredModel: row.configured_model }),
  ...(row.routing_rule === null ? {} : { routingRule: row.routing_rule }),
  ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
  ...(row.cached_input_tokens === null
    ? {}
    : { cachedInputTokens: row.cached_input_tokens }),
  ...(row.cache_creation_input_tokens === null
    ? {}
    : { cacheCreationInputTokens: row.cache_creation_input_tokens }),
  ...(row.reasoning_tokens === null
    ? {}
    : { reasoningTokens: row.reasoning_tokens }),
  ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
  ...(row.total_tokens === null ? {} : { totalTokens: row.total_tokens }),
  ...(row.cost_usd === null ? {} : { costUsd: row.cost_usd }),
  ...(row.created_at === undefined ? {} : { createdAt: row.created_at }),
});

function attemptFromRow(row: AttemptRow): Attempt {
  const routing = parseModelRoute(row.routing_json);
  return {
    id: row.id,
    runId: row.run_id,
    runRevision: row.run_revision,
    kind: row.kind,
    ...(row.node_id ? { nodeId: row.node_id } : {}),
    ...(row.executor ? { executor: row.executor } : {}),
    stage: row.stage,
    role: row.role,
    capabilities: JSON.parse(row.capabilities_json ?? "[]") as NonNullable<
      Attempt["capabilities"]
    >,
    state: row.state,
    deadlineAt: row.deadline_at,
    baseCommit: row.base_commit,
    expectedHead: row.expected_head,
    ...(row.accepted_head ? { acceptedHead: row.accepted_head } : {}),
    ...(row.result_json
      ? { result: JSON.parse(row.result_json) as Record<string, unknown> }
      : {}),
    ...(routing ? { routing } : {}),
    ...(row.outcome_json
      ? { outcome: JSON.parse(row.outcome_json) as Attempt["outcome"] }
      : {}),
  };
}

export class D1RunRepository implements RunRepository {
  constructor(
    readonly database: D1Like,
    private readonly now = () => Date.now(),
  ) {}

  private get db(): D1Like {
    return this.database;
  }

  async create(run: RunSnapshot): Promise<void> {
    const time = this.now();
    const repositoryId = `repo_${run.githubRepositoryId ?? run.repository}`;
    const workItemId = `work_${run.id}`;
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO repositories (id, github_id, profile_version, profile_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(
        repositoryId,
        String(run.githubRepositoryId ?? run.repository),
        run.profileVersion,
        JSON.stringify({
          repository: run.repository,
          ...(run.githubInstallationId
            ? { installationId: run.githubInstallationId }
            : {}),
          ...(run.profile ? { profile: run.profile } : {}),
        }),
        time,
      )
      .run();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO work_items (id, repository_id, issue_number, current_run_id) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(workItemId, repositoryId, run.issueNumber, run.id)
      .run();
    await this.db
      .prepare(
        "INSERT INTO runs (id, work_item_id, status, stage, current_node_id, workflow_hash, revision, document_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
      )
      .bind(
        run.id,
        workItemId,
        run.status,
        run.stage,
        run.currentNodeId ?? null,
        run.workflowHash ?? null,
        run.revision,
        JSON.stringify(run),
        time,
      )
      .run();
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    const row = await this.db
      .prepare("SELECT document_json FROM runs WHERE id = ?1")
      .bind(runId)
      .first<RunRow>();
    return row ? (JSON.parse(row.document_json) as RunSnapshot) : undefined;
  }

  async listRuns(limit = 50): Promise<readonly RunSummary[]> {
    const result = await this.db
      .prepare(
        "SELECT r.document_json,r.created_at,r.updated_at,w.github_issue_state FROM runs r JOIN work_items w ON w.id=r.work_item_id ORDER BY r.updated_at DESC LIMIT ?1",
      )
      .bind(limit)
      .all<{
        document_json: string;
        created_at: number;
        updated_at: number;
        github_issue_state: "open" | "closed";
      }>();
    return Promise.all(
      (result.results ?? []).map(async (row) => {
        const run = JSON.parse(row.document_json) as RunSnapshot;
        return {
          run,
          githubIssueState: row.github_issue_state,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          usage: await this.usageForRun(run.id),
        };
      }),
    );
  }

  // Dashboard reads are authorized by stable GitHub repository ID in SQL
  // before ordering and the 50-run recency limit are applied.
  async listRunsForRepositories(
    githubRepositoryIds: readonly string[],
    limit = 50,
  ): Promise<readonly RunSummary[]> {
    if (!githubRepositoryIds.length) return [];
    const placeholders = githubRepositoryIds
      .map((_, index) => `?${index + 1}`)
      .join(",");
    const result = await this.db
      .prepare(
        `SELECT r.document_json,r.created_at,r.updated_at,w.github_issue_state FROM repositories p JOIN work_items w ON w.repository_id=p.id JOIN runs r ON r.work_item_id=w.id WHERE p.github_id IN (${placeholders}) ORDER BY r.updated_at DESC LIMIT ?${githubRepositoryIds.length + 1}`,
      )
      .bind(...githubRepositoryIds, limit)
      .all<{
        document_json: string;
        created_at: number;
        updated_at: number;
        github_issue_state: "open" | "closed";
      }>();
    return Promise.all(
      (result.results ?? []).map(async (row) => {
        const run = JSON.parse(row.document_json) as RunSnapshot;
        return {
          run,
          githubIssueState: row.github_issue_state,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          usage: await this.usageForRun(run.id),
        };
      }),
    );
  }

  // Latest workflow-bearing run for one repository, authorized by stable
  // GitHub repository ID, without loading the global recent-run list.
  async latestWorkflowRunForRepository(
    repository: string,
    githubRepositoryIds: readonly string[],
  ): Promise<RunSnapshot | undefined> {
    if (!githubRepositoryIds.length) return undefined;
    const placeholders = githubRepositoryIds
      .map((_, index) => `?${index + 2}`)
      .join(",");
    const row = await this.db
      .prepare(
        `SELECT r.id FROM repositories p JOIN work_items w ON w.repository_id=p.id JOIN runs r ON r.work_item_id=w.id WHERE json_extract(p.profile_json,'$.repository')=?1 AND p.github_id IN (${placeholders}) ORDER BY r.updated_at DESC LIMIT 1`,
      )
      .bind(repository, ...githubRepositoryIds)
      .first<{ id: string }>();
    return row ? this.get(row.id) : undefined;
  }

  async detailsByIssue(
    repository: string,
    issueNumber: number,
    githubRepositoryIds?: readonly string[],
  ): Promise<RunDetails | undefined> {
    if (githubRepositoryIds && !githubRepositoryIds.length) return undefined;
    const authorization = githubRepositoryIds
      ? ` AND p.github_id IN (${githubRepositoryIds.map((_, index) => `?${index + 3}`).join(",")})`
      : "";
    const row = await this.db
      .prepare(
        `SELECT r.document_json,r.created_at,r.updated_at FROM repositories p JOIN work_items w ON w.repository_id=p.id JOIN runs r ON r.id=w.current_run_id WHERE json_extract(p.profile_json,'$.repository')=?1 AND w.issue_number=?2${authorization}`,
      )
      .bind(repository, issueNumber, ...(githubRepositoryIds ?? []))
      .first<{
        document_json: string;
        created_at: number;
        updated_at: number;
      }>();
    if (!row) return undefined;
    const run = JSON.parse(row.document_json) as RunSnapshot;
    const result = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json,created_at,updated_at FROM attempts WHERE run_id=?1 ORDER BY created_at ASC,id ASC",
      )
      .bind(run.id)
      .all<AttemptRow & { created_at: number; updated_at: number }>();
    return {
      run,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attempts: (result.results ?? []).map((attempt) => ({
        ...attemptFromRow(attempt),
        createdAt: attempt.created_at,
        updatedAt: attempt.updated_at,
      })),
      usage: await this.usageForRun(run.id),
      events: await this.eventsForRun(run.id),
    };
  }

  private async eventsForRun(runId: string): Promise<RunDetails["events"]> {
    const result = await this.db
      .prepare(
        "SELECT attempt_id,kind,payload_json,created_at FROM events WHERE run_id=?1 AND (kind IN ('workflow_transition','workflow_agent_resolved','workflow_review_fanout','workflow_review_join','workflow_boundary_audit') OR (attempt_id IS NOT NULL AND (kind='attempt_lease_expired' OR (kind='attempt_progress' AND json_extract(payload_json,'$.phase')='workspace_started')))) ORDER BY created_at,id",
      )
      .bind(runId)
      .all<{
        attempt_id: string | null;
        kind: string;
        payload_json: string;
        created_at: number;
      }>();
    return (result.results ?? [])
      .filter((event) => event.kind && event.payload_json)
      .map((event) => ({
        ...(event.attempt_id ? { attemptId: event.attempt_id } : {}),
        kind: event.kind,
        payload: JSON.parse(event.payload_json) as Record<string, unknown>,
        createdAt: event.created_at,
      }));
  }

  private async usageForRun(
    runId: string,
  ): Promise<readonly (ModelUsage & { readonly createdAt?: number })[]> {
    const result = await this.db
      .prepare(
        "SELECT u.call_id,u.attempt_id,u.model,u.provider,u.configured_model,u.routing_rule,u.input_tokens,u.cached_input_tokens,u.cache_creation_input_tokens,u.reasoning_tokens,u.output_tokens,u.total_tokens,u.cost_usd,u.created_at FROM model_usage u JOIN attempts a ON a.id=u.attempt_id WHERE a.run_id=?1 ORDER BY u.created_at,u.call_id",
      )
      .bind(runId)
      .all<UsageRow>();
    return (result.results ?? []).map(usageFromRow);
  }

  // Rolling-window model usage across all repositories the session is
  // authorized for, filtered by stable GitHub repository ID and call
  // timestamp in SQL without the dashboard's 50-run recency limit.
  async usageForRepositories(
    githubRepositoryIds: readonly string[],
    startAt: number,
    endAt: number,
  ): Promise<readonly (ModelUsage & { readonly createdAt?: number })[]> {
    if (!githubRepositoryIds.length) return [];
    const placeholders = githubRepositoryIds
      .map((_, index) => `?${index + 3}`)
      .join(",");
    const result = await this.db
      .prepare(
        `SELECT u.call_id,u.attempt_id,u.model,u.provider,u.configured_model,u.routing_rule,u.input_tokens,u.cached_input_tokens,u.cache_creation_input_tokens,u.reasoning_tokens,u.output_tokens,u.total_tokens,u.cost_usd,u.created_at FROM model_usage u JOIN attempts a ON a.id=u.attempt_id JOIN runs r ON r.id=a.run_id JOIN work_items w ON w.id=r.work_item_id JOIN repositories p ON p.id=w.repository_id WHERE u.created_at>=?1 AND u.created_at<=?2 AND p.github_id IN (${placeholders}) ORDER BY u.created_at,u.call_id`,
      )
      .bind(startAt, endAt, ...githubRepositoryIds)
      .all<UsageRow>();
    return (result.results ?? []).map(usageFromRow);
  }

  async recordModelUsage(usage: ModelUsage): Promise<"created" | "exists"> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO model_usage (call_id,attempt_id,model,provider,configured_model,routing_rule,input_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_tokens,output_tokens,total_tokens,cost_usd,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
      )
      .bind(
        usage.callId,
        usage.attemptId,
        usage.model,
        usage.provider ?? "",
        usage.configuredModel ?? null,
        usage.routingRule ?? null,
        usage.inputTokens ?? null,
        usage.cachedInputTokens ?? null,
        usage.cacheCreationInputTokens ?? null,
        usage.reasoningTokens ?? null,
        usage.outputTokens ?? null,
        usage.totalTokens ?? null,
        usage.costUsd ?? null,
        this.now(),
      )
      .run();
    const outcome = (result.meta.changes ?? 0) === 1 ? "created" : "exists";
    if (outcome === "created")
      await this.recordAttemptEventBestEffort(
        usage.attemptId,
        "model_usage_recorded",
        {
          callId: usage.callId,
          model: usage.model,
          totalTokens: usage.totalTokens ?? null,
        },
      );
    return outcome;
  }

  async transition(
    runId: string,
    expectedRevision: number,
    transition: RunTransition,
  ): Promise<RunSnapshot | undefined> {
    const current = await this.get(runId);
    if (!current || current.revision !== expectedRevision) return undefined;
    const next = transitionRun(current, expectedRevision, transition);
    const result = await this.db
      .prepare(
        "UPDATE runs SET status=?1, stage=?2, current_node_id=?3, workflow_hash=?4, revision=?5, document_json=?6, lease_attempt_id=NULL, lease_revision=NULL, lease_expires_at=NULL, updated_at=?7 WHERE id=?8 AND revision=?9",
      )
      .bind(
        next.status,
        next.stage,
        next.currentNodeId ?? null,
        next.workflowHash ?? null,
        next.revision,
        JSON.stringify(next),
        this.now(),
        runId,
        expectedRevision,
      )
      .run();
    return (result.meta.changes ?? 0) === 1 ? next : undefined;
  }

  async resume(
    runId: string,
    expectedRevision: number,
    issue: IssueSnapshot,
    profile?: AppliedProfile,
    continuationHead?: string,
    signal?: RunResumeSignal,
  ): Promise<RunSnapshot | undefined> {
    const current = await this.get(runId);
    if (!current || current.revision !== expectedRevision) return undefined;
    const next = resumeRun(
      current,
      expectedRevision,
      issue,
      profile,
      continuationHead,
      signal,
    );
    const result = await this.db
      .prepare(
        "UPDATE runs SET status=?1, stage=?2, current_node_id=?3, workflow_hash=?4, revision=?5, document_json=?6, lease_attempt_id=NULL, lease_revision=NULL, lease_expires_at=NULL, updated_at=?7 WHERE id=?8 AND revision=?9",
      )
      .bind(
        next.status,
        next.stage,
        next.currentNodeId ?? null,
        next.workflowHash ?? null,
        next.revision,
        JSON.stringify(next),
        this.now(),
        runId,
        expectedRevision,
      )
      .run();
    return (result.meta.changes ?? 0) === 1 ? next : undefined;
  }

  async claimLease(
    runId: string,
    expectedRevision: number,
    lease: Lease,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE runs SET lease_attempt_id=?1, lease_revision=?2, lease_expires_at=?3, updated_at=?4 WHERE id=?5 AND revision=?2 AND status='active' AND (lease_expires_at IS NULL OR lease_expires_at<=?4)",
      )
      .bind(lease.attemptId, expectedRevision, lease.expiresAt, now, runId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async releaseLease(
    runId: string,
    expectedRevision: number,
    attemptId: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE runs SET lease_attempt_id=NULL, lease_revision=NULL, lease_expires_at=NULL, updated_at=?1 WHERE id=?2 AND revision=?3 AND lease_attempt_id=?4 AND lease_revision=?3",
      )
      .bind(this.now(), runId, expectedRevision, attemptId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async createAttempt(attempt: Attempt): Promise<"created" | "exists"> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO attempts (id,run_id,run_revision,kind,node_id,executor,stage,role,capabilities_json,state,deadline_at,base_commit,expected_head,routing_json,outcome_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)",
      )
      .bind(
        attempt.id,
        attempt.runId,
        attempt.runRevision,
        attempt.kind,
        attempt.nodeId ?? null,
        attempt.executor ?? null,
        attempt.stage,
        attempt.role,
        JSON.stringify(attempt.capabilities ?? []),
        attempt.state,
        attempt.deadlineAt,
        attempt.baseCommit,
        attempt.expectedHead,
        attempt.routing ? JSON.stringify(attempt.routing) : null,
        attempt.outcome ? JSON.stringify(attempt.outcome) : null,
        this.now(),
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) return "created";
    await this.db
      .prepare(
        "UPDATE attempts SET state='created', capabilities_json=?1, completion_json=NULL, result_json=NULL, outcome_json=NULL, deadline_at=?2, updated_at=?3 WHERE id=?4 AND run_id=?5 AND run_revision=?6 AND state NOT IN ('executed','completed')",
      )
      .bind(
        JSON.stringify(attempt.capabilities ?? []),
        attempt.deadlineAt,
        this.now(),
        attempt.id,
        attempt.runId,
        attempt.runRevision,
      )
      .run();
    return "exists";
  }

  async markDispatched(attemptId: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE attempts SET state='dispatched', updated_at=?1 WHERE id=?2 AND state='created'",
      )
      .bind(this.now(), attemptId)
      .run();
  }

  async recordAttemptExecution(
    attemptId: string,
    expectedRevision: number,
    completion: AttemptCompletion,
  ): Promise<AttemptExecutionRecordOutcome> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (attempt.state === "completed") return "duplicate";
    if (attempt.state === "executed") {
      const recorded = await this.getAttemptCompletion(attemptId);
      return JSON.stringify(recorded) === JSON.stringify(completion)
        ? "duplicate"
        : "stale";
    }
    const updated = await this.db
      .prepare(
        "UPDATE attempts SET state='executed',completion_json=?1,updated_at=?2 WHERE id=?3 AND run_revision=?4 AND state IN ('created','dispatched') AND EXISTS (SELECT 1 FROM runs WHERE id=attempts.run_id AND revision=?4 AND status='active')",
      )
      .bind(JSON.stringify(completion), this.now(), attemptId, expectedRevision)
      .run();
    return (updated.meta.changes ?? 0) === 1 ? "recorded" : "stale";
  }

  async getAttemptCompletion(
    attemptId: string,
  ): Promise<AttemptCompletion | undefined> {
    const row = await this.db
      .prepare("SELECT completion_json FROM attempts WHERE id=?1")
      .bind(attemptId)
      .first<{ completion_json: string | null }>();
    return row?.completion_json
      ? (JSON.parse(row.completion_json) as AttemptCompletion)
      : undefined;
  }

  async renewExecutedAttemptLease(
    attemptId: string,
    expiresAt: number,
  ): Promise<boolean> {
    const now = this.now();
    const attempt = await this.db
      .prepare(
        "UPDATE attempts SET deadline_at=?1,updated_at=?2 WHERE id=?3 AND state='executed'",
      )
      .bind(expiresAt, now, attemptId)
      .run();
    if ((attempt.meta.changes ?? 0) !== 1) return false;
    const run = await this.db
      .prepare(
        "UPDATE runs SET lease_expires_at=?1,updated_at=?2 WHERE lease_attempt_id=?3 AND lease_revision=(SELECT run_revision FROM attempts WHERE id=?3) AND status='active'",
      )
      .bind(expiresAt, now, attemptId)
      .run();
    return (run.meta.changes ?? 0) === 1;
  }

  async completeAttempt(
    attemptId: string,
    expectedRevision: number,
    acceptedHead: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"completed" | "duplicate" | "stale"> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (attempt.state === "completed") return "duplicate";
    const updated = await this.db
      .prepare(
        "UPDATE attempts SET state='completed', accepted_head=?1, result_json=?2, updated_at=?3 WHERE id=?4 AND run_revision=?5 AND state IN ('created','dispatched','executed') AND EXISTS (SELECT 1 FROM runs WHERE id=attempts.run_id AND revision=?5)",
      )
      .bind(
        acceptedHead,
        JSON.stringify(result),
        this.now(),
        attemptId,
        expectedRevision,
      )
      .run();
    if ((updated.meta.changes ?? 0) !== 1) return "stale";
    await this.db
      .prepare(
        "UPDATE runs SET lease_attempt_id=NULL, lease_revision=NULL, lease_expires_at=NULL WHERE id=?1 AND lease_attempt_id=?2 AND revision=?3",
      )
      .bind(attempt.runId, attemptId, expectedRevision)
      .run();
    return "completed";
  }

  async failAttempt(
    attemptId: string,
    expectedRevision: number,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"failed" | "duplicate" | "stale"> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (attempt.state === "failed") return "duplicate";
    if (attempt.state === "completed") return "stale";
    const updated = await this.db
      .prepare(
        "UPDATE attempts SET state='failed', result_json=?1, updated_at=?2 WHERE id=?3 AND run_revision=?4 AND state IN ('created','dispatched','executed')",
      )
      .bind(JSON.stringify(result), this.now(), attemptId, expectedRevision)
      .run();
    return (updated.meta.changes ?? 0) === 1 ? "failed" : "stale";
  }

  async settleAttemptOutcome(
    attemptId: string,
    expectedRevision: number,
    state: "completed" | "failed",
    outcome: NonNullable<Attempt["outcome"]>,
    acceptedHead?: string,
    result?: Readonly<Record<string, unknown>>,
  ): Promise<"completed" | "failed" | "duplicate" | "stale"> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (
      attempt.state === state &&
      JSON.stringify(attempt.outcome) === JSON.stringify(outcome)
    )
      return "duplicate";
    if (attempt.state === "completed" || attempt.state === "failed")
      return "stale";
    const updated = await this.db
      .prepare(
        "UPDATE attempts SET state=?1,accepted_head=?2,result_json=?3,outcome_json=?4,updated_at=?5 WHERE id=?6 AND run_revision=?7 AND state IN ('created','dispatched','executed') AND EXISTS (SELECT 1 FROM runs WHERE id=attempts.run_id AND revision=?7 AND status='active')",
      )
      .bind(
        state,
        acceptedHead ?? null,
        result ? JSON.stringify(result) : null,
        JSON.stringify(outcome),
        this.now(),
        attemptId,
        expectedRevision,
      )
      .run();
    if ((updated.meta.changes ?? 0) !== 1) return "stale";
    return state;
  }

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    const row = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json FROM attempts WHERE id=?1",
      )
      .bind(attemptId)
      .first<AttemptRow>();
    return row ? attemptFromRow(row) : undefined;
  }

  async latestCompletedAttempt(
    runId: string,
    stage: RunStage,
    beforeRevision: number,
  ): Promise<Attempt | undefined> {
    const row = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json FROM attempts WHERE run_id=?1 AND stage=?2 AND state='completed' AND run_revision<?3 ORDER BY run_revision DESC LIMIT 1",
      )
      .bind(runId, stage, beforeRevision)
      .first<AttemptRow>();
    return row ? attemptFromRow(row) : undefined;
  }

  async latestCompletedNodeAttempt(
    runId: string,
    nodeId: string,
    beforeRevision: number,
  ): Promise<Attempt | undefined> {
    const row = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json FROM attempts WHERE run_id=?1 AND node_id=?2 AND state='completed' AND run_revision<?3 ORDER BY run_revision DESC LIMIT 1",
      )
      .bind(runId, nodeId, beforeRevision)
      .first<AttemptRow>();
    return row ? attemptFromRow(row) : undefined;
  }

  async completedNodeAttempts(
    runId: string,
    nodeId: string,
    beforeRevision: number,
  ): Promise<readonly Attempt[]> {
    const result = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json FROM attempts WHERE run_id=?1 AND node_id=?2 AND state='completed' AND run_revision<?3 ORDER BY run_revision,id",
      )
      .bind(runId, nodeId, beforeRevision)
      .all<AttemptRow>();
    return (result.results ?? []).map(attemptFromRow);
  }

  async consumedCiEvidence(
    runId: string,
    evidenceKey: string,
    beforeRevision: number,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT 1 AS found FROM attempts WHERE run_id=?1 AND stage='ci' AND state='completed' AND run_revision<?2 AND json_extract(result_json,'$.ci.diagnostics.evidenceKey')=?3 LIMIT 1",
      )
      .bind(runId, beforeRevision, evidenceKey)
      .first<{ found: number }>();
    return row !== null && row !== undefined;
  }

  async attemptsForRevision(runId: string, revision: number) {
    const result = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,node_id,executor,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json,routing_json,capabilities_json,outcome_json FROM attempts WHERE run_id=?1 AND run_revision=?2 ORDER BY id",
      )
      .bind(runId, revision)
      .all<AttemptRow>();
    return (result.results ?? []).map(attemptFromRow);
  }

  async expiredLeases(now: number): Promise<readonly Wakeup[]> {
    const result = await this.db
      .prepare(
        "SELECT id,revision FROM runs WHERE status='active' AND stage IN ('qualify','reproduce','plan','implement','review','integrate','merge') AND lease_expires_at<=?1",
      )
      .bind(now)
      .all<{ id: string; revision: number }>();
    return (result.results ?? []).map((row) => ({
      runId: row.id,
      expectedRevision: row.revision,
    }));
  }

  async expiredAttemptLeases(
    now: number,
  ): Promise<readonly (Wakeup & { readonly attemptId: string })[]> {
    const result = await this.db
      .prepare(
        "SELECT id,revision,lease_attempt_id FROM runs WHERE status='active' AND stage IN ('qualify','reproduce','plan','implement','review','integrate','merge') AND lease_expires_at<=?1 AND lease_attempt_id IS NOT NULL",
      )
      .bind(now)
      .all<{ id: string; revision: number; lease_attempt_id: string }>();
    return (result.results ?? []).map((row) => ({
      runId: row.id,
      expectedRevision: row.revision,
      attemptId: row.lease_attempt_id,
    }));
  }

  async recordGitHubDelivery(
    runId: string,
    deliveryId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO events (run_id,kind,payload_json,created_at,delivery_id) VALUES (?1,'github_delivery',?2,?3,?4)",
      )
      .bind(runId, JSON.stringify(payload), this.now(), deliveryId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async recordAttemptEvent(
    attemptId: string,
    kind: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT INTO events (run_id,attempt_id,kind,payload_json,created_at) SELECT run_id,id,?1,?2,?3 FROM attempts WHERE id=?4",
      )
      .bind(kind, JSON.stringify(payload), this.now(), attemptId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async recordEvent(
    runId: string,
    attemptId: string | undefined,
    kind: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO events (run_id,attempt_id,kind,payload_json,created_at) VALUES (?1,?2,?3,?4,?5)",
      )
      .bind(runId, attemptId ?? null, kind, JSON.stringify(payload), this.now())
      .run();
  }

  private async recordAttemptEventBestEffort(
    attemptId: string,
    kind: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    try {
      await this.recordAttemptEvent(attemptId, kind, payload);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "attempt_diagnostic_record_failed",
          attemptId,
          kind,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async attemptDiagnosticSnapshot(
    attemptId: string,
  ): Promise<AttemptDiagnosticSnapshot | undefined> {
    const row = await this.db
      .prepare(
        "SELECT a.state,a.deadline_at,a.updated_at,a.model_calls,(SELECT COUNT(*) FROM model_usage u WHERE u.attempt_id=a.id) AS completed_model_calls,(SELECT e.payload_json FROM events e WHERE e.attempt_id=a.id AND e.kind='attempt_progress' ORDER BY e.id DESC LIMIT 1) AS last_progress_json FROM attempts a WHERE a.id=?1",
      )
      .bind(attemptId)
      .first<{
        state: Attempt["state"];
        deadline_at: number;
        updated_at: number;
        model_calls: number;
        completed_model_calls: number;
        last_progress_json: string | null;
      }>();
    if (!row) return undefined;
    return {
      state: row.state,
      deadlineAt: row.deadline_at,
      updatedAt: row.updated_at,
      modelCalls: row.model_calls,
      completedModelCalls: row.completed_model_calls,
      ...(row.last_progress_json
        ? {
            lastProgress: JSON.parse(row.last_progress_json) as Record<
              string,
              unknown
            >,
          }
        : {}),
    };
  }

  async setGitHubIssueState(
    runId: string,
    state: "open" | "closed",
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE work_items SET github_issue_state=?1 WHERE current_run_id=?2",
      )
      .bind(state, runId)
      .run();
  }

  private async renewActivity(
    attemptId: string,
    expiresAt: number,
    countModelCall: boolean,
  ): Promise<boolean> {
    const now = this.now();
    const attempt = await this.db
      .prepare(
        `UPDATE attempts SET ${countModelCall ? "model_calls=model_calls+1," : ""}deadline_at=?1,updated_at=?2 WHERE id=?3 AND state IN ('created','dispatched') AND EXISTS (SELECT 1 FROM runs WHERE runs.id=attempts.run_id AND runs.revision=attempts.run_revision AND runs.lease_attempt_id=attempts.id AND runs.lease_revision=attempts.run_revision AND runs.status='active')`,
      )
      .bind(expiresAt, now, attemptId)
      .run();
    if ((attempt.meta.changes ?? 0) !== 1) return false;
    const run = await this.db
      .prepare(
        "UPDATE runs SET lease_expires_at=?1,updated_at=?2 WHERE lease_attempt_id=?3 AND lease_revision=(SELECT run_revision FROM attempts WHERE id=?3) AND status='active'",
      )
      .bind(expiresAt, now, attemptId)
      .run();
    return (run.meta.changes ?? 0) === 1;
  }

  async recordActivity(
    attemptId: string,
    expiresAt: number,
    progress?: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    const recorded = await this.renewActivity(attemptId, expiresAt, false);
    if (recorded && progress)
      await this.recordAttemptEventBestEffort(
        attemptId,
        "attempt_progress",
        progress,
      );
    return recorded;
  }

  async recordModelCall(
    attemptId: string,
    expiresAt: number,
  ): Promise<boolean> {
    const recorded = await this.renewActivity(attemptId, expiresAt, true);
    if (recorded)
      await this.recordAttemptEventBestEffort(attemptId, "model_call_started", {
        expiresAt,
      });
    return recorded;
  }

  async recordModelRouting(
    attemptId: string,
    routing: ModelRoute,
  ): Promise<void> {
    await this.db
      .prepare("UPDATE attempts SET routing_json=?1,updated_at=?2 WHERE id=?3")
      .bind(JSON.stringify(routing), this.now(), attemptId)
      .run();
  }
}
