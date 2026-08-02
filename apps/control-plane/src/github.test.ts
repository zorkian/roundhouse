// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  createRun,
  MemoryRunRepository,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import { signCallback } from "./callback.js";
import { aggregateReviewAttempts } from "./coordinator.js";
import {
  acceptGitHubComment,
  acceptGitHubIssueClosed,
  GitHubClient,
  GitHubStageReporter,
  loadDefaultBranchProfile,
  operatorAuthorized,
  verifyGitHubWebhook,
  type GitHubApi,
  type GitHubEnv,
} from "./github.js";

const env = {
  GITHUB_APP_ID: "development-app",
  GITHUB_START_COMMAND: "/roundhouse-dev start",
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: "not-used-by-fake",
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "webhook-secret",
} satisfies GitHubEnv;

class IntakeRepository extends MemoryRunRepository {
  readonly deliveries = new Set<string>();
  readonly issueStates = new Map<string, "open" | "closed">();
  readonly promotionIntakes: Array<{
    conversationId: string;
    briefId: string;
    issueNumber: number;
    actorGithubLogin: string;
    accepted: boolean;
    runId?: string;
    runUrl?: string;
    errorCode?: string;
  }> = [];

  async setGitHubIssueState(runId: string, state: "open" | "closed") {
    this.issueStates.set(runId, state);
  }

  async recordGitHubDelivery(
    _runId: string,
    deliveryId: string,
    _payload: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    if (this.deliveries.has(deliveryId)) return false;
    this.deliveries.add(deliveryId);
    return true;
  }

  async recordConversationPromotionIntake(
    input: (typeof this.promotionIntakes)[number],
  ): Promise<boolean> {
    this.promotionIntakes.push(input);
    return true;
  }
}

function github(permission = "write"): GitHubApi {
  return {
    get: vi.fn(async (path: string) => {
      if (path.includes("/collaborators/")) return { permission };
      if (path.endsWith("/commits/main")) return { sha: "a".repeat(40) };
      if (path.includes("/contents/.roundhouse/profile.yaml?ref="))
        return {
          name: "profile.yaml",
          type: "file",
          encoding: "base64",
          content: btoa(
            'version: 1\npaths:\n  allowed:\n    - "**"\n  protected:\n    - ".github/workflows/**"\n',
          ),
        };
      return { default_branch: "main" };
    }) as GitHubApi["get"],
    post: vi.fn(async () => ({})) as GitHubApi["post"],
  };
}

function reportRun(
  id: string,
  overrides: Partial<RunSnapshot> = {},
): RunSnapshot {
  return {
    ...createRun({
      id,
      repository: "zorkian/roundhouse",
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    }),
    ...overrides,
  };
}

async function visualFeedbackProfile() {
  const sourceCommit = "a".repeat(40);
  const workflow = await compileWorkflow(
    `version: 1
triggers:
  github.issue.started: approval
nodes:
  approval:
    executor: human
    role: approval
    human:
      reason: visual_feedback
      audience: operator
      prompt: prompts/visual-feedback.md
    outputs: [human.status]
    transitions:
      - terminal: succeeded
`,
    sourceCommit,
    async () =>
      "Compare the before-and-after screenshots. Reply with changes or say the result looks right.",
  );
  return {
    sourcePath: ".roundhouse/profile.yaml" as const,
    sourceCommit,
    version: 2 as const,
    hash: "b".repeat(64),
    workflow,
    paths: { allowed: ["**"], protected: [".roundhouse/**"] },
    permissions: {
      operators: {
        repositoryPermissions: ["write" as const],
        users: [],
        teams: [],
      },
    },
  };
}

function reportAttempt(
  run: RunSnapshot,
  overrides: Partial<Attempt> = {},
): Attempt {
  const runRevision = Math.max(1, run.revision - 1);
  return {
    id: `${run.id}_rev_${runRevision}`,
    runId: run.id,
    runRevision,
    kind: "agent",
    stage: run.stage,
    role: run.stage,
    state: "completed",
    deadlineAt: Date.now() + 1_000,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
    ...overrides,
  };
}

async function reportedBody(
  run: RunSnapshot,
  attempt: Attempt,
): Promise<string> {
  let reported = "";
  const reporter = new GitHubStageReporter({
    get: async <T>(path: string) =>
      (attempt.stage === "review" && path.includes("/pulls?state=open")
        ? [{ number: 73, html_url: "https://github.com/pull/73" }]
        : []) as T,
    post: async <T>(_path: string, value: unknown) => {
      reported = String((value as { body?: unknown }).body ?? "");
      return {} as T;
    },
  });
  await reporter.report(run, attempt);
  return reported;
}

async function reportedBodyWithDetails(run: RunSnapshot, attempt: Attempt) {
  let reported = "";
  const reporter = new GitHubStageReporter(
    {
      get: async <T>() => [] as T,
      post: async <T>(_path: string, value: unknown) => {
        reported = String((value as { body?: unknown }).body ?? "");
        return {} as T;
      },
    },
    "https://roundhouse.example",
  );
  await reporter.report(run, attempt);
  return reported;
}

