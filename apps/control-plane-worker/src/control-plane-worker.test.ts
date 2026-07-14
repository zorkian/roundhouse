// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  D1JobStore,
  d1JobStoreMigration,
  normalizeReviewFindings,
  type TrustedImplementationResult,
  type RunDelivery,
  type SelfDevelopmentTask,
} from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { exportPKCS8, generateKeyPair } from "jose";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import { createControlPlaneHandler } from "./index.js";
import {
  controlPlaneSubmissionMigration,
  reserveSubmission,
} from "./submissions.js";
import { cloudOperationsMigration } from "./operations.js";
import { githubPocMigration } from "./github-operations.js";
import { githubPlanningMigration, readIssuePlan } from "./github-planning.js";
import {
  enqueueComment,
  githubNativeOperatorMigration,
} from "./github-webhook.js";
import { githubReviewCheckMigration } from "./github-status.js";

let instance: Miniflare;
let database: D1Database;
const resetTables = [
  "github_review_check_outbox",
  "independent_review_findings",
  "independent_review_events",
  "independent_reviews",
  "github_plan_events",
  "github_issue_plans",
  "github_check_observations",
  "github_comment_outbox",
  "github_issue_runs",
  "github_webhook_deliveries",
  "github_publications",
  "github_issue_snapshots",
  "recovery_cycles",
  "operational_alerts",
  "operator_mutations",
  "control_plane_submissions",
  "self_development_runs",
] as const;
const token = "local-test-token";
const repositoryPath = "/workspace/roundhouse";
const remoteUrl = "https://github.com/zorkian/roundhouse.git";

