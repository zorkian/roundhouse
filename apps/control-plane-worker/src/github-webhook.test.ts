// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  bindIssueRun,
  claimPendingComments,
  completeWebhookDelivery,
  enqueueComment,
  exactPublishedCheckTargets,
  githubNativeOperatorMigration,
  issueRun,
  parseGitHubCommand,
  reserveWebhookDelivery,
  verifyGitHubSignature,
  verifyWebhookRequest,
} from "./github-webhook.js";

const instances: Miniflare[] = [];

async function runtime(): Promise<ControlPlaneEnv> {
  const instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "github-webhook-test" },
  });
  instances.push(instance);
  const db = await instance.getD1Database("DB");
  for (const statement of githubNativeOperatorMigration
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  return {
    DB: db,
    RUN_QUEUE: { send: async () => undefined } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
    GITHUB_INSTALLATION_ID: "146147681",
    GITHUB_APP_ID: "4281837",
    ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "webhook-test-secret",
  };
}

async function signature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `sha256=${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((value) => value.dispose()));
});

describe("GitHub-native operator webhook", () => {
  it("parses only exact bounded commands", () => {
    expect(parseGitHubCommand("/rh start")).toEqual({ kind: "start" });
    expect(parseGitHubCommand("/rh status run_123")).toEqual({
      kind: "status",
      runId: "run_123",
    });
    expect(parseGitHubCommand("/rh retry run_123 7")).toEqual({
      kind: "retry",
      runId: "run_123",
      revision: 7,
    });
    expect(
      parseGitHubCommand(
        `/rh approve run_123 8 ${"a".repeat(40)} ${"b".repeat(64)} ${"c".repeat(64)}`,
      ),
    ).toMatchObject({ kind: "approve", revision: 8 });
    expect(parseGitHubCommand("please /rh start")).toBeNull();
    expect(parseGitHubCommand("/rh shell rm -rf /")).toBeNull();
    expect(parseGitHubCommand("/rh retry run_123 latest")).toBeNull();
  });

  it("verifies the exact bytes with HMAC-SHA-256", async () => {
    const body = new TextEncoder().encode('{"hello":"world"}');
    const valid = await signature('{"hello":"world"}', "secret");
    await expect(verifyGitHubSignature(body, valid, "secret")).resolves.toBe(
      true,
    );
    await expect(
      verifyGitHubSignature(body, valid, "another-secret"),
    ).resolves.toBe(false);
    await expect(
      verifyGitHubSignature(body, "sha256=not-a-hash", "secret"),
    ).resolves.toBe(false);
  });

  it("fails closed for the wrong installation and deduplicates exact deliveries", async () => {
    const env = await runtime();
    const value = {
      installation: { id: 146147681 },
      repository: { full_name: "zorkian/roundhouse" },
      sender: { login: "zorkian" },
      action: "created",
    };
    const body = JSON.stringify(value);
    const request = (payload: string, delivery: string) =>
      new Request("https://roundhouse-dev.rm-rf.rip/v1/github/webhook", {
        method: "POST",
        headers: {
          "x-github-delivery": delivery,
          "x-github-event": "issue_comment",
          "x-hub-signature-256": "placeholder",
        },
        body: payload,
      });
    const validRequest = request(body, "12345678-abcd");
    validRequest.headers.set(
      "x-hub-signature-256",
      await signature(body, "webhook-test-secret"),
    );
    const verified = await verifyWebhookRequest(validRequest, env);
    const initial = await reserveWebhookDelivery(env, verified);
    expect(initial).toMatchObject({ kind: "new" });
    await expect(reserveWebhookDelivery(env, verified)).resolves.toEqual({
      kind: "in_progress",
    });
    if (initial.kind !== "new") throw new Error("expected delivery claim");
    await completeWebhookDelivery(
      env,
      verified.deliveryId,
      initial.claimId,
      "failed",
      {},
    );
    const retries = await Promise.all([
      reserveWebhookDelivery(env, verified),
      reserveWebhookDelivery(env, verified),
    ]);
    expect(retries.map((value) => value.kind)).toEqual(
      expect.arrayContaining(["new", "in_progress"]),
    );
    const retryClaim = retries.find((value) => value.kind === "new");
    if (!retryClaim || retryClaim.kind !== "new")
      throw new Error("expected retry claim");
    await env.DB.prepare(
      "UPDATE github_webhook_deliveries SET claim_expires_at = ? WHERE delivery_id = ?",
    )
      .bind("1970-01-01T00:00:00.000Z", verified.deliveryId)
      .run();
    const reclaimed = await reserveWebhookDelivery(env, verified);
    expect(reclaimed).toMatchObject({ kind: "new" });
    if (reclaimed.kind !== "new") throw new Error("expected stale reclaim");
    await completeWebhookDelivery(
      env,
      verified.deliveryId,
      reclaimed.claimId,
      "completed",
      {},
    );
    await expect(reserveWebhookDelivery(env, verified)).resolves.toEqual({
      kind: "replay",
    });

    const wrong = JSON.stringify({
      ...value,
      installation: { id: 9 },
    });
    const wrongRequest = request(wrong, "12345678-abce");
    wrongRequest.headers.set(
      "x-hub-signature-256",
      await signature(wrong, "webhook-test-secret"),
    );
    await expect(verifyWebhookRequest(wrongRequest, env)).rejects.toMatchObject(
      { status: 403, code: "unenrolled_source" },
    );

    const missingConfigRequest = request(body, "12345678-abcf");
    missingConfigRequest.headers.set(
      "x-hub-signature-256",
      await signature(body, "webhook-test-secret"),
    );
    await expect(
      verifyWebhookRequest(missingConfigRequest, {
        ...env,
        GITHUB_INSTALLATION_ID: undefined,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "installation_not_configured",
    });
  });

  it("persists issue bindings and idempotent comment intents", async () => {
    const env = await runtime();
    await bindIssueRun(env, 19, "run_19");
    await bindIssueRun(env, 19, "run_19");
    await expect(issueRun(env, 19)).resolves.toBe("run_19");
    await expect(bindIssueRun(env, 19, "run_other")).rejects.toMatchObject({
      code: "issue_already_bound",
    });
    await enqueueComment(env, "run_19:1", 19, "status");
    await enqueueComment(env, "run_19:1", 19, "status");
    await expect(
      enqueueComment(env, "run_19:1", 19, "different status"),
    ).rejects.toMatchObject({ code: "comment_intent_conflict" });
    const claims = await Promise.all([
      claimPendingComments(env),
      claimPendingComments(env),
    ]);
    expect(claims.flat()).toHaveLength(1);
    expect(claims.flat()[0]).toMatchObject({
      key: "run_19:1",
      issueNumber: 19,
      body: "status",
    });
  });

  it("rejects a correctly signed but unsubscribed event", async () => {
    const env = await runtime();
    const body = JSON.stringify({
      installation: { id: 146147681 },
      repository: { full_name: "zorkian/roundhouse" },
      sender: { login: "zorkian" },
    });
    const request = new Request(
      "https://roundhouse-dev.rm-rf.rip/v1/github/webhook",
      {
        method: "POST",
        headers: {
          "x-github-delivery": "12345678-abcd-4321-abcd-1234567890ab",
          "x-github-event": "push",
          "x-hub-signature-256": await signature(body, "webhook-test-secret"),
        },
        body,
      },
    );
    await expect(verifyWebhookRequest(request, env)).rejects.toMatchObject({
      status: 400,
      code: "unsupported_event",
    });

    const pingBody = JSON.stringify({
      hook_id: 652140611,
      hook: {
        type: "App",
        id: 652140611,
        active: true,
        app_id: 4281837,
        config: {
          content_type: "json",
          insecure_ssl: "0",
          url: "https://roundhouse-dev.rm-rf.rip/v1/github/webhook",
        },
      },
    });
    const ping = new Request(
      "https://roundhouse-dev.rm-rf.rip/v1/github/webhook",
      {
        method: "POST",
        headers: {
          "x-github-delivery": "87654321-abcd-4321-abcd-1234567890ab",
          "x-github-event": "ping",
          "x-hub-signature-256": await signature(
            pingBody,
            "webhook-test-secret",
          ),
        },
        body: pingBody,
      },
    );
    await expect(verifyWebhookRequest(ping, env)).resolves.toMatchObject({
      eventName: "ping",
    });
  });

  it("stops reading a webhook after the bounded body limit", async () => {
    const env = await runtime();
    const request = new Request(
      "https://roundhouse-dev.rm-rf.rip/v1/github/webhook",
      {
        method: "POST",
        headers: {
          "x-github-delivery": "12345678-abcd-4321-abcd-1234567890ab",
          "x-github-event": "issue_comment",
          "x-hub-signature-256": `sha256=${"a".repeat(64)}`,
        },
        body: new Uint8Array(1024 * 1024 + 1),
      },
    );
    await expect(verifyWebhookRequest(request, env)).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
  });

  it("reports checks only for the exact Roundhouse-published head", async () => {
    const env = await runtime();
    const runId = "run_exact_head";
    const commit = "d".repeat(40);
    await bindIssueRun(env, 23, runId);
    await env.DB.prepare(
      "CREATE TABLE github_publications (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, result_json TEXT)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO github_publications(run_id, status, result_json) VALUES (?, 'published', ?)",
    )
      .bind(runId, JSON.stringify({ pullRequestNumber: 31, commit }))
      .run();
    const observations = [
      {
        pullRequestNumber: 31,
        headSha: commit,
        key: "check_run:1",
        status: "completed",
        conclusion: "success",
      },
      {
        pullRequestNumber: 31,
        headSha: "e".repeat(40),
        key: "check_run:2",
        status: "completed",
        conclusion: "success",
      },
    ];
    await expect(
      exactPublishedCheckTargets(env, observations),
    ).resolves.toEqual([
      {
        runId,
        issueNumber: 23,
        ...observations[0],
      },
    ]);
  });
});