async function delivery(
  id: string,
  command = "/roundhouse-dev start",
  actor = "maintainer",
  type = "User",
  target: {
    repository: string;
    repositoryId: number;
    installationId: number;
    issueState?: string;
  } = {
    repository: "zorkian/roundhouse",
    repositoryId: 123,
    installationId: 456,
  },
) {
  const body = JSON.stringify({
    action: "created",
    repository: { id: target.repositoryId, full_name: target.repository },
    installation: { id: target.installationId },
    sender: { login: actor, type },
    issue: {
      number: 42,
      title: "Qualify this",
      body: "Acceptance details",
      html_url: `https://github.com/${target.repository}/issues/42`,
      state: target.issueState ?? "open",
    },
    comment: {
      body: command,
      html_url: `https://github.com/${target.repository}/issues/42#issuecomment-${id}`,
    },
  });
  const signature = await signCallback("webhook-secret", body);
  return new Request("https://roundhouse.invalid/github/webhook", {
    method: "POST",
    headers: {
      "x-github-delivery": id,
      "x-github-event": "issue_comment",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

async function closureDelivery(id: string, action = "closed") {
  const body = JSON.stringify({
    action,
    repository: { id: 123, full_name: "zorkian/roundhouse" },
    installation: { id: 456 },
    sender: { login: "maintainer" },
    issue: { number: 42 },
  });
  const signature = await signCallback("webhook-secret", body);
  return new Request("https://roundhouse.invalid/github/webhook", {
    method: "POST",
    headers: {
      "x-github-delivery": id,
      "x-github-event": "issues",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

async function concludeQualification(
  repository: MemoryRunRepository,
  classification: string,
  revision = 1,
): Promise<string> {
  const id = "run_123_issue_42";
  const attemptId = `${id}_rev_${revision}`;
  await repository.createAttempt({
    id: attemptId,
    runId: id,
    runRevision: revision,
    kind: "agent",
    stage: "qualify",
    role: "qualification",
    state: "created",
    deadlineAt: 200,
    baseCommit: "a".repeat(40),
    expectedHead: "a".repeat(40),
  });
  await repository.completeAttempt(attemptId, revision, "a".repeat(40), {
    qualification: { classification, summary: "No change needed." },
  });
  await repository.transition(id, revision, {
    status: "succeeded",
    stage: "qualify",
  });
  return id;
}

describe("GitHub intake", () => {
  it("loads a repository profile from the current default-branch commit", async () => {
    const current = await loadDefaultBranchProfile(
      github(),
      "zorkian/roundhouse",
    );

    expect(current.defaultBranch).toBe("main");
    expect(current.commit).toBe("a".repeat(40));
    expect(current.profile.sourceCommit).toBe("a".repeat(40));
    expect(current.profile.workflow?.nodes.approval).toMatchObject({
      executor: "human",
      role: "approval",
      human: {
        reason: "visual_feedback",
        audience: "operator",
      },
    });
  });

  it("authorizes explicit profile users without repository permission", async () => {
    const get = vi.fn(async () => {
      throw new Error("repository_permission_must_not_be_required");
    });
    await expect(
      operatorAuthorized(
        { get } as unknown as GitHubApi,
        "zorkian/roundhouse",
        "Profile-Operator",
        {
          sourcePath: ".roundhouse/profile.yaml",
          sourceCommit: "a".repeat(40),
          version: 2,
          hash: "b".repeat(64),
          paths: { allowed: ["**"], protected: [] },
          permissions: {
            operators: {
              repositoryPermissions: [],
              users: ["profile-operator"],
              teams: [],
            },
          },
        },
      ),
    ).resolves.toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("authorizes active members of an explicit profile team", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("/memberships/")) return { state: "active" };
      throw new Error(`unexpected_get:${path}`);
    });
    await expect(
      operatorAuthorized(
        { get } as unknown as GitHubApi,
        "dreamwidth/dreamwidth",
        "contributor",
        {
          sourcePath: ".roundhouse/profile.yaml",
          sourceCommit: "a".repeat(40),
          version: 2,
          hash: "b".repeat(64),
          paths: { allowed: ["**"], protected: [] },
          permissions: {
            operators: {
              repositoryPermissions: [],
              users: [],
              teams: ["dreamwidth/maintainers"],
            },
          },
        },
      ),
    ).resolves.toBe(true);
  });

  it("cancels active work when its GitHub issue closes", async () => {
    const repository = new IntakeRepository();
    await repository.create(
      reportRun("run_123_issue_42", {
        githubRepositoryId: 123,
        githubInstallationId: 456,
      }),
    );

    await expect(
      acceptGitHubIssueClosed(
        await closureDelivery("close-42"),
        env,
        repository,
      ),
    ).resolves.toEqual({
      outcome: "cancelled",
      attemptId: "run_123_issue_42_rev_1",
    });
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "cancelled",
      revision: 2,
    });
    expect(repository.issueStates.get("run_123_issue_42")).toBe("closed");
    await expect(
      acceptGitHubIssueClosed(
        await closureDelivery("close-42"),
        env,
        repository,
      ),
    ).resolves.toEqual({ outcome: "duplicate" });
  });

  it("reconciles rather than cancels a maintainer merge when GitHub closes the issue", async () => {
    const repository = new IntakeRepository();
    const id = "run_123_issue_42";
    await repository.create(
      reportRun(id, {
        githubRepositoryId: 123,
        githubInstallationId: 456,
        profile: {
          sourcePath: ".roundhouse/profile.yaml",
          sourceCommit: "a".repeat(40),
          version: 2,
          hash: "b".repeat(64),
          paths: { allowed: ["**"], protected: [] },
          merge: { mode: "maintainer", method: "squash" },
        },
      }),
    );
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "merge",
      waitingReason: "maintainer_merge",
      acceptedHead: "a".repeat(40),
    });
    await expect(
      acceptGitHubIssueClosed(
        await closureDelivery("maintainer-merge-close"),
        env,
        repository,
      ),
    ).resolves.toEqual({
      outcome: "closed",
      wakeup: { runId: id, expectedRevision: 3 },
    });
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "merge",
      revision: 3,
    });
  });

  it("closes and reopens a failed issue without changing or restarting its run", async () => {
    const repository = new IntakeRepository();
    const failed = reportRun("run_123_issue_42", {
      githubRepositoryId: 123,
      githubInstallationId: 456,
      status: "failed" as const,
      stage: "implement" as const,
      revision: 7,
    });
    await repository.create(failed);

    await expect(
      acceptGitHubIssueClosed(
        await closureDelivery("close-failed"),
        env,
        repository,
      ),
    ).resolves.toEqual({ outcome: "closed" });
    await expect(repository.get(failed.id)).resolves.toEqual(failed);
    expect(repository.issueStates.get(failed.id)).toBe("closed");

    await expect(
      acceptGitHubIssueClosed(
        await closureDelivery("reopen-failed", "reopened"),
        env,
        repository,
      ),
    ).resolves.toEqual({ outcome: "reopened" });
    await expect(repository.get(failed.id)).resolves.toEqual(failed);
    expect(repository.issueStates.get(failed.id)).toBe("open");
  });

  it("links generated issue comments to run details", async () => {
    const run = reportRun("run_links");
    const body = await reportedBodyWithDetails(run, {
      ...reportAttempt(run),
      role: "qualify",
      result: {
        qualification: { classification: "feature", summary: "Ready" },
      },
    });
    expect(body).toContain(
      "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
    );
  });

  it("preserves the run-details link when comment content is truncated", async () => {
    const run = reportRun("run_long_comment");
    const body = await reportedBodyWithDetails(run, {
      ...reportAttempt(run),
      role: "qualify",
      result: {
        qualification: {
          classification: "feature",
          summary: "x".repeat(70_000),
        },
      },
    });
    expect(body).toHaveLength(65_000);
    expect(body).toMatch(
      /\n\n\[View Roundhouse run details\]\(https:\/\/roundhouse\.example\/repositories\/zorkian\/roundhouse\/issues\/42\)$/,
    );
  });

  it("links pull requests to run details and GitHub's Files changed view", async () => {
    const patched: unknown[] = [];
    const reporter = new GitHubStageReporter(
      {
        get: async <T>(path: string) =>
          (path.endsWith(
            "/pulls?state=open&head=zorkian%3Aroundhouse%2Fissue-42",
          )
            ? [
                {
                  number: 99,
                  html_url: "https://github.com/zorkian/roundhouse/pull/99",
                  head: { sha: "b".repeat(40) },
                },
              ]
            : []) as T,
        post: async <T>() => ({}) as T,
        patch: async <T>(_path: string, value: unknown) => {
          patched.push(value);
          return {} as T;
        },
      },
      "https://roundhouse.example",
    );
    const run = reportRun("run_pr_links", {
      stage: "implement",
    });
    await reporter.report(run, {
      ...reportAttempt(run),
      role: "developer",
      acceptedHead: "b".repeat(40),
      result: {
        implementation: {
          summary: "Implemented",
          pullRequestBody: "A friendly summary.",
          validation: [
            { command: "npm test", output: "secret detailed output" },
          ],
        },
      },
    });
    expect(patched[0]).toMatchObject({
      body: expect.stringContaining(
        "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
      ),
    });
    expect(patched[0]).toMatchObject({
      body: expect.stringContaining(
        "[View Files changed](https://github.com/zorkian/roundhouse/pull/99/files)",
      ),
    });
    expect(patched[0]).toMatchObject({
      body: expect.not.stringContaining("secret detailed output"),
    });
  });

  it("verifies the raw delivery body before parsing", async () => {
    const raw = '{"comment":{"body":"/roundhouse-dev start"}}';
    const signature = await signCallback("webhook-secret", raw);
    await expect(
      verifyGitHubWebhook(raw, `sha256=${signature}`, "webhook-secret"),
    ).resolves.toBe(true);
    await expect(
      verifyGitHubWebhook(`${raw} `, `sha256=${signature}`, "webhook-secret"),
    ).resolves.toBe(false);
  });

  it("rejects signatures without GitHub's sha256 prefix", async () => {
    await expect(
      verifyGitHubWebhook("{}", "not-a-signature", "webhook-secret"),
    ).resolves.toBe(false);
  });

  it("accepts one exact maintainer command at the default branch head", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    await expect(
      acceptGitHubComment(
        await delivery("delivery-1"),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      id: "run_123_issue_42",
      repository: "zorkian/roundhouse",
      githubRepositoryId: 123,
      githubInstallationId: 456,
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      status: "active",
      stage: "qualify",
      revision: 1,
    });
    expect(wakeups).toEqual([
      { runId: "run_123_issue_42", expectedRevision: 1 },
    ]);
  });

  it("accepts the short-form development command", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    await expect(
      acceptGitHubComment(
        await delivery("delivery-1", "/rhd start"),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      id: "run_123_issue_42",
      status: "active",
      stage: "qualify",
    });
    expect(wakeups).toEqual([
      { runId: "run_123_issue_42", expectedRevision: 1 },
    ]);
  });

  it("accepts a marked promotion through normal intake and links the created run", async () => {
    const repository = new IntakeRepository();
    const conversationId = "b1f486ff-7744-49f9-ab78-f74e8409fc2b";
    const briefId = "47cff616-eaaa-46fd-870f-dd5cf3c674d8";
    await expect(
      acceptGitHubComment(
        await delivery(
          "promotion-delivery",
          `${env.GITHUB_START_COMMAND}\n\n<!-- roundhouse:conversation-start:${conversationId}:brief:${briefId} -->`,
        ),
        env,
        repository,
        async () => undefined,
        github(),
        "https://roundhouse.example",
      ),
    ).resolves.toBe("accepted");
    expect(repository.promotionIntakes).toEqual([
      {
        conversationId,
        briefId,
        issueNumber: 42,
        actorGithubLogin: "maintainer",
        accepted: true,
        runId: "run_123_issue_42",
        runUrl:
          "https://roundhouse.example/repositories/zorkian/roundhouse/issues/42",
      },
    ]);
  });

  it("records a marked promotion rejection when normal operator authorization fails", async () => {
    const repository = new IntakeRepository();
    const conversationId = "b1f486ff-7744-49f9-ab78-f74e8409fc2b";
    const briefId = "47cff616-eaaa-46fd-870f-dd5cf3c674d8";
    await expect(
      acceptGitHubComment(
        await delivery(
          "promotion-unauthorized",
          `${env.GITHUB_START_COMMAND}\n\n<!-- roundhouse:conversation-start:${conversationId}:brief:${briefId} -->`,
        ),
        env,
        repository,
        async () => undefined,
        github("read"),
      ),
    ).resolves.toBe("unauthorized");
    expect(repository.promotionIntakes).toEqual([
      {
        conversationId,
        briefId,
        issueNumber: 42,
        actorGithubLogin: "maintainer",
        accepted: false,
        errorCode: "operator_unauthorized",
      },
    ]);
  });

  it("accepts both production command forms when configured for production", async () => {
    const productionEnv = {
      ...env,
      GITHUB_START_COMMAND: "/roundhouse start",
    } satisfies GitHubEnv;
    for (const command of ["/roundhouse start", "/rh start"]) {
      const repository = new IntakeRepository();
      const wakeups: Wakeup[] = [];
      await expect(
        acceptGitHubComment(
          await delivery("delivery-1", command),
          productionEnv,
          repository,
          async (wakeup) => {
            wakeups.push(wakeup);
          },
          github(),
        ),
      ).resolves.toBe("accepted");
      await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
        id: "run_123_issue_42",
        status: "active",
      });
      expect(wakeups).toEqual([
        { runId: "run_123_issue_42", expectedRevision: 1 },
      ]);
    }
  });

  it("binds a run and all enrollment reads to the repository in the webhook", async () => {
    const repository = new IntakeRepository();
    const api = github();
    await expect(
      acceptGitHubComment(
        await delivery("dreamwidth", undefined, undefined, undefined, {
          repository: "zorkian/dreamwidth",
          repositoryId: 987,
          installationId: 654,
        }),
        env,
        repository,
        async () => undefined,
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_987_issue_42")).resolves.toMatchObject({
      repository: "zorkian/dreamwidth",
      githubRepositoryId: 987,
      githubInstallationId: 654,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/repos/zorkian/dreamwidth/collaborators/maintainer/permission",
    );
    expect(api.get).toHaveBeenCalledWith("/repos/zorkian/dreamwidth");
    expect(api.get).toHaveBeenCalledWith(
      `/repos/zorkian/dreamwidth/commits/main`,
    );
  });

  it("mints a token for the selected installation", async () => {
    const key = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", key.privateKey),
    );
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
    const send = vi.fn(async () => Response.json({ token: "short-lived" }));
    const client = new GitHubClient(
      { ...env, ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: pem },
      654,
      send,
    );
    await expect(client.installationToken()).resolves.toBe("short-lived");
    expect(send).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/654/access_tokens",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retrieves Actions log text under the installation token without exposing it", async () => {
    const key = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", key.privateKey),
    );
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
    const githubEnv = { ...env, ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: pem };

    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "short-lived" }))
      .mockResolvedValueOnce(
        new Response("File t/customtext-module.t needs tidying\n", {
          status: 200,
        }),
      );
    const client = new GitHubClient(githubEnv, 654, send);
    await expect(
      client.getText("/repos/zorkian/dreamwidth/actions/jobs/41/logs"),
    ).resolves.toBe("File t/customtext-module.t needs tidying\n");
    expect(send).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/zorkian/dreamwidth/actions/jobs/41/logs",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer short-lived",
        }),
      }),
    );

    const failing = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "short-lived" }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(
      new GitHubClient(githubEnv, 654, failing).getText(
        "/repos/zorkian/dreamwidth/actions/jobs/41/logs",
      ),
    ).rejects.toThrow("github_get_404");
  });

  it("acknowledges a new run after persisting it and before queueing work", async () => {
    const repository = new IntakeRepository();
    const order: string[] = [];
    const create = repository.create.bind(repository);
    repository.create = async (run) => {
      order.push("create");
      await create(run);
    };
    const record = repository.recordGitHubDelivery.bind(repository);
    repository.recordGitHubDelivery = async (runId, deliveryId, payload) => {
      order.push("delivery");
      return record(runId, deliveryId, payload);
    };
    const api: GitHubApi = {
      get: github().get,
      post: vi.fn(async (_path: string, _body: unknown) => {
        order.push("comment");
        return {};
      }) as GitHubApi["post"],
    };
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      order.push("enqueue");
      wakeups.push(wakeup);
    };

    await expect(
      acceptGitHubComment(
        await delivery("delivery-ack"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");

    expect(order).toEqual(["create", "delivery", "comment", "enqueue"]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining("Roundhouse has started"),
      },
    );
    const comment = (
      (api.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { body: string },
      ]
    )[1].body;
    expect(comment).toContain(
      "<!-- roundhouse:v2:acknowledgement:run_123_issue_42 -->",
    );
    expect(comment).toContain("Roundhouse has started working on this.");
    expect(comment).not.toContain("set up for the first time");
    expect(comment).not.toContain("workspace");
    expect(comment).not.toContain("about a minute");
    expect(comment).not.toContain(env.GITHUB_START_COMMAND);
    expect(comment).not.toContain("enqueue");
    expect(wakeups).toEqual([
      { runId: "run_123_issue_42", expectedRevision: 1 },
    ]);
  });

  function profileErrorApi(
    comments: { body: string }[],
    profile: "missing" | "invalid",
  ): GitHubApi {
    return {
      get: vi.fn(async (path: string) => {
        if (path.includes("/collaborators/")) return { permission: "write" };
        if (path.endsWith("/commits/main")) return { sha: "a".repeat(40) };
        if (path.includes("/contents/")) {
          if (profile === "missing") throw new Error("github_get_404");
          return {
            name: "profile.yaml",
            type: "file",
            encoding: "base64",
            content: btoa("version: 2\n"),
          };
        }
        if (path.includes("/comments")) return comments;
        return { default_branch: "main" };
      }) as GitHubApi["get"],
      post: vi.fn(async (_path: string, body: unknown) => {
        comments.push({
          body: String((body as { body?: unknown }).body ?? ""),
        });
        return {};
      }) as GitHubApi["post"],
    };
  }

  it("explains when a missing repository profile blocks the start", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    const comments: { body: string }[] = [];
    const api = profileErrorApi(comments, "missing");
    await expect(
      acceptGitHubComment(
        await delivery("delivery-no-profile"),
        env,
        repository,
        enqueue,
        api,
        "https://roundhouse.example",
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "waiting",
      waitingReason: "profile_error",
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining(
          "Roundhouse cannot start because `.roundhouse/profile.yaml` is missing or invalid.",
        ),
      },
    );
    expect(comments[0]?.body).toContain(
      "<!-- roundhouse:v2:profile-error:run_123_issue_42:1 -->",
    );
    expect(comments[0]?.body).toContain(
      "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
    );
    expect(enqueue).not.toHaveBeenCalled();
    await expect(
      acceptGitHubComment(
        await delivery("delivery-no-profile"),
        env,
        repository,
        enqueue,
        api,
        "https://roundhouse.example",
      ),
    ).resolves.toBe("duplicate");
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("explains when an invalid repository profile blocks the start", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    const comments: { body: string }[] = [];
    const api = profileErrorApi(comments, "invalid");
    await expect(
      acceptGitHubComment(
        await delivery("delivery-bad-profile"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "waiting",
      waitingReason: "profile_error",
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(comments[0]?.body).toContain(
      "Roundhouse cannot start because `.roundhouse/profile.yaml` is missing or invalid.",
    );
    expect(comments[0]?.body).toContain(
      "<!-- roundhouse:v2:profile-error:run_123_issue_42:1 -->",
    );
    expect(comments[0]?.body).not.toContain("View Roundhouse run details");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("reloads a corrected repository profile when restarting its wait", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    await expect(
      acceptGitHubComment(
        await delivery("delivery-profile-missing"),
        env,
        repository,
        enqueue,
        profileErrorApi([], "missing"),
      ),
    ).resolves.toBe("accepted");

    await expect(
      acceptGitHubComment(
        await delivery("delivery-profile-fixed"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("accepted");

    const resumed = await repository.get("run_123_issue_42");
    expect(resumed).toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 2,
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "a".repeat(40),
        version: 1,
      },
    });
    expect(resumed).not.toHaveProperty("profileError");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      runId: "run_123_issue_42",
      expectedRevision: 2,
    });
  });

  it("does not repeat the profile error comment when its marker is beyond the first page", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    const api: GitHubApi = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/collaborators/")) return { permission: "write" };
        if (path.endsWith("/commits/main")) return { sha: "a".repeat(40) };
        if (path.includes("/contents/")) throw new Error("github_get_404");
        if (path.includes("/comments")) {
          return path.endsWith("page=1")
            ? Array.from({ length: 100 }, (_, index) => ({
                body: `older comment ${index}`,
              }))
            : [
                {
                  body: "<!-- roundhouse:v2:profile-error:run_123_issue_42:1 -->\n## I can’t start on this yet",
                },
              ];
        }
        return { default_branch: "main" };
      }) as GitHubApi["get"],
      post: vi.fn(async () => ({})) as GitHubApi["post"],
    };
    await expect(
      acceptGitHubComment(
        await delivery("delivery-no-profile-paged"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "waiting",
      waitingReason: "profile_error",
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues a new run when acknowledgement posting fails", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    const api: GitHubApi = {
      get: github().get,
      post: vi.fn(async () => {
        throw new Error("github_post_failed");
      }) as GitHubApi["post"],
    };

    await expect(
      acceptGitHubComment(
        await delivery("delivery-ack-failed"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      runId: "run_123_issue_42",
      expectedRevision: 1,
    });
  });

  it("deduplicates delivery replay and repeated start commands", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    const api = github();
    await acceptGitHubComment(
      await delivery("delivery-1"),
      env,
      repository,
      enqueue,
      api,
    );
    await expect(
      acceptGitHubComment(
        await delivery("delivery-1"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("duplicate");
    await expect(
      acceptGitHubComment(
        await delivery("delivery-2"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("duplicate");
    expect(wakeups).toHaveLength(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it.each(["clarification", "profile_error"] as const)(
    "lets a maintainer restart a representative %s wait",
    async (reason) => {
      const repository = new IntakeRepository();
      const wakeups: Wakeup[] = [];
      const enqueue = async (wakeup: Wakeup) => {
        wakeups.push(wakeup);
      };
      const api = github();
      await acceptGitHubComment(
        await delivery("delivery-budget-start"),
        env,
        repository,
        enqueue,
        api,
      );
      const id = "run_123_issue_42";
      await repository.transition(id, 1, {
        status: "waiting",
        stage: "implement",
        waitingReason: reason,
      });

      await expect(
        acceptGitHubComment(
          await delivery("delivery-budget-resume"),
          env,
          repository,
          enqueue,
          api,
        ),
      ).resolves.toBe("accepted");
      await expect(repository.get(id)).resolves.toMatchObject({
        status: "active",
        stage: "implement",
        revision: 3,
      });
      expect(wakeups).toEqual([
        { runId: id, expectedRevision: 1 },
        { runId: id, expectedRevision: 3 },
      ]);
    },
  );

  it("restarts a waiting legacy run without a stored issue snapshot", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    const api = github();
    await acceptGitHubComment(
      await delivery("delivery-legacy-start"),
      env,
      repository,
      enqueue,
      api,
    );
    const id = "run_123_issue_42";
    const created = await repository.get(id);
    if (!created) throw new Error("test_run_missing");
    repository.runs.set(id, {
      ...created,
      issue: undefined,
      profile: undefined,
    });
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "implement",
      waitingReason: "maintainer_judgment",
    });

    await expect(
      acceptGitHubComment(
        await delivery("delivery-legacy-resume"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
      revision: 3,
      issue: {
        title: "Qualify this",
        body: "Acceptance details",
        actor: "maintainer",
      },
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "a".repeat(40),
        version: 1,
      },
    });
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
    ]);
  });

  it("rejects near-match commands and actors without write permission", async () => {
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
    for (const nearMatch of [
      "/roundhouse-dev start now",
      "/rhd start now",
      "/rh start now",
      "/rh start",
      "/roundhouse start",
    ]) {
      const nearRepository = new IntakeRepository();
      await expect(
        acceptGitHubComment(
          await delivery("delivery-1", nearMatch),
          env,
          nearRepository,
          enqueue,
          github(),
        ),
      ).resolves.toBe("ignored");
    }
    await expect(
      acceptGitHubComment(
        await delivery("delivery-1", "/roundhouse-dev start now"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("ignored");
    await expect(
      acceptGitHubComment(
        await delivery("delivery-2"),
        env,
        repository,
        enqueue,
        github("read"),
      ),
    ).resolves.toBe("unauthorized");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("resumes repeated clarification from ordinary citizen prose", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const order: string[] = [];
    const record = repository.recordGitHubDelivery.bind(repository);
    repository.recordGitHubDelivery = async (runId, deliveryId, payload) => {
      order.push("delivery");
      return record(runId, deliveryId, payload);
    };
    const resume = repository.resume.bind(repository);
    repository.resume = async (runId, revision, issue, profile) => {
      order.push("resume");
      return resume(runId, revision, issue, profile);
    };
    const enqueue = async (wakeup: Wakeup) => {
      order.push("enqueue");
      wakeups.push(wakeup);
    };
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      enqueue,
      github(),
    );
    const id = "run_123_issue_42";
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    const comments: { body: string }[] = [];
    const noPermissionCheck: GitHubApi = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/collaborators/"))
          throw new Error("prose_must_not_require_repository_permission");
        return comments;
      }) as GitHubApi["get"],
      post: vi.fn(async (_path: string, body: unknown) => {
        order.push("comment");
        comments.push({
          body: String((body as { body?: unknown }).body ?? ""),
        });
        return {};
      }) as GitHubApi["post"],
    };
    order.length = 0;
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-answer-1",
          "It happens when the input is empty.",
          "random-citizen",
        ),
        env,
        repository,
        enqueue,
        noPermissionCheck,
        "https://roundhouse.example",
      ),
    ).resolves.toBe("accepted");
    expect(order).toEqual(["delivery", "resume", "enqueue", "comment"]);
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 3,
      issue: {
        clarifications: [
          {
            actor: "random-citizen",
            body: "It happens when the input is empty.",
          },
        ],
      },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain(
      "<!-- roundhouse:v2:clarification:run_123_issue_42:3 -->",
    );
    expect(comments[0]?.body).toContain(
      "Thanks — I’ve added this information and I’m taking another look.",
    );
    expect(comments[0]?.body).toContain(
      "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
    );
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-answer-1",
          "It happens when the input is empty.",
          "random-citizen",
        ),
        env,
        repository,
        enqueue,
        noPermissionCheck,
        "https://roundhouse.example",
      ),
    ).resolves.toBe("ignored");
    expect(comments).toHaveLength(1);
    await repository.transition(id, 3, {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-answer-2",
          "The expected result is an empty list.",
          "another-citizen",
        ),
        env,
        repository,
        enqueue,
        noPermissionCheck,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 5,
      issue: {
        clarifications: [
          { actor: "random-citizen" },
          { actor: "another-citizen" },
        ],
      },
    });
    expect(comments).toHaveLength(2);
    expect(comments[1]?.body).toContain(
      "<!-- roundhouse:v2:clarification:run_123_issue_42:5 -->",
    );
    expect(comments[1]?.body).toContain(
      "Thanks — I’ve added this information and I’m taking another look.",
    );
    expect(comments[1]?.body).not.toContain("View Roundhouse run details");
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
      { runId: id, expectedRevision: 5 },
    ]);
  });

  it("accepts ordinary visual feedback only from a repository operator", async () => {
    const repository = new IntakeRepository();
    const profile = await visualFeedbackProfile();
    const id = "run_123_issue_42";
    await repository.create(
      createRun({
        id,
        repository: "zorkian/roundhouse",
        githubRepositoryId: 123,
        githubInstallationId: 456,
        githubDefaultBranch: "main",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: profile.hash,
        profile,
        issue: {
          title: "Adjust the mobile design",
          body: "Show before and after screenshots.",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "maintainer",
        },
      }),
    );
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "review",
      currentNodeId: "approval",
      waitingReason: "visual_feedback",
      acceptedHead: "b".repeat(40),
    });
    const comments: { body: string }[] = [];
    const api: GitHubApi = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/collaborators/random-citizen/permission"))
          return { permission: "read" };
        if (path.includes("/collaborators/maintainer/permission"))
          return { permission: "write" };
        if (path.includes("/comments?")) return comments;
        return { default_branch: "main" };
      }) as GitHubApi["get"],
      post: vi.fn(async (_path: string, body: unknown) => {
        comments.push({
          body: String((body as { body?: unknown }).body ?? ""),
        });
        return {};
      }) as GitHubApi["post"],
    };
    const enqueue = vi.fn(async (_wakeup: Wakeup) => undefined);

    await expect(
      acceptGitHubComment(
        await delivery(
          "visual-feedback-citizen",
          "Move the action closer to the heading.",
          "random-citizen",
        ),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("ignored");
    expect(enqueue).not.toHaveBeenCalled();

    await expect(
      acceptGitHubComment(
        await delivery(
          "visual-feedback-operator",
          "Move the action closer to the heading.",
          "maintainer",
        ),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "review",
      currentNodeId: "approval",
      resumeSignal: {
        kind: "human",
        reason: "visual_feedback",
        actor: "maintainer",
        body: "Move the action closer to the heading.",
      },
      issue: {
        clarifications: [
          {
            actor: "maintainer",
            body: "Move the action closer to the heading.",
          },
        ],
      },
    });
    expect(comments.at(-1)?.body).toContain(
      "Thanks — I’ve added your visual feedback.",
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("reloads a missing profile before resuming from ordinary prose", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      async (wakeup) => {
        wakeups.push(wakeup);
      },
      github(),
    );
    const id = "run_123_issue_42";
    const created = await repository.get(id);
    if (!created) throw new Error("test_run_missing");
    repository.runs.set(id, { ...created, profile: undefined });
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    const baseApi = github();
    const api: GitHubApi = {
      get: vi.fn(async (path: string) =>
        path.includes("/issues/42/comments?") ? [] : baseApi.get(path),
      ) as GitHubApi["get"],
      post: baseApi.post,
    };
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-legacy-answer",
          "The failing input is empty.",
          "random-citizen",
        ),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 3,
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "a".repeat(40),
        version: 1,
      },
    });
    expect(api.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/collaborators/"),
    );
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
    ]);
  });

  it("does not repeat the clarification acknowledgment when its marker is already posted", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      async (wakeup) => {
        wakeups.push(wakeup);
      },
      github(),
    );
    const id = "run_123_issue_42";
    await repository.transition(id, 1, {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    const comments = [
      {
        body: "<!-- roundhouse:v2:clarification:run_123_issue_42:3 -->\nThanks — I’ve added this information and I’m taking another look.",
      },
    ];
    const api: GitHubApi = {
      get: vi.fn(async () => comments) as GitHubApi["get"],
      post: vi.fn(async () => ({})) as GitHubApi["post"],
    };
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-answer-repeat",
          "It happens when the input is empty.",
          "random-citizen",
        ),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        api,
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 3,
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
    ]);
  });

  it.each(["duplicate", "already_satisfied", "unsupported"])(
    "resumes a concluded %s qualification from ordinary prose",
    async (classification) => {
      const repository = new IntakeRepository();
      const wakeups: Wakeup[] = [];
      const enqueue = async (wakeup: Wakeup) => {
        wakeups.push(wakeup);
      };
      await acceptGitHubComment(
        await delivery("delivery-start"),
        env,
        repository,
        enqueue,
        github(),
      );
      const id = await concludeQualification(repository, classification);
      const noPermissionCheck: GitHubApi = {
        get: vi.fn(async () => {
          throw new Error("prose_must_not_require_repository_permission");
        }),
        post: vi.fn(async () => ({})) as GitHubApi["post"],
      };
      await expect(
        acceptGitHubComment(
          await delivery(
            "delivery-correction",
            "The conclusion is wrong; the bug is still present.",
            "random-citizen",
          ),
          env,
          repository,
          enqueue,
          noPermissionCheck,
        ),
      ).resolves.toBe("accepted");
      await expect(repository.get(id)).resolves.toMatchObject({
        status: "active",
        stage: "qualify",
        revision: 3,
        issue: {
          clarifications: [
            {
              actor: "random-citizen",
              body: "The conclusion is wrong; the bug is still present.",
              url: "https://github.com/zorkian/roundhouse/issues/42#issuecomment-delivery-correction",
            },
          ],
        },
      });
      expect(wakeups).toEqual([
        { runId: id, expectedRevision: 1 },
        { runId: id, expectedRevision: 3 },
      ]);
      await expect(
        repository.latestCompletedAttempt(id, "qualify", 3),
      ).resolves.toMatchObject({ id: `${id}_rev_1`, runRevision: 1 });

      // Reconsideration can conclude no-change and be corrected again.
      await concludeQualification(repository, classification, 3);
      await expect(
        acceptGitHubComment(
          await delivery(
            "delivery-correction-2",
            "Here is another reproduction.",
            "another-citizen",
          ),
          env,
          repository,
          enqueue,
          noPermissionCheck,
        ),
      ).resolves.toBe("accepted");
      await expect(repository.get(id)).resolves.toMatchObject({
        status: "active",
        stage: "qualify",
        revision: 5,
        issue: {
          clarifications: [
            { actor: "random-citizen" },
            { actor: "another-citizen" },
          ],
        },
      });
      expect(wakeups).toEqual([
        { runId: id, expectedRevision: 1 },
        { runId: id, expectedRevision: 3 },
        { runId: id, expectedRevision: 5 },
      ]);
    },
  );

  it("continues a completed merged issue from new prose while leaving unrelated terminal runs closed", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      enqueue,
      github(),
    );
    const id = "run_123_issue_42";
    await repository.transition(id, 1, {
      status: "succeeded",
      stage: "merge",
    });
    await expect(
      acceptGitHubComment(
        await delivery("delivery-prose", "Please look again.", "citizen"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(
      acceptGitHubComment(
        await delivery("delivery-restart"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("duplicate");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
      revision: 3,
      issue: {
        clarifications: [
          {
            actor: "citizen",
            body: "Please look again.",
          },
        ],
      },
    });
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
    ]);

    // A succeeded qualification with no completed no-change attempt stays closed.
    const bare = new IntakeRepository();
    await acceptGitHubComment(
      await delivery("delivery-start-2"),
      env,
      bare,
      enqueue,
      github(),
    );
    await bare.transition(id, 1, { status: "succeeded", stage: "qualify" });
    await expect(
      acceptGitHubComment(
        await delivery("delivery-prose-2", "Please look again.", "citizen"),
        env,
        bare,
        enqueue,
        github(),
      ),
    ).resolves.toBe("ignored");
    await expect(bare.get(id)).resolves.toMatchObject({
      status: "succeeded",
      revision: 2,
    });
  });

  it("resumes a concluded no-change qualification from an authorized start command", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    const api = github();
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      enqueue,
      api,
    );
    const id = await concludeQualification(repository, "duplicate");

    // An actor without write permission cannot restart the concluded run.
    await expect(
      acceptGitHubComment(
        await delivery("delivery-restart-denied"),
        env,
        repository,
        enqueue,
        github("read"),
      ),
    ).resolves.toBe("unauthorized");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "succeeded",
      revision: 2,
    });

    await expect(
      acceptGitHubComment(
        await delivery("delivery-restart"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("accepted");
    const resumed = await repository.get(id);
    expect(resumed).toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 3,
    });
    // The command itself is not added as issue evidence.
    expect(resumed?.issue?.clarifications ?? []).toHaveLength(0);

    // A repeated start command while the run is active stays idempotent.
    await expect(
      acceptGitHubComment(
        await delivery("delivery-restart-again"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("duplicate");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "active",
      revision: 3,
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
    ]);
    await expect(
      repository.latestCompletedAttempt(id, "qualify", 3),
    ).resolves.toMatchObject({ id: `${id}_rev_1`, runRevision: 1 });
  });

  it("resumes cancelled work from an authorized start command after the issue reopens", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      enqueue,
      github(),
    );
    await repository.transition("run_123_issue_42", 1, {
      status: "cancelled",
      stage: "reproduce",
    });

    await expect(
      acceptGitHubComment(
        await delivery("delivery-restart-open"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "active",
      stage: "reproduce",
      revision: 3,
    });
    expect(wakeups).toEqual([
      { runId: "run_123_issue_42", expectedRevision: 1 },
      { runId: "run_123_issue_42", expectedRevision: 3 },
    ]);
  });

  it("retries failed work from an authorized start command", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      async (wakeup) => {
        wakeups.push(wakeup);
      },
      github(),
    );
    await repository.transition("run_123_issue_42", 1, {
      status: "failed",
      stage: "integrate",
    });

    await expect(
      acceptGitHubComment(
        await delivery("delivery-retry-failed"),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 3,
    });
    expect(wakeups).toEqual([
      { runId: "run_123_issue_42", expectedRevision: 1 },
      { runId: "run_123_issue_42", expectedRevision: 3 },
    ]);
  });

  it("does not resume cancelled work while the issue is closed", async () => {
    const repository = new IntakeRepository();
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      async () => undefined,
      github(),
    );
    await repository.transition("run_123_issue_42", 1, {
      status: "cancelled",
      stage: "reproduce",
    });

    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-restart-closed",
          undefined,
          undefined,
          undefined,
          {
            repository: "zorkian/roundhouse",
            repositoryId: 123,
            installationId: 456,
            issueState: "closed",
          },
        ),
        env,
        repository,
        async () => undefined,
        github(),
      ),
    ).resolves.toBe("duplicate");
    await expect(repository.get("run_123_issue_42")).resolves.toMatchObject({
      status: "cancelled",
      revision: 2,
    });
  });

  it("ignores bot and marker replies on a concluded qualification", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    await acceptGitHubComment(
      await delivery("delivery-start"),
      env,
      repository,
      enqueue,
      github(),
    );
    const id = await concludeQualification(repository, "unsupported");
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-bot",
          "This is still broken.",
          "dependabot[bot]",
          "Bot",
        ),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("ignored");
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-marker",
          `<!-- roundhouse:v2:qualification:${id}_rev_1 -->\nThis is still broken.`,
          "maintainer",
        ),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("ignored");
    await expect(repository.get(id)).resolves.toMatchObject({
      status: "succeeded",
      revision: 2,
    });
    expect(wakeups).toHaveLength(1);
  });

  it("does not treat Roundhouse's own question as a clarification answer", async () => {
    const repository = new IntakeRepository();
    await repository.create(
      reportRun("run_123_issue_42", {
        githubRepositoryId: 123,
        githubInstallationId: 456,
        issue: {
          title: "Question",
          body: "Details",
          url: "https://github.com/zorkian/roundhouse/issues/42",
          actor: "maintainer",
        },
      }),
    );
    await repository.transition("run_123_issue_42", 1, {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    await expect(
      acceptGitHubComment(
        await delivery(
          "delivery-bot",
          "<!-- roundhouse:v2:qualification:attempt -->\nWhat input fails?",
          "roundhouse[bot]",
          "Bot",
        ),
        env,
        repository,
        vi.fn(),
        github(),
      ),
    ).resolves.toBe("ignored");
  });

  it("asks focused qualification questions without explaining how to answer", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => undefined);
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: async <T>(path: string, body: unknown) => {
        await post(path, body);
        return {} as T;
      },
    });
    const run = reportRun("run_question", {
      status: "waiting",
      stage: "qualify",
      revision: 2,
      waitingReason: "clarification",
    });
    await reporter.report(
      run,
      reportAttempt(run, {
        stage: "qualify",
        role: "qualify",
        result: {
          qualification: {
            classification: "unclear",
            summary: "The failing input is missing.",
            uncertainties: ["Which input demonstrates the problem?"],
            sources: [
              {
                title: "Project documentation",
                url: "https://example.com/docs",
              },
            ],
          },
        },
      }),
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "## A few questions before I start\n\nThe failing input is missing.",
      ),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "### Questions\n- Which input demonstrates the problem?",
      ),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.not.stringContaining("reply in prose"),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "### Sources\n- [Project documentation](https://example.com/docs)",
      ),
    });
  });

  it("turns terminal classifications into plain-language conclusions", async () => {
    const cases = [
      ["duplicate", "## This looks like a duplicate"],
      ["already_satisfied", "## This appears to be already addressed"],
      ["unsupported", "## I can’t take this on"],
    ] as const;
    for (const [classification, heading] of cases) {
      const run = reportRun(`run_${classification}`, {
        status: "succeeded",
        stage: "qualify",
        revision: 2,
      });
      const body = await reportedBody(
        run,
        reportAttempt(run, {
          stage: "qualify",
          role: "qualify",
          result: {
            qualification: { classification, summary: "Here’s what I found." },
          },
        }),
      );
      expect(body).toContain(heading);
      expect(body).not.toContain("Roundhouse has stopped here");
    }
  });

  it("asks natural follow-up questions when reproduction is inconclusive", async () => {
    const run = reportRun("run_not_reproduced", {
      status: "waiting",
      stage: "reproduce",
      revision: 3,
      waitingReason: "clarification",
    });
    const body = await reportedBody(
      run,
      reportAttempt(run, {
        stage: "reproduce",
        role: "reproduce",
        result: {
          reproduction: {
            status: "not_reproduced",
            summary: "I couldn’t trigger the behavior described.",
            expectedBehavior: "The page should remain open.",
            observedBehavior: "The page remained open in my test.",
            uncertainties: ["What did you click immediately before it closed?"],
            sources: [
              {
                title: "Browser behavior",
                url: "https://example.com/browser",
              },
            ],
          },
        },
      }),
    );
    expect(body).toContain(
      "## I couldn’t reproduce this yet\n\nI couldn’t trigger the behavior described.",
    );
    expect(body).toContain(
      "### Questions\n- What did you click immediately before it closed?",
    );
    expect(body).not.toContain("reply in prose");
    expect(body).toContain(
      "### Sources\n- [Browser behavior](https://example.com/browser)",
    );
  });

  it("posts one evidence-backed reproduction comment", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => undefined);
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: async <T>(path: string, body: unknown) => {
        await post(path, body);
        return {} as T;
      },
    });
    const run = reportRun("run_reproduction", {
      stage: "plan",
      revision: 3,
    });
    const attempt = reportAttempt(run, {
      stage: "reproduce",
      role: "reproduce",
      result: {
        reproduction: {
          status: "confirmed",
          summary: "The focused test fails as reported by @maintainer.",
          expectedBehavior: "The test passes.",
          observedBehavior: "The test fails.",
          commands: [{ command: "pnpm test", exitCode: 1, output: "failed" }],
          relevantFiles: ["src/example.ts"],
          screenshots: [
            {
              url: "https://roundhouse-dev.rm-rf.rip/screenshots/baseline",
              description: "iPhone portrait baseline",
            },
          ],
        },
      },
    });
    await reporter.report(run, attempt);
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining("## I reproduced this"),
      },
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "I’ll put together a plan for the change next.",
      ),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.not.stringContaining("Commands:"),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.not.stringContaining("Relevant files:"),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "![iPhone portrait baseline](https://roundhouse-dev.rm-rf.rip/screenshots/baseline)",
      ),
    });
  });

  it("describes feature investigation as current behavior rather than reproduction", async () => {
    const run = reportRun("run_feature_investigation", {
      issueNumber: 43,
      stage: "plan",
      revision: 3,
    });
    const body = await reportedBody(
      run,
      reportAttempt(run, {
        stage: "reproduce",
        role: "reproduce",
        result: {
          requestClassification: "feature",
          reproduction: {
            status: "confirmed",
            summary: "The dashboard does not currently provide this filter.",
            observedBehavior: "The dashboard shows one unfiltered list.",
            commands: [],
            relevantFiles: ["apps/control-plane/src/dashboard.ts"],
            uncertainties: [],
          },
        },
      }),
    );
    expect(body).toContain("## I checked the current behavior");
    expect(body).toContain("### Requested outcome");
    expect(body).toContain("I couldn’t determine the requested outcome.");
    expect(body).not.toContain("I couldn’t determine the expected behavior.");
    expect(body).not.toContain("I reproduced this");
    expect(body).not.toContain("I couldn’t reproduce");
  });

  it("posts a concise evidence-backed plan", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => undefined);
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: async <T>(path: string, body: unknown) => {
        await post(path, body);
        return {} as T;
      },
    });
    const run = reportRun("run_plan", {
      stage: "implement",
      revision: 4,
    });
    const attempt = reportAttempt(run, {
      stage: "plan",
      role: "plan",
      result: {
        plan: {
          status: "ready",
          summary: "Handle the empty input consistently.",
          proposedChange: "Return an empty list for empty input.",
          acceptanceCriteria: ["Empty input returns an empty list."],
          validation: ["Add and run the focused regression test."],
          questions: [],
        },
      },
    });
    await reporter.report(run, attempt);
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining("## Proposed approach"),
      },
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("This is ready to be worked on."),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.not.stringContaining("focused regression test"),
    });
  });

  it("opens a draft pull request and gives the issue author a simple link", async () => {
    const post = vi.fn(async (path: string, _body: unknown) =>
      path.endsWith("/pulls")
        ? {
            number: 73,
            html_url: "https://github.com/zorkian/roundhouse/pull/73",
          }
        : {},
    );
    const reporter = new GitHubStageReporter({
      get: async <T>(path: string) =>
        (path.includes("/comments")
          ? []
          : path.includes("/pulls?state=open")
            ? []
            : { default_branch: "main" }) as T,
      post: post as GitHubApi["post"],
    });
    const run = reportRun("run_implementation", {
      status: "succeeded",
      stage: "implement",
      revision: 5,
      currentHead: "b".repeat(40),
    });
    const attempt = reportAttempt(run, {
      stage: "implement",
      role: "implement",
      expectedHead: "a".repeat(40),
      acceptedHead: run.currentHead,
      result: {
        implementation: {
          summary: "Empty input now returns an empty list.",
          pullRequestTitle: "Handle empty input",
          pullRequestBody: "Fixes the empty-input behavior described in #42.",
          validation: [{ command: "pnpm test", exitCode: 0, output: "passed" }],
          screenshots: [
            {
              url: "https://roundhouse-dev.rm-rf.rip/screenshots/example",
              description: "Empty [state]\nview",
            },
          ],
        },
      },
    });

    await reporter.report(run, attempt);

    expect(post).toHaveBeenNthCalledWith(1, "/repos/zorkian/roundhouse/pulls", {
      title: "Handle empty input",
      head: "roundhouse/issue-42",
      base: "main",
      body: "Fixes the empty-input behavior described in #42.\n\nFixes #42",
      draft: true,
    });
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining(
          "[View draft pull request #73](https://github.com/zorkian/roundhouse/pull/73)",
        ),
      },
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("pnpm test");
    expect(JSON.stringify(post.mock.calls)).not.toContain("passed");
    expect(JSON.stringify(post.mock.calls)).toContain(
      "![Empty  state  view](https://roundhouse-dev.rm-rf.rip/screenshots/example)",
    );
  });

  it("shows screenshot evidence and repository instructions at the visual gate", async () => {
    const post = vi.fn(async (path: string, _body: unknown) =>
      path.endsWith("/pulls")
        ? {
            number: 73,
            html_url: "https://github.com/zorkian/roundhouse/pull/73",
          }
        : {},
    );
    const reporter = new GitHubStageReporter({
      get: async <T>(path: string) =>
        (path.includes("/comments")
          ? []
          : path.includes("/pulls?state=open")
            ? []
            : { default_branch: "main" }) as T,
      post: post as GitHubApi["post"],
    });
    const run = reportRun("run_visual_feedback", {
      status: "waiting",
      stage: "review",
      revision: 5,
      currentNodeId: "approval",
      waitingReason: "visual_feedback",
      currentHead: "b".repeat(40),
      candidateHead: "b".repeat(40),
      profile: await visualFeedbackProfile(),
    });
    await reporter.report(
      run,
      reportAttempt(run, {
        executor: "agent.write",
        stage: "implement",
        role: "implement",
        expectedHead: "a".repeat(40),
        acceptedHead: "b".repeat(40),
        result: {
          implementation: {
            summary: "Adjusted the mobile layout.",
            pullRequestTitle: "Adjust mobile layout",
            pullRequestBody: "Improves the mobile layout.",
            validation: [],
            screenshots: [
              {
                url: "https://roundhouse-dev.rm-rf.rip/screenshots/before",
                description: "Before",
              },
              {
                url: "https://roundhouse-dev.rm-rf.rip/screenshots/after",
                description: "After",
              },
            ],
          },
        },
      }),
    );
    const comment = String(
      (post.mock.calls.at(-1)?.[1] as { body?: unknown })?.body ?? "",
    );
    expect(comment).toContain("## Please review the visual change");
    expect(comment).toContain("![Before]");
    expect(comment).toContain("![After]");
    expect(comment).toContain(
      "Compare the before-and-after screenshots. Reply with changes or say the result looks right.",
    );
  });

  it("updates the same draft pull request after review findings", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter({
      get: async <T>(path: string) =>
        (path.includes("/pulls?state=open")
          ? [
              {
                number: 73,
                html_url: "https://github.com/zorkian/roundhouse/pull/73",
              },
            ]
          : []) as T,
      post: post as GitHubApi["post"],
    });
    const run = reportRun("run_remediation", {
      status: "active",
      stage: "review",
      revision: 7,
      currentHead: "c".repeat(40),
    });
    await reporter.report(
      run,
      reportAttempt(run, {
        stage: "implement",
        role: "implement",
        expectedHead: "b".repeat(40),
        acceptedHead: run.currentHead,
        result: {
          implementation: {
            summary: "Addressed the review finding.",
            pullRequestTitle: "Handle empty input",
            pullRequestBody: "Handles empty input.",
            validation: [],
          },
        },
      }),
    );
    expect(post).not.toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/pulls",
      expect.anything(),
    );
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining("## I updated the draft pull request"),
      },
    );
  });

  it("posts a concise review bound to the exact candidate commit", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter({
      get: async <T>(path: string) =>
        (path.includes("/pulls?state=open")
          ? [
              {
                number: 73,
                html_url: "https://github.com/zorkian/roundhouse/pull/73",
              },
            ]
          : []) as T,
      post: post as GitHubApi["post"],
    });
    const head = "c".repeat(40);
    const run = reportRun("run_review", {
      status: "active",
      stage: "ci",
      revision: 6,
      currentHead: head,
    });
    await reporter.report(
      run,
      reportAttempt(run, {
        stage: "review",
        role: "review",
        expectedHead: head,
        acceptedHead: head,
        result: {
          review: {
            status: "clean",
            summary: "The change matches the requested behavior.",
            findings: [],
          },
        },
      }),
    );
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/73/comments",
      {
        body: expect.stringContaining(
          `Reviewed commit \`${head}\`. CI is next.`,
        ),
      },
    );
  });

  it("posts complete reviewer-attributed aggregated findings", async () => {
    const head = "c".repeat(40);
    const reviewAttempt = (
      role: "review-holistic" | "review-security",
      review: Record<string, unknown>,
    ): Attempt => ({
      id: role,
      runId: "run_aggregated_review",
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: "a".repeat(40),
      expectedHead: head,
      acceptedHead: head,
      result: { review },
    });
    const aggregated = aggregateReviewAttempts([
      reviewAttempt("review-holistic", {
        status: "changes_requested",
        selections: [
          {
            role: "review-security",
            applicable: true,
            rationale: "Auth changed",
          },
          {
            role: "review-data",
            applicable: false,
            rationale: "No data changes",
          },
        ],
        findings: [
          {
            title: "Handle the edge case",
            details: "The empty value is not handled.",
            severity: "high",
            file: "src/input.ts",
          },
        ],
      }),
      reviewAttempt("review-security", {
        status: "changes_requested",
        findings: [
          {
            title: "Check authorization",
            details: "The endpoint skips the permission check.",
            severity: "high",
          },
        ],
      }),
    ]);
    expect(aggregated).toBeDefined();
    const run = reportRun("run_aggregated_review", {
      status: "active",
      stage: "implement",
      revision: 6,
      currentHead: head,
    });

    const body = await reportedBody(run, aggregated!);
    expect(body).toContain(
      "review-holistic, review-security reported 2 findings.",
    );
    expect(body).toContain("review-holistic: Handle the edge case");
    expect(body).toContain("The empty value is not handled.");
    expect(body).toContain("src/input.ts");
    expect(body).toContain("review-security: Check authorization");
    expect(body).toContain("The endpoint skips the permission check.");
  });

  it("posts nonblocking findings from a clean aggregated review", async () => {
    const head = "c".repeat(40);
    const attempt = {
      id: "clean-aggregate",
      runId: "run_clean_aggregate",
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review-holistic",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: "a".repeat(40),
      expectedHead: head,
      acceptedHead: head,
      result: {
        review: {
          status: "clean",
          summary: "review-holistic reported 1 finding.",
          findings: [
            {
              reviewer: "review-holistic",
              title: "Minor cleanup",
              details: "This name could be clearer.",
              severity: "low",
              file: "src/name.ts",
            },
          ],
        },
      },
    } satisfies Attempt;
    const run = reportRun(attempt.runId, {
      status: "active",
      stage: "ci",
      revision: 6,
      currentHead: head,
    });

    const body = await reportedBody(run, attempt);
    expect(body).toContain("Review complete");
    expect(body).toContain("review-holistic: Minor cleanup");
    expect(body).toContain("This name could be clearer.");
    expect(body).toContain("src/name.ts");
    expect(body).toContain(`Reviewed commit \`${head}\`. CI is next.`);
  });

  it("posts a concise completion after the exact-head merge", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: post as GitHubApi["post"],
    });
    const mergeCommit = "d".repeat(40);
    const run = reportRun("run_merge", {
      status: "succeeded",
      stage: "merge",
      revision: 8,
      currentHead: mergeCommit,
    });
    await reporter.report(run, {
      ...reportAttempt(run),
      kind: "external",
      stage: "merge",
      role: "github-merge",
      expectedHead: "c".repeat(40),
      acceptedHead: mergeCommit,
      result: {
        merge: {
          status: "merged",
          head: "c".repeat(40),
          mergeCommit,
          pullRequest: {
            number: 73,
            html_url: "https://github.com/zorkian/roundhouse/pull/73",
          },
        },
      },
    });
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining(
          "The change passed review and CI and has been merged.",
        ),
      },
    );
  });

  it("does not announce a merge that failed validation", async () => {
    const api = github();
    const run = reportRun("run_failed_merge", {
      status: "failed",
      stage: "merge",
      revision: 8,
      currentHead: "c".repeat(40),
    });
    await new GitHubStageReporter(api).report(run, {
      ...reportAttempt(run),
      kind: "external",
      stage: "merge",
      role: "github-merge",
      result: {
        merge: {
          status: "failed",
          head: run.currentHead,
        },
      },
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("does not open a pull request for a failed implementation", async () => {
    const api = github();
    const run = reportRun("run_failed_implementation", {
      status: "failed",
      stage: "implement",
      revision: 5,
    });
    await new GitHubStageReporter(api).report(run, {
      ...reportAttempt(run),
      result: { outcome: "ok", checkpoint: run.currentHead },
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("posts an implementation start on the issue once the attempt is dispatched", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter(
      {
        get: async <T>() => [] as T,
        post: post as GitHubApi["post"],
      },
      "https://roundhouse.example",
    );
    const run = reportRun("run_implementation_started", {
      stage: "implement",
      revision: 5,
    });
    await reporter.reportStarted(run, {
      ...reportAttempt(run),
      id: "run_implementation_started_rev_4",
      runRevision: 4,
      state: "dispatched",
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/42/comments",
      {
        body: expect.stringContaining(
          "## Implementation started\n\nI’m working on the proposed change now.",
        ),
      },
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "<!-- roundhouse:v2:implementation-started:run_implementation_started_rev_4 -->",
      ),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
      ),
    });
  });

  it("posts a holistic review start on the pull request", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter(
      {
        get: async <T>(path: string) =>
          (path.includes("/pulls?state=open")
            ? [
                {
                  number: 73,
                  html_url: "https://github.com/zorkian/roundhouse/pull/73",
                },
              ]
            : []) as T,
        post: post as GitHubApi["post"],
      },
      "https://roundhouse.example",
    );
    const run = reportRun("run_review_started", {
      stage: "review",
      revision: 5,
      currentHead: "b".repeat(40),
    });
    await reporter.reportStarted(run, {
      ...reportAttempt(run),
      id: "run_review_started_rev_5_review-holistic",
      role: "review-holistic",
      state: "dispatched",
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/issues/73/comments",
      {
        body: expect.stringContaining(
          "## Review started\n\nI’m reviewing the proposed change now.",
        ),
      },
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "<!-- roundhouse:v2:review-started:run_review_started_rev_5_review-holistic -->",
      ),
    });
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining(
        "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
      ),
    });
  });

  it("does not post a review start for specialist reviewers", async () => {
    const get = vi.fn(async () => []);
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter({
      get: get as GitHubApi["get"],
      post: post as GitHubApi["post"],
    });
    const run = reportRun("run_specialist_started", {
      stage: "review",
      revision: 5,
      currentHead: "b".repeat(40),
    });
    for (const role of ["review-security", "review-data"] as const) {
      await reporter.reportStarted(run, {
        ...reportAttempt(run),
        id: `run_specialist_started_rev_5_${role}`,
        role,
        state: "dispatched",
      });
    }
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("fails the review start when the pull request is missing", async () => {
    const post = vi.fn(async (_path: string, _body: unknown) => ({}));
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: post as GitHubApi["post"],
    });
    const run = reportRun("run_review_started_missing_pr", {
      stage: "review",
      revision: 5,
      currentHead: "b".repeat(40),
    });
    await expect(
      reporter.reportStarted(run, {
        ...reportAttempt(run),
        id: "run_review_started_missing_pr_rev_5_review-holistic",
        role: "review-holistic",
        state: "dispatched",
      }),
    ).rejects.toThrow("review_pull_request_missing");
    expect(post).not.toHaveBeenCalled();
  });

  it("asks plan questions without exposing workflow status", async () => {
    const run = reportRun("run_plan_question", {
      status: "waiting",
      stage: "plan",
      revision: 4,
      waitingReason: "clarification",
    });
    const body = await reportedBody(run, {
      ...reportAttempt(run),
      result: {
        plan: {
          status: "needs_clarification",
          summary: "There are two reasonable ways to handle existing data.",
          proposedChange: "Update the stored records during the change.",
          acceptanceCriteria: [],
          validation: [],
          questions: ["Should existing records be updated automatically?"],
          sources: [
            {
              title: "Migration guide",
              url: "https://example.com/migration",
            },
          ],
        },
      },
    });
    expect(body).toContain("## A few questions about the proposed change");
    expect(body).toContain(
      "### Questions\n- Should existing records be updated automatically?",
    );
    expect(body).not.toContain("needs_clarification");
    expect(body).toContain(
      "### Sources\n- [Migration guide](https://example.com/migration)",
    );
  });
});