const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_control_plane",
  subject: "Local control-plane demonstration",
  instructions: "Perform one bounded local demonstration.",
  repositoryPath,
  baseCommit: "d".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/**"],
  publication: {
    remote: "origin",
    remoteUrl,
    branch: "roundhouse/local-control-plane-demo",
    expectedRemoteHead: null,
    commitMessage: "Demonstrate local control plane",
    authorName: "Roundhouse Test",
    authorEmail: "roundhouse@example.invalid",
  },
};

type Queued = { messages: unknown[]; failNext: boolean };

async function sha256(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function awaitingImplementation(env: ControlPlaneEnv) {
  const trustedTask: SelfDevelopmentTask = {
    ...task,
    taskId: "task_trusted_routes",
    allowedPaths: ["docs/dogfood/trusted-self-development-loop.md"],
    source: {
      kind: "github_issue",
      owner: "zorkian",
      repository: "roundhouse",
      issueNumber: 7,
      issueUrl: "https://github.com/zorkian/roundhouse/issues/7",
      nodeId: "issue-node-7",
      contentSha256: "7".repeat(64),
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    planning: {
      planId: `plan_${"6".repeat(40)}`,
      planSha256: "5".repeat(64),
      profileId: "roundhouse-self-development-v1",
      profileVersion: 1,
      issueContentSha256: "7".repeat(64),
      exactPathsSha256: "4".repeat(64),
      approvedBy: "github:zorkian",
      approvedAt: "2026-07-12T00:00:00.000Z",
    },
    publication: {
      ...task.publication,
      branch: "codex/dogfood-trusted-routes",
    },
  };
  const runId = "run_trusted_routes";
  const jobs = new D1JobStore(env.DB);
  const now = new Date("2026-07-12T00:00:00Z");
  await jobs.submit(runId, trustedTask, now);
  const claim = await jobs.claim(runId, "worker", now, 30_000, 1);
  await jobs.startAttempt(runId, claim!.token, "prepare", now);
  const patch =
    "diff --git a/docs/dogfood/trusted-self-development-loop.md b/docs/dogfood/trusted-self-development-loop.md\n";
  const publicationContent =
    "<!-- Copyright 2026 Mark Smith -->\n<!-- SPDX-License-Identifier: Apache-2.0 -->\n\n# Dogfood\n";
  const publicationFile = {
    path: "docs/dogfood/trusted-self-development-loop.md",
    operation: "upsert" as const,
    contentBase64: Buffer.from(publicationContent).toString("base64"),
    size: Buffer.byteLength(publicationContent),
    sha256: await sha256(publicationContent),
  };
  const manifestValue = {
    schemaVersion: 1 as const,
    baseCommit: trustedTask.baseCommit,
    patchSha256: await sha256(patch),
    files: [publicationFile],
  };
  const result: TrustedImplementationResult = {
    schemaVersion: 1,
    runId,
    attemptId: `${runId}-prepare-1`,
    baseCommit: trustedTask.baseCommit,
    checkoutCommit: trustedTask.baseCommit,
    patch,
    patchSha256: await sha256(patch),
    patchBytes: new TextEncoder().encode(patch).byteLength,
    changedFiles: ["docs/dogfood/trusted-self-development-loop.md"],
    validationOutcome: "passed",
    publicationManifest: {
      ...manifestValue,
      sha256: await sha256(JSON.stringify(manifestValue)),
    },
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    startupDurationMs: 1,
    checkoutDurationMs: 1,
    agentDurationMs: 1,
    validationDurationMs: 1,
    agent: {
      provider: "codex-subscription",
      outcome: "succeeded",
      summary: "Created documentation.",
      eventBytes: 1,
    },
    validation: [
      {
        name: "license",
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
      checkoutHosts: ["github.com"],
      modelHosts: ["chatgpt.com"],
      agentToolInternetEnabled: false,
      validationInternetEnabled: false,
      deniedHttpProbe: true,
      deniedTcpProbe: true,
    },
    credential: {
      installedAtRuntime: true,
      removedBeforeValidation: true,
      absentFromEvidence: true,
    },
    resources: { diskBytes: 1, memoryBytes: 1 },
  };
  const evidenceJson = JSON.stringify(result);
  const objectKey = `runs/${runId}/attempts/${result.attemptId}/trusted-implementation.json`;
  const evidence = {
    schemaVersion: 1 as const,
    evidenceId: `evidence_${result.attemptId}`,
    attemptId: result.attemptId,
    objectKey,
    sha256: await sha256(evidenceJson),
    size: new TextEncoder().encode(evidenceJson).byteLength,
    mediaType: "application/json" as const,
    createdAt: now.toISOString(),
  };
  const objects = new Map([[objectKey, evidenceJson]]);
  env.EXECUTION_EVIDENCE = {
    get: async (key) => {
      const value = objects.get(key);
      return value ? { text: async () => value } : null;
    },
    put: async (key, bytes) => {
      if (objects.has(key)) return null;
      objects.set(key, new TextDecoder().decode(bytes));
      return {};
    },
  };
  await jobs.completeAttempt(
    runId,
    claim!.token,
    "prepare",
    "awaiting_approval",
    {},
    {
      evidence: [evidence],
      implementation: {
        patchSha256: result.patchSha256,
        patchBytes: result.patchBytes,
        changedFiles: result.changedFiles,
        evidenceId: evidence.evidenceId,
        objectKey,
      },
    },
    now,
  );
  await jobs.release(runId, claim!.token, now);
  return { runId, result, evidence, jobs, objects };
}

async function runtime(): Promise<{
  env: ControlPlaneEnv;
  queued: Queued;
}> {
  const db = database;
  const queued: Queued = { messages: [], failNext: false };
  const queue = {
    send: async (body: unknown) => {
      if (queued.failNext) {
        queued.failNext = false;
        throw new Error("simulated queue outage");
      }
      queued.messages.push(body);
    },
  } as unknown as Queue<unknown>;
  return {
    env: {
      DB: db,
      RUN_QUEUE: queue,
      AUTH_MODE: "local",
      LOCAL_API_TOKEN: token,
      EXECUTION_MODE: "deterministic-local",
      ALLOWED_REPOSITORY_PATH: repositoryPath,
      ALLOWED_REMOTE_URL: remoteUrl,
    },
    queued,
  };
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-control-plane-local" },
  });
  database = await instance.getD1Database("DB");
  const independentReviewMigration = await readFile(
    new URL("../migrations/0008_independent_review.sql", import.meta.url),
    "utf8",
  );
  for (const statement of `${d1JobStoreMigration}\n${controlPlaneSubmissionMigration}\n${cloudOperationsMigration}\n${githubPocMigration}\n${githubNativeOperatorMigration}\n${githubPlanningMigration}\n${independentReviewMigration}\n${githubReviewCheckMigration}`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await database.prepare(statement).run();

  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA' ORDER BY name",
    )
    .all<{ name: string }>();
  expect(tables.results.map(({ name }) => name)).toEqual(
    [...resetTables].sort(),
  );
});

beforeEach(async () => {
  for (const table of resetTables)
    await database.prepare(`DELETE FROM ${table}`).run();
});

afterAll(async () => {
  await instance.dispose();
});

function request(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Request<unknown, IncomingRequestCfProperties> {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("authorization", `Bearer ${token}`);
  if (
    init.method === "POST" &&
    path !== "/v1/runs" &&
    !headers.has("idempotency-key")
  )
    headers.set("idempotency-key", `test-${crypto.randomUUID()}`);
  return new Request(`http://roundhouse.local${path}`, {
    ...init,
    headers,
  }) as Request<unknown, IncomingRequestCfProperties>;
}

function submission(
  key: string,
  value: SelfDevelopmentTask = task,
): Request<unknown, IncomingRequestCfProperties> {
  return request("/v1/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ schemaVersion: 1, task: value }),
  });
}

async function deliver(
  handler: ExportedHandler<ControlPlaneEnv>,
  env: ControlPlaneEnv,
  bodies: unknown[],
): Promise<string[]> {
  const outcomes: string[] = [];
  const messages = bodies.map((body, index) => ({
    body,
    ack: () => outcomes.push(`ack:${index}`),
    retry: () => outcomes.push(`retry:${index}`),
  }));
  await handler.queue!(
    { messages } as unknown as MessageBatch<unknown>,
    env,
    {} as ExecutionContext,
  );
  return outcomes;
}

describe("local control-plane Worker", () => {
  it("keeps the Access-bypassed namespace limited to one exact Worker route", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    const child = await handler.fetch!(
      request("/v1/github/webhook/extra", {}, false),
      env,
      {} as ExecutionContext,
    );
    expect(child.status).toBe(404);
    expect(await child.text()).toBe("");
  });

  it("accepts one signed GitHub command and makes duplicate delivery harmless", async () => {
    const { env, queued } = await runtime();
    const pair = await generateKeyPair("RS256", { extractable: true });
    env.GITHUB_APP_ID = "4281837";
    env.GITHUB_INSTALLATION_ID = "146147681";
    env.ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY = await exportPKCS8(pair.privateKey);
    env.ROUNDHOUSE_GITHUB_WEBHOOK_SECRET = "signed-webhook-secret";
    let comments = 0;
    let statusComment:
      { id: number; html_url: string; body: string } | undefined;
    let lowRiskStatusComment:
      { id: number; html_url: string; body: string } | undefined;
    env.GITHUB_API_FETCHER = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens"))
        return new Response(
          JSON.stringify({
            token: "installation-token",
            expires_at: "2026-07-13T00:00:00Z",
          }),
          { status: 201 },
        );
      if (url.pathname.endsWith("/issues/17") && init?.method !== "POST")
        return new Response(
          JSON.stringify({
            number: 17,
            node_id: "issue-node-17",
            html_url: "https://github.com/zorkian/roundhouse/issues/17",
            title: "Classify GitHub gateway errors",
            body: [
              "Exercise the reviewed Roundhouse profile.",
              "",
              "Scope is exactly:",
              "",
              "- `apps/control-plane-worker/src/github-gateway.ts`",
              "- `apps/control-plane-worker/src/github-gateway.test.ts`",
            ].join("\n"),
            updated_at: "2026-07-12T00:00:00Z",
          }),
        );
      if (url.pathname.endsWith("/issues/18") && init?.method !== "POST")
        return new Response(
          JSON.stringify({
            number: 18,
            node_id: "issue-node-18",
            html_url: "https://github.com/zorkian/roundhouse/issues/18",
            title: "Clarify one operator guide",
            body: [
              "Make the operator guide easier to follow.",
              "",
              "Scope is exactly:",
              "",
              "- `docs/cloudflare/roundhouse-cloud-operations.md`",
            ].join("\n"),
            updated_at: "2026-07-12T00:00:00Z",
          }),
        );
      if (url.pathname.endsWith("/git/ref/heads/main"))
        return new Response(
          JSON.stringify({ object: { sha: "e".repeat(40) } }),
        );
      if (
        url.pathname.endsWith("/issues/17/comments") &&
        (init?.method ?? "GET") === "GET"
      )
        return new Response(
          JSON.stringify(statusComment ? [statusComment] : []),
        );
      if (
        url.pathname.endsWith("/issues/17/comments") &&
        init?.method === "POST"
      ) {
        comments += 1;
        statusComment = {
          id: 991,
          html_url:
            "https://github.com/zorkian/roundhouse/issues/17#issuecomment-991",
          body: (JSON.parse(String(init.body)) as { body: string }).body,
        };
        return new Response(JSON.stringify(statusComment), { status: 201 });
      }
      if (
        url.pathname.endsWith("/issues/18/comments") &&
        (init?.method ?? "GET") === "GET"
      )
        return new Response(
          JSON.stringify(lowRiskStatusComment ? [lowRiskStatusComment] : []),
        );
      if (
        url.pathname.endsWith("/issues/18/comments") &&
        init?.method === "POST"
      ) {
        comments += 1;
        lowRiskStatusComment = {
          id: 992,
          html_url:
            "https://github.com/zorkian/roundhouse/issues/18#issuecomment-992",
          body: (JSON.parse(String(init.body)) as { body: string }).body,
        };
        return new Response(JSON.stringify(lowRiskStatusComment), {
          status: 201,
        });
      }
      if (
        url.pathname.endsWith("/issues/comments/991") &&
        init?.method === "PATCH"
      ) {
        statusComment = {
          ...statusComment!,
          body: (JSON.parse(String(init.body)) as { body: string }).body,
        };
        return new Response(JSON.stringify(statusComment));
      }
      if (
        url.pathname.endsWith("/issues/comments/992") &&
        init?.method === "PATCH"
      ) {
        lowRiskStatusComment = {
          ...lowRiskStatusComment!,
          body: (JSON.parse(String(init.body)) as { body: string }).body,
        };
        return new Response(JSON.stringify(lowRiskStatusComment));
      }
      return new Response("{}", { status: 404 });
    };
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("signed-webhook-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const webhook = async (
      command: string,
      commentId: number,
      delivery: string,
      issueNumber = 17,
    ) => {
      const payload = JSON.stringify({
        action: "created",
        installation: { id: 146147681 },
        repository: { full_name: "zorkian/roundhouse" },
        sender: { login: "zorkian" },
        issue: { number: issueNumber },
        comment: {
          id: commentId,
          body: command,
          user: { login: "zorkian" },
        },
      });
      const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
      );
      const signature = `sha256=${[...new Uint8Array(mac)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;
      return new Request("http://roundhouse.local/v1/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": delivery,
          "x-github-event": "issue_comment",
          "x-hub-signature-256": signature,
        },
        body: payload,
      }) as Request<unknown, IncomingRequestCfProperties>;
    };
    const handler = createControlPlaneHandler();
    const accepted = await handler.fetch!(
      await webhook("/rh start", 41, "12345678-abcd-4321-abcd-1234567890ab"),
      env,
      {} as ExecutionContext,
    );
    expect(accepted.status).toBe(202);
    const result = (await accepted.json()) as {
      kind: string;
      planId: string;
    };
    expect(result).toMatchObject({ kind: "plan" });
    expect(result.planId).toMatch(/^plan_[a-f0-9]{40}$/);
    expect(queued.messages).toHaveLength(0);
    expect(comments).toBe(1);
    const plan = await readIssuePlan(env, 17);
    expect(plan).toMatchObject({ status: "proposed", revision: 1 });

    const zeroRevisionApproval = await handler.fetch!(
      request(`/v1/plans/${plan!.plan.planId}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "zero-plan-revision-01",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: 0,
          planSha256: plan!.plan.planSha256,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(zeroRevisionApproval.status).toBe(400);
    expect(queued.messages).toHaveLength(0);

    const repeatedStart = await handler.fetch!(
      await webhook("/rh start", 42, "87654321-abcd-4321-abcd-1234567890ab"),
      env,
      {} as ExecutionContext,
    );
    expect(repeatedStart.status).toBe(202);
    await expect(repeatedStart.json()).resolves.toMatchObject({
      kind: "plan",
      planId: result.planId,
    });
    expect(queued.messages).toHaveLength(0);
    expect(comments).toBe(1);

    const replay = await handler.fetch!(
      await webhook("/rh start", 41, "12345678-abcd-4321-abcd-1234567890ab"),
      env,
      {} as ExecutionContext,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
    expect(queued.messages).toHaveLength(0);
    expect(comments).toBe(1);

    const implementation = await handler.fetch!(
      await webhook(
        `/rh implement ${plan!.plan.planId} 1 ${plan!.plan.planSha256}`,
        43,
        "99999999-abcd-4321-abcd-1234567890ab",
      ),
      env,
      {} as ExecutionContext,
    );
    expect(implementation.status).toBe(202);
    const implementationResult = (await implementation.json()) as {
      runId: string;
    };
    expect(implementationResult.runId).toMatch(/^run_[a-f0-9]{40}$/);
    expect(queued.messages).toHaveLength(1);
    expect(comments).toBe(1);
    expect(statusComment?.body).toContain(
      `https://roundhouse-dev.rm-rf.rip/runs/${implementationResult.runId}`,
    );

    const planPage = await handler.fetch!(
      request(`/plans/${plan!.plan.planId}`),
      env,
      {} as ExecutionContext,
    );
    expect(planPage.headers.get("content-type")).toContain("text/html");
    await expect(
      handler.fetch!(
        request(`/v1/plans/${plan!.plan.planId}`),
        env,
        {} as ExecutionContext,
      ),
    ).resolves.toMatchObject({ status: 200 });
    const dashboard = await handler.fetch!(
      request("/v1/dashboard"),
      env,
      {} as ExecutionContext,
    );
    await expect(dashboard.json()).resolves.toMatchObject({
      plans: [{ status: "materialized", runId: implementationResult.runId }],
      runs: [{ runId: implementationResult.runId }],
    });
    const replayedUiApproval = await handler.fetch!(
      request(`/v1/plans/${plan!.plan.planId}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "ui-plan-replay-01",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: 1,
          planSha256: plan!.plan.planSha256,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(replayedUiApproval.status).toBe(409);
    await expect(replayedUiApproval.json()).resolves.toMatchObject({
      error: { message: "Existing plan approval actor does not match" },
    });
    expect(queued.messages).toHaveLength(1);

    const rejectedPayload = JSON.stringify({
      action: "created",
      installation: { id: 146147681 },
      repository: { full_name: "zorkian/roundhouse" },
      sender: { login: "outside-actor" },
      issue: { number: 17 },
      comment: {
        id: 42,
        body: "/rh status",
        user: { login: "outside-actor" },
      },
    });
    const rejectedMac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rejectedPayload),
    );
    const rejectedSignature = `sha256=${[...new Uint8Array(rejectedMac)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    const rejectedDelivery = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const rejectedWebhook = () =>
      new Request("http://roundhouse.local/v1/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": rejectedDelivery,
          "x-github-event": "issue_comment",
          "x-hub-signature-256": rejectedSignature,
        },
        body: rejectedPayload,
      }) as Request<unknown, IncomingRequestCfProperties>;
    const rejected = await handler.fetch!(
      rejectedWebhook(),
      env,
      {} as ExecutionContext,
    );
    expect(rejected.status).toBe(202);
    await expect(rejected.json()).resolves.toMatchObject({
      accepted: true,
      ignored: true,
    });
    const rejectionReceipt = await env.DB.prepare(
      "SELECT status, result_json FROM github_webhook_deliveries WHERE delivery_id = ?",
    )
      .bind(rejectedDelivery)
      .first<{ status: string; result_json: string }>();
    expect(rejectionReceipt).toMatchObject({ status: "ignored" });
    expect(JSON.parse(rejectionReceipt!.result_json)).toEqual({
      code: "unauthorized_actor",
    });
    const rejectedReplay = await handler.fetch!(
      rejectedWebhook(),
      env,
      {} as ExecutionContext,
    );
    expect(rejectedReplay.status).toBe(200);
    await expect(rejectedReplay.json()).resolves.toMatchObject({
      replayed: true,
    });

    const lowRisk = await handler.fetch!(
      await webhook(
        "/rh start",
        44,
        "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        18,
      ),
      env,
      {} as ExecutionContext,
    );
    expect(lowRisk.status).toBe(202);
    const lowRiskResult = (await lowRisk.json()) as {
      kind: string;
      runId: string;
    };
    expect(lowRiskResult).toMatchObject({ kind: "run" });
    expect(lowRiskResult.runId).toMatch(/^run_[a-f0-9]{40}$/);
    expect(await readIssuePlan(env, 18)).toMatchObject({
      status: "materialized",
      runId: lowRiskResult.runId,
      approvedBy: "github:zorkian",
    });
    expect(queued.messages).toHaveLength(2);
    expect(lowRiskStatusComment?.body).toContain(
      `https://roundhouse-dev.rm-rf.rip/runs/${lowRiskResult.runId}`,
    );
  });

  it("does not expose the retired direct issue-to-run administration route", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      request("/v1/github/issues/7/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "github-issue-submit-07",
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(submitted.status).toBe(404);
    expect(queued.messages).toHaveLength(0);
  });

  it("rejects nonliteral paths at trusted submission", async () => {
    const { env } = await runtime();
    env.EXECUTION_MODE = "cloudflare-trusted-codex";
    const handler = createControlPlaneHandler();
    const invalidPath = structuredClone(task);
    invalidPath.publication.branch = "codex/dogfood-trusted-path-boundary";
    const response = await handler.fetch!(
      submission("trusted-path-boundary-01", invalidPath),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(400);
    const invalidBranch = structuredClone(task);
    invalidBranch.allowedPaths = [
      "docs/dogfood/trusted-self-development-loop.md",
    ];
    expect(
      (
        await handler.fetch!(
          submission("trusted-branch-boundary-01", invalidBranch),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(400);
  });

  it("serves exact implementation evidence and rejects binding tampering", async () => {
    const { env } = await runtime();
    const value = await awaitingImplementation(env);
    const handler = createControlPlaneHandler();
    const response = await handler.fetch!(
      request(`/v1/runs/${value.runId}/implementation`),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runId: value.runId,
      patchSha256: value.result.patchSha256,
      changedFiles: value.result.changedFiles,
    });
    value.objects.delete(value.evidence.objectKey);
    expect(
      (
        await handler.fetch!(
          request(`/v1/runs/${value.runId}/implementation`),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(409);
    const run = await value.jobs.read(value.runId);
    const rejected = await handler.fetch!(
      request(`/v1/runs/${value.runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: run.revision,
          patchSha256: "f".repeat(64),
          evidence: [value.evidence],
          approver: "local-control-plane-operator",
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(rejected.status).toBe(409);
  });

  it("records actor-bound approval and exact publication state", async () => {
    const { env } = await runtime();
    const value = await awaitingImplementation(env);
    const handler = createControlPlaneHandler();
    const awaiting = await value.jobs.read(value.runId);
    const binding = {
      evidenceId: value.evidence.evidenceId,
      objectKey: value.evidence.objectKey,
      sha256: value.evidence.sha256,
      size: value.evidence.size,
    };
    const approvedResponse = await handler.fetch!(
      request(`/v1/runs/${value.runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: awaiting.revision,
          patchSha256: value.result.patchSha256,
          evidence: [binding],
          approver: "local-control-plane-operator",
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(approvedResponse.status).toBe(200);
    const approved = await value.jobs.read(value.runId);
    const rejectedDelegation = await handler.fetch!(
      request(`/v1/runs/${value.runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: approved.revision,
          patchSha256: value.result.patchSha256,
          evidence: [binding],
          approver: "mark-smith-delegated-trusted-loop-dogfood",
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(rejectedDelegation.status).toBe(403);
    const rejectedPublication = await handler.fetch!(
      request(`/v1/runs/${value.runId}/publication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: approved.revision,
          branch: "codex/dogfood-wrong-target",
          commit: "e".repeat(40),
          remoteUrl,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(rejectedPublication.status).toBe(409);
    const otherActor = createControlPlaneHandler({
      authorize: async () => ({
        authorized: true as const,
        actorId: "different-operator",
      }),
    });
    expect(
      (
        await otherActor.fetch!(
          request(`/v1/runs/${value.runId}/publication`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              schemaVersion: 1,
              expectedRevision: approved.revision,
              branch: "codex/dogfood-trusted-routes",
              commit: "e".repeat(40),
              remoteUrl,
            }),
          }),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(403);
    const published = await handler.fetch!(
      request(`/v1/runs/${value.runId}/publication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: approved.revision,
          branch: "codex/dogfood-trusted-routes",
          commit: "e".repeat(40),
          remoteUrl,
          pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/999",
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      state: "completed",
      publication: {
        branch: "codex/dogfood-trusted-routes",
        commit: "e".repeat(40),
      },
    });
  });

  it("publishes an approved run, reserves review, and starts bounded remediation", async () => {
    const { env, queued } = await runtime();
    const value = await awaitingImplementation(env);
    const handler = createControlPlaneHandler();
    const awaiting = await value.jobs.read(value.runId);
    const binding = {
      evidenceId: value.evidence.evidenceId,
      objectKey: value.evidence.objectKey,
      sha256: value.evidence.sha256,
      size: value.evidence.size,
    };
    const approvedResponse = await handler.fetch!(
      request(`/v1/runs/${value.runId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: awaiting.revision,
          patchSha256: value.result.patchSha256,
          evidence: [binding],
          approver: "local-control-plane-operator",
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(approvedResponse.status).toBe(200);
    const approved = await value.jobs.read(value.runId);
    const pair = await generateKeyPair("RS256", { extractable: true });
    env.GITHUB_APP_ID = "1";
    env.GITHUB_INSTALLATION_ID = "2";
    env.ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY = await exportPKCS8(pair.privateKey);
    env.INDEPENDENT_REVIEW_ENABLED = "true";
    env.GITHUB_REVIEW_CHECKS_ENABLED = "true";
    const tree = "c".repeat(40);
    const commit = "e".repeat(40);
    let branch: string | null = null;
    let pullWrites = 0;
    let reviewCheck:
      | {
          id: number;
          html_url: string;
          external_id: string;
          head_sha: string;
          status: string;
          conclusion: string | null;
          details_url: string;
          output: { title: string; summary: string };
        }
      | undefined;
    let checkWrites = 0;
    let issueStatusComment:
      { id: number; html_url: string; body: string } | undefined;
    let pullRequestStatusComment:
      { id: number; html_url: string; body: string } | undefined;
    env.GITHUB_API_FETCHER = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      if (url.pathname.endsWith("/access_tokens"))
        return new Response(
          JSON.stringify({
            token: "installation-token",
            expires_at: "2026-07-13T00:00:00Z",
          }),
          { status: 201 },
        );
      if (url.pathname.endsWith("/git/ref/heads/main"))
        return new Response(
          JSON.stringify({ object: { sha: approved.task.baseCommit } }),
        );
      if (url.pathname.endsWith(`/git/commits/${approved.task.baseCommit}`))
        return new Response(JSON.stringify({ tree: { sha: "b".repeat(40) } }));
      if (url.pathname.endsWith("/git/blobs") && method === "POST")
        return new Response(JSON.stringify({ sha: "a".repeat(40) }), {
          status: 201,
        });
      if (url.pathname.endsWith("/git/trees") && method === "POST")
        return new Response(JSON.stringify({ sha: tree }), { status: 201 });
      if (url.pathname.endsWith("/git/commits") && method === "POST")
        return new Response(JSON.stringify({ sha: commit }), { status: 201 });
      if (url.pathname.includes("/git/ref/heads/"))
        return branch
          ? new Response(JSON.stringify({ object: { sha: branch } }))
          : new Response("{}", { status: 404 });
      if (url.pathname.endsWith("/git/refs") && method === "POST") {
        branch = commit;
        return new Response("{}", { status: 201 });
      }
      if (url.pathname.endsWith("/pulls") && method === "GET")
        return new Response(
          JSON.stringify(
            pullWrites === 0
              ? []
              : [
                  {
                    number: 11,
                    html_url: "https://github.com/zorkian/roundhouse/pull/11",
                    head: { sha: commit },
                  },
                ],
          ),
        );
      if (url.pathname.endsWith("/pulls") && method === "POST") {
        pullWrites += 1;
        return new Response(
          JSON.stringify({
            number: 11,
            html_url: "https://github.com/zorkian/roundhouse/pull/11",
            head: { sha: commit },
          }),
          { status: 201 },
        );
      }
      if (url.pathname.endsWith(`/git/commits/${commit}`))
        return new Response(
          JSON.stringify({
            sha: commit,
            tree: { sha: tree },
            parents: [{ sha: approved.task.baseCommit }],
          }),
        );
      if (url.pathname.endsWith("/issues/7/comments") && method === "GET")
        return new Response(
          JSON.stringify(issueStatusComment ? [issueStatusComment] : []),
        );
      if (url.pathname.endsWith("/issues/7/comments") && method === "POST") {
        issueStatusComment = {
          id: 51,
          html_url:
            "https://github.com/zorkian/roundhouse/issues/7#issuecomment-51",
          body: String(body?.body),
        };
        return new Response(JSON.stringify(issueStatusComment), {
          status: 201,
        });
      }
      if (url.pathname.endsWith("/issues/comments/51") && method === "PATCH") {
        issueStatusComment = {
          ...issueStatusComment!,
          body: String(body?.body),
        };
        return new Response(JSON.stringify(issueStatusComment));
      }
      if (url.pathname.endsWith("/issues/11/comments") && method === "GET")
        return new Response(
          JSON.stringify(
            pullRequestStatusComment ? [pullRequestStatusComment] : [],
          ),
        );
      if (url.pathname.endsWith("/issues/11/comments") && method === "POST") {
        pullRequestStatusComment = {
          id: 52,
          html_url:
            "https://github.com/zorkian/roundhouse/issues/11#issuecomment-52",
          body: String(body?.body),
        };
        return new Response(JSON.stringify(pullRequestStatusComment), {
          status: 201,
        });
      }
      if (url.pathname.endsWith("/issues/comments/52") && method === "PATCH") {
        pullRequestStatusComment = {
          ...pullRequestStatusComment!,
          body: String(body?.body),
        };
        return new Response(JSON.stringify(pullRequestStatusComment));
      }
      if (
        url.pathname.endsWith(`/commits/${commit}/check-runs`) &&
        method === "GET"
      )
        return new Response(
          JSON.stringify({ check_runs: reviewCheck ? [reviewCheck] : [] }),
        );
      if (url.pathname.endsWith("/check-runs") && method === "POST") {
        checkWrites += 1;
        reviewCheck = {
          id: 41,
          html_url: "https://github.com/zorkian/roundhouse/runs/41",
          external_id: String(body?.external_id),
          head_sha: String(body?.head_sha),
          status: String(body?.status),
          conclusion: (body?.conclusion as string | undefined) ?? null,
          details_url: String(body?.details_url),
          output: body?.output as { title: string; summary: string },
        };
        return new Response(JSON.stringify(reviewCheck), { status: 201 });
      }
      if (url.pathname.endsWith("/check-runs/41") && method === "PATCH") {
        checkWrites += 1;
        reviewCheck = {
          ...reviewCheck!,
          status: String(body?.status),
          conclusion: (body?.conclusion as string | undefined) ?? null,
          details_url: String(body?.details_url),
          output: body?.output as { title: string; summary: string },
        };
        return new Response(JSON.stringify(reviewCheck));
      }
      return new Response("{}", { status: 404 });
    };
    const publicationRequest = () =>
      request(`/v1/runs/${value.runId}/github-publication`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "github-publish-route-01",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: approved.revision,
        }),
      });
    const first = await handler.fetch!(
      publicationRequest(),
      env,
      {} as ExecutionContext,
    );
    const replay = await handler.fetch!(
      publicationRequest(),
      env,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      review: { request: { reviewId: string } };
    };
    expect(await replay.json()).toEqual(firstBody);
    expect(pullWrites).toBe(1);
    await expect(
      env.DB.prepare(
        "SELECT head_sha, check_status, conclusion, status FROM github_review_check_outbox WHERE repository_full_name = ? AND review_id = ?",
      )
        .bind("zorkian/roundhouse", firstBody.review.request.reviewId)
        .first(),
    ).resolves.toMatchObject({
      head_sha: commit,
      check_status: "in_progress",
      conclusion: null,
      status: "pending",
    });
    expect(
      queued.messages.filter(
        (message) =>
          (message as { kind?: string }).kind === "independent_review",
      ),
    ).toHaveLength(1);
    await expect(value.jobs.read(value.runId)).resolves.toMatchObject({
      state: "completed",
      publication: {
        commit,
        pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/11",
      },
    });
    env.ROUNDHOUSE_CLAUDE_AUTH_JSON = JSON.stringify({
      oauthToken: `setup-token-${"s".repeat(80)}`,
    });
    env.EXECUTION_CONTAINERS = {
      getByName: () => ({
        runJob: async () => {
          throw new Error("ordinary execution is not expected in this test");
        },
        runReviewJob: async (review) => ({
          schemaVersion: 1,
          reviewId: review.reviewId,
          attemptId: review.attemptId,
          cycle: review.cycle,
          runId: review.runId,
          baseCommit: review.baseCommit,
          headCommit: review.headCommit,
          patchSha256: review.patchSha256,
          startedAt: "2026-07-12T00:04:00.000Z",
          completedAt: "2026-07-12T00:04:01.000Z",
          startupDurationMs: 1,
          provider: "claude-subscription",
          model: "claude-sonnet-4-6",
          summary: "One material finding.",
          findings: await normalizeReviewFindings(
            review.reviewId,
            review.headCommit,
            [
              {
                severity: "medium",
                path: review.allowedPaths[0]!,
                title: "Correct the exact implementation",
                rationale: "The implementation misses the requested case.",
                recommendation: "Handle the requested case.",
              },
            ],
            review.maxFindings,
          ),
          outputBytes: 100,
          usage: { inputTokens: 10, outputTokens: 10, turns: 1 },
          network: {
            checkoutHosts: ["github.com"],
            modelHosts: ["api.anthropic.com"],
            reviewerToolsEnabled: false,
            arbitraryInternetEnabled: false,
            deniedHttpProbe: true,
            deniedTcpProbe: true,
          },
          credential: {
            installedAtRuntime: true,
            writtenToFilesystem: false,
            absentFromEvidence: true,
          },
          resources: { diskBytes: 1, memoryBytes: 1 },
        }),
        destroy: async () => undefined,
      }),
    };
    const reviewDelivery = queued.messages.find(
      (message) => (message as { kind?: string }).kind === "independent_review",
    )!;
    await expect(deliver(handler, env, [reviewDelivery])).resolves.toEqual([
      "ack:0",
    ]);
    const reviewResponse = await handler.fetch!(
      request(`/v1/reviews/${firstBody.review.request.reviewId}`),
      env,
      {} as ExecutionContext,
    );
    expect(await reviewResponse.json()).toMatchObject({
      status: "remediated",
      request: { headCommit: commit, cycle: 1 },
      remediationRunId: expect.stringMatching(/^run_/),
    });
    expect(checkWrites).toBe(1);
    expect(reviewCheck).toMatchObject({
      head_sha: commit,
      status: "completed",
      conclusion: "neutral",
      output: { title: "Independent review found 1 substantive finding" },
    });
    expect(issueStatusComment?.body).toContain(
      `Workflow: https://roundhouse-dev.rm-rf.rip/repositories/zorkian/roundhouse/issues/7`,
    );
    expect(pullRequestStatusComment?.body).toContain(
      `Exact pull-request head: \`${commit}\``,
    );
    const reviewEvidence = await handler.fetch!(
      request(`/v1/reviews/${firstBody.review.request.reviewId}/evidence`),
      env,
      {} as ExecutionContext,
    );
    expect(reviewEvidence.status).toBe(200);
    expect(await reviewEvidence.json()).toMatchObject({
      reviewId: firstBody.review.request.reviewId,
      headCommit: commit,
    });
    expect(
      queued.messages.some(
        (message) =>
          (message as { runId?: string; kind?: string }).runId &&
          !(message as { kind?: string }).kind,
      ),
    ).toBe(true);
  });
  it("enforces authentication and safe request boundaries", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      (
        await handler.fetch!(
          request("/health", {}, false),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler.fetch!(
          request("/ready", {}, false),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler.fetch!(
          request("/v1/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "invalid-json",
            },
            body: "{",
          }),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler.fetch!(
          request("/v1/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "oversized-body-01",
            },
            body: JSON.stringify("x".repeat(65_537)),
          }),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(413);
    const unenrolled = structuredClone(task);
    unenrolled.repositoryPath = "/arbitrary/repository";
    expect(
      (
        await handler.fetch!(
          submission("unenrolled-01", unenrolled),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler.fetch!(
          request("/v1/repositories/another/roundhouse/issues/7"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handler.fetch!(
          request(
            `/v1/repositories/zorkian/roundhouse/issues/${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`,
          ),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(400);
    const enrolledIssue = await handler.fetch!(
      request("/v1/repositories/zorkian/roundhouse/issues/999"),
      env,
      {} as ExecutionContext,
    );
    expect(enrolledIssue.status).toBe(200);
    expect(await enrolledIssue.json()).toEqual({
      schemaVersion: 1,
      repositoryFullName: "zorkian/roundhouse",
      issueNumber: 999,
      plan: null,
      reviews: [],
    });
  });

  it("recovers a pending outbox, deduplicates submission and delivery, and redacts inspection", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    queued.failNext = true;
    expect(
      (
        await handler.fetch!(
          submission("outbox-recovery-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(500);
    const recovered = await handler.fetch!(
      submission("outbox-recovery-01"),
      env,
      {} as ExecutionContext,
    );
    expect(recovered.status).toBe(200);
    const response = (await recovered.json()) as {
      runId: string;
      created: boolean;
    };
    expect(response.created).toBe(false);
    expect(queued.messages).toHaveLength(1);
    expect(
      (
        await handler.fetch!(
          submission("outbox-recovery-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(200);
    expect(queued.messages).toHaveLength(1);
    expect(
      await deliver(handler, env, [queued.messages[0], queued.messages[0]]),
    ).toEqual(["ack:0", "ack:1"]);
    expect((await new D1JobStore(env.DB).read(response.runId)).state).toBe(
      "workspace_ready",
    );

    const inspected = await handler.fetch!(
      request(`/v1/runs/${response.runId}`),
      env,
      {} as ExecutionContext,
    );
    const text = await inspected.text();
    expect(inspected.status).toBe(200);
    expect(text).not.toContain(task.instructions);
    expect(text).toContain(task.subject);
    expect(text).toContain(task.baseCommit);
    expect(text).not.toContain(task.repositoryPath);
    expect(text).not.toContain("lease");
    expect(text).not.toContain("workspacePath");
  });

  it("repairs interruption between submission reservation and run creation", async () => {
    const { env, queued } = await runtime();
    const key = "reservation-recovery-01";
    const reserved = await reserveSubmission(env.DB, key, task, new Date());
    expect(reserved.created).toBe(true);
    await expect(
      new D1JobStore(env.DB).read(reserved.row.run_id),
    ).rejects.toThrow("Run not found");

    const handler = createControlPlaneHandler();
    const response = await handler.fetch!(
      submission(key),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect((await new D1JobStore(env.DB).read(reserved.row.run_id)).state).toBe(
      "created",
    );
    expect(queued.messages).toHaveLength(1);
  });

  it("repairs an API interruption before Queue delivery", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    env.SUBMISSION_SCENARIO = "interrupt-before-delivery";
    const interrupted = await handler.fetch!(
      submission("submission-interruption-01"),
      env,
      {} as ExecutionContext,
    );
    expect(interrupted.status).toBe(500);
    expect(queued.messages).toHaveLength(0);
    env.SUBMISSION_SCENARIO = "success";
    await handler.scheduled!(
      {} as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    const reservation = await reserveSubmission(
      env.DB,
      "submission-interruption-01",
      task,
      new Date(),
    );
    expect(queued.messages).toEqual([
      expect.objectContaining({ runId: reservation.row.run_id }),
    ]);
    expect(reservation.row.delivery_state).toBe("sent");
  });

  it("rejects conflicting idempotency reuse", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      (
        await handler.fetch!(
          submission("idempotency-conflict-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(201);
    const changed = structuredClone(task);
    changed.subject = "Different request";
    expect(
      (
        await handler.fetch!(
          submission("idempotency-conflict-01", changed),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(409);
  });

  it("restarts over durable D1 state and reclaims an interrupted expired attempt", async () => {
    const { env, queued } = await runtime();
    const firstHandler = createControlPlaneHandler();
    const submitted = await firstHandler.fetch!(
      submission("restart-reclaim-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const jobs = new D1JobStore(env.DB);
    const past = new Date("2020-01-01T00:00:00Z");
    const claim = await jobs.claim(runId, "crashed-worker", past, 1_000, 1);
    await jobs.startAttempt(runId, claim!.token, "prepare", past);
    const interrupted = await jobs.read(runId);
    const replay: RunDelivery = {
      ...(queued.messages[0] as RunDelivery),
      expectedRevision: interrupted.revision,
    };

    const restartedHandler = createControlPlaneHandler();
    expect(await deliver(restartedHandler, env, [replay])).toEqual(["ack:0"]);
    const recovered = await new D1JobStore(env.DB).read(runId);
    expect(recovered.state).toBe("workspace_ready");
    expect(recovered.attempts).toMatchObject([
      { status: "failed", classification: "lease_expired", retryable: true },
      { status: "succeeded" },
    ]);
  });

  it("cancels an authenticated run durably before queued execution", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("cancel-run-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const current = await new D1JobStore(env.DB).read(runId);

    const cancelled = await handler.fetch!(
      request(`/v1/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: current.revision,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      runId,
      state: "cancelled",
    });
    expect(await deliver(handler, env, [queued.messages[0]])).toEqual([
      "ack:0",
    ]);
    const durable = await new D1JobStore(env.DB).read(runId);
    expect(durable.state).toBe("cancelled");
    expect(durable.attempts).toHaveLength(0);
    expect(durable.events.at(-1)?.type).toBe("run.cancelled");
  });

  it("durably alerts when cancellation cannot tear down a Container", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("cancel-cleanup-alert-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const jobs = new D1JobStore(env.DB);
    const now = new Date("2026-07-12T18:00:00Z");
    const claim = await jobs.claim(runId, "container-worker", now, 300_000, 1);
    await jobs.startAttempt(runId, claim!.token, "prepare", now);
    const running = await jobs.read(runId);
    env.EXECUTION_MODE = "cloudflare-container";
    let destroyAttempts = 0;
    env.EXECUTION_CONTAINERS = {
      getByName: () => ({
        destroy: async () => {
          destroyAttempts += 1;
          throw new Error("teardown failed at /sensitive/local/path");
        },
      }),
    } as unknown as ControlPlaneEnv["EXECUTION_CONTAINERS"];

    const cancelled = await handler.fetch!(
      request(`/v1/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: running.revision,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(cancelled.status).toBe(200);
    const cancelledBody = (await cancelled.json()) as { revision: number };
    expect(destroyAttempts).toBe(1);
    const repeated = await handler.fetch!(
      request(`/v1/runs/${runId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: cancelledBody.revision,
        }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(repeated.status).toBe(200);
    expect(destroyAttempts).toBe(1);
    const alerts = await handler.fetch!(
      request("/v1/operations/alerts"),
      env,
      {} as ExecutionContext,
    );
    const body = (await alerts.json()) as {
      alerts: Array<Record<string, unknown>>;
    };
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({
      kind: "container_cleanup_failed",
      severity: "error",
      runId,
      occurrences: 1,
    });
    expect(JSON.stringify(body)).not.toContain("/sensitive/local/path");
  });

  it("acks malformed messages and durably records terminal dispatch failure", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      await deliver(handler, env, [
        { schemaVersion: 1, runId: "missing-fields" },
      ]),
    ).toEqual(["ack:0"]);
    const submitted = await handler.fetch!(
      submission("terminal-failure-01", {
        ...task,
        source: {
          kind: "github_issue",
          owner: "zorkian",
          repository: "roundhouse",
          issueNumber: 33,
          issueUrl: "https://github.com/zorkian/roundhouse/issues/33",
          nodeId: "I_kwDOFailureDiagnostic",
          contentSha256: "a".repeat(64),
          updatedAt: "2026-07-13T00:00:00.000Z",
        },
      }),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    env.EXECUTION_MODE = "disabled";
    expect(await deliver(handler, env, [queued.messages[0]])).toEqual([
      "ack:0",
    ]);
    const failed = await new D1JobStore(env.DB).read(runId);
    expect(failed.state).toBe("failed");
    expect(failed.attempts[0]).toMatchObject({
      status: "failed",
      retryable: false,
      classification: "unexpected",
    });
    const inspection = await handler.fetch!(
      request(`/v1/runs/${runId}`),
      env,
      {} as ExecutionContext,
    );
    expect(await inspection.text()).not.toContain(
      "No authorized execution dispatcher",
    );
    const failureComment = await env.DB.prepare(
      "SELECT body FROM github_comment_outbox WHERE comment_key LIKE 'run-failure:%'",
    ).first<{ body: string }>();
    expect(failureComment?.body).toContain("failed during `prepare`");
    expect(failureComment?.body).toContain(
      "Failure classification: `unexpected`",
    );
    expect(failureComment?.body).toContain(`/rh retry ${runId}`);
  });

  it("emits revision-bound retries and stops at the attempt limit", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("bounded-retries-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    env.EXECUTION_MODE = "retryable-local";

    expect(await deliver(handler, env, [queued.messages[0]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(2);
    expect(await deliver(handler, env, [queued.messages[1]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(3);
    expect(await deliver(handler, env, [queued.messages[2]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(3);

    const failed = await new D1JobStore(env.DB).read(runId);
    expect(failed.state).toBe("failed");
    expect(failed.attempts).toHaveLength(3);
    expect(failed.attempts.every((attempt) => attempt.retryable)).toBe(true);
    expect(
      failed.attempts.every(
        (attempt) => attempt.classification === "dispatch_unavailable",
      ),
    ).toBe(true);
  });

  it("authenticates and validates operator recovery and reporting routes", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    const unauthorized = await handler.fetch!(
      request("/v1/operations/alerts", {}, false),
      env,
      {} as ExecutionContext,
    );
    expect(unauthorized.status).toBe(401);
    const alerts = await handler.fetch!(
      request("/v1/operations/alerts"),
      env,
      {} as ExecutionContext,
    );
    expect(alerts.status).toBe(200);
    await expect(alerts.json()).resolves.toMatchObject({ alerts: [] });
    const retention = await handler.fetch!(
      request("/v1/operations/retention"),
      env,
      {} as ExecutionContext,
    );
    await expect(retention.json()).resolves.toMatchObject({
      dryRun: true,
      deletions: [],
    });
    const emptyHistory = await handler.fetch!(
      request("/v1/operations/recovery-cycles"),
      env,
      {} as ExecutionContext,
    );
    await expect(emptyHistory.json()).resolves.toEqual({
      schemaVersion: 1,
      cycles: [],
    });
    const recoveryRequest = () =>
      request("/v1/operations/recover", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operator-recovery-route-01",
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      });
    const first = await handler.fetch!(
      recoveryRequest(),
      env,
      {} as ExecutionContext,
    );
    const replay = await handler.fetch!(
      recoveryRequest(),
      env,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const history = await handler.fetch!(
      request("/v1/operations/recovery-cycles"),
      env,
      {} as ExecutionContext,
    );
    const historyBody = (await history.json()) as {
      cycles: Array<Record<string, unknown>>;
    };
    expect(historyBody.cycles).toHaveLength(1);
    expect(historyBody.cycles[0]).toMatchObject({
      actorId: "roundhouse:scheduler",
      repairedSubmissions: 0,
      requeuedRuns: 0,
      alertsRecorded: 0,
    });
    const invalidRecovery = await handler.fetch!(
      request("/v1/operations/recover", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "invalid-recovery-route-01",
        },
        body: JSON.stringify({}),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(invalidRecovery.status).toBe(400);
    const invalidRetry = await handler.fetch!(
      request("/v1/runs/run_missing/retry", {
        method: "POST",
        headers: { "idempotency-key": "invalid-retry-route-01" },
        body: JSON.stringify({ schemaVersion: 1, expectedRevision: 1 }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(invalidRetry.status).toBe(415);
    const missingRetry = await handler.fetch!(
      request("/v1/runs/run_missing/retry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "missing-retry-route-01",
        },
        body: JSON.stringify({ schemaVersion: 1, expectedRevision: 1 }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(missingRetry.status).toBe(404);
    const submitted = await handler.fetch!(
      submission("ineligible-retry-route-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const ineligibleRetry = await handler.fetch!(
      request(`/v1/runs/${runId}/retry`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "ineligible-retry-route-01",
        },
        body: JSON.stringify({ schemaVersion: 1, expectedRevision: 1 }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(ineligibleRetry.status).toBe(409);
  });

  it("repairs retry enqueue failure before acknowledging the delivery", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("retry-outbox-repair-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const original = queued.messages[0];
    env.EXECUTION_MODE = "retryable-local";
    queued.failNext = true;

    expect(await deliver(handler, env, [original])).toEqual(["retry:0"]);
    expect(queued.messages).toHaveLength(1);
    const durable = await new D1JobStore(env.DB).read(runId);
    expect(durable.state).toBe("created");
    expect(durable.attempts[0]).toMatchObject({
      status: "failed",
      retryable: true,
      classification: "dispatch_unavailable",
    });

    expect(await deliver(handler, env, [original])).toEqual(["ack:0"]);
    expect(queued.messages).toHaveLength(2);
    expect(queued.messages[1]).toMatchObject({
      runId,
      expectedRevision: durable.revision,
    });
  });

  it("replays an operator retry whose Queue dispatch is recovered later", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("operator-retry-dispatch-repair-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const jobs = new D1JobStore(env.DB);
    const now = new Date("2026-07-12T18:00:00Z");
    const claim = await jobs.claim(runId, "worker", now, 300_000, 1);
    await jobs.startAttempt(runId, claim!.token, "prepare", now);
    const failed = await jobs.failAttempt(
      runId,
      claim!.token,
      "prepare",
      { retryable: true, classification: "transient", error: "retry me" },
      true,
      now,
    );
    const retryRequest = () =>
      request(`/v1/runs/${runId}/retry`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operator-retry-dispatch-repair-01",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: failed.revision,
        }),
      });
    queued.failNext = true;
    const first = await handler.fetch!(
      retryRequest(),
      env,
      {} as ExecutionContext,
    );
    const replay = await handler.fetch!(
      retryRequest(),
      env,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(queued.messages).toHaveLength(1);

    await handler.scheduled!(
      {} as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(queued.messages).toHaveLength(2);
    expect(queued.messages[1]).toMatchObject({ runId });
    const alerts = await handler.fetch!(
      request("/v1/operations/alerts"),
      env,
      {} as ExecutionContext,
    );
    const alertBody = (await alerts.json()) as {
      alerts: Array<Record<string, unknown>>;
    };
    expect(alertBody.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "retry_dispatch_failed",
          runId,
          occurrences: 1,
        }),
        expect.objectContaining({
          kind: "lease_less_run_requeued",
          runId,
        }),
      ]),
    );
  });

  it("redacts scheduled recovery failures in durable alerts", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    await handler.fetch!(
      submission("scheduled-recovery-redaction-01"),
      env,
      {} as ExecutionContext,
    );
    env.RUN_QUEUE = {
      send: async () => {
        throw new Error(
          "recovery failed at https://internal.example.invalid/token and /private/workspace/path",
        );
      },
    } as unknown as Queue<unknown>;

    await expect(
      handler.scheduled!(
        {} as ScheduledController,
        env,
        {} as ExecutionContext,
      ),
    ).rejects.toThrow("recovery failed");
    const alerts = await handler.fetch!(
      request("/v1/operations/alerts"),
      env,
      {} as ExecutionContext,
    );
    const text = await alerts.text();
    expect(text).toContain("scheduled_recovery_failed");
    expect(text).toContain("[url]");
    expect(text).toContain("[path]");
    expect(text).not.toContain("internal.example.invalid");
    expect(text).not.toContain("/private/workspace/path");
  });

  it("does not report deferred GitHub comments as recovery-cycle failures", async () => {
    const { env } = await runtime();
    await enqueueComment(
      env,
      "scheduled-comment-failure",
      17,
      "Deliver me after GitHub recovers",
    );
    const handler = createControlPlaneHandler();

    await expect(
      handler.scheduled!(
        {} as ScheduledController,
        env,
        {} as ExecutionContext,
      ),
    ).resolves.toBeUndefined();
    const row = await env.DB.prepare(
      "SELECT status FROM github_comment_outbox WHERE comment_key = 'scheduled-comment-failure'",
    ).first<{ status: string }>();
    expect(row?.status).toBe("pending");
    const alert = await env.DB.prepare(
      "SELECT alert_key FROM operational_alerts WHERE alert_key = 'scheduled_recovery_failed'",
    ).first<{ alert_key: string }>();
    expect(alert).toBeNull();
  });
});
