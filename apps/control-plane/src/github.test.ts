// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
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
  target = {
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

describe("GitHub intake", () => {
  it("cancels active work when its GitHub issue closes", async () => {
    const repository = new IntakeRepository();
    await repository.create(
      createRun({
        id: "run_123_issue_42",
        repository: "zorkian/roundhouse",
        githubRepositoryId: 123,
        githubInstallationId: 456,
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
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

  it("closes and reopens a failed issue without changing or restarting its run", async () => {
    const repository = new IntakeRepository();
    const failed = {
      ...createRun({
        id: "run_123_issue_42",
        repository: "zorkian/roundhouse",
        githubRepositoryId: 123,
        githubInstallationId: 456,
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "failed" as const,
      stage: "implement" as const,
      revision: 7,
    };
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
    const run = createRun({
      id: "run_links",
      repository: "zorkian/roundhouse",
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    });
    const body = await reportedBodyWithDetails(run, {
      id: "qualification",
      runId: run.id,
      runRevision: 1,
      kind: "agent",
      stage: "qualify",
      role: "qualify",
      state: "completed",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      result: {
        qualification: { classification: "feature", summary: "Ready" },
      },
    });
    expect(body).toContain(
      "[View Roundhouse run details](https://roundhouse.example/repositories/zorkian/roundhouse/issues/42)",
    );
  });

  it("preserves the run-details link when comment content is truncated", async () => {
    const run = createRun({
      id: "run_long_comment",
      repository: "zorkian/roundhouse",
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    });
    const body = await reportedBodyWithDetails(run, {
      id: "qualification",
      runId: run.id,
      runRevision: 1,
      kind: "agent",
      stage: "qualify",
      role: "qualify",
      state: "completed",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    const run = createRun({
      id: "run_pr_links",
      repository: "zorkian/roundhouse",
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    });
    await reporter.report(run, {
      id: "implementation",
      runId: run.id,
      runRevision: 1,
      kind: "agent",
      stage: "implement",
      role: "developer",
      state: "completed",
      deadlineAt: 1,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
  });

  it("rejects near-match commands and actors without write permission", async () => {
    const repository = new IntakeRepository();
    const enqueue = vi.fn();
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
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    });
    const noPermissionCheck: GitHubApi = {
      get: vi.fn(async () => {
        throw new Error("prose_must_not_require_repository_permission");
      }),
      post: vi.fn(async () => ({})) as GitHubApi["post"],
    };
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
            body: "It happens when the input is empty.",
          },
        ],
      },
    });
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
    expect(wakeups).toEqual([
      { runId: id, expectedRevision: 1 },
      { runId: id, expectedRevision: 3 },
      { runId: id, expectedRevision: 5 },
    ]);
  });

  it("does not treat Roundhouse's own question as a clarification answer", async () => {
    const repository = new IntakeRepository();
    await repository.create(
      createRun({
        id: "run_123_issue_42",
        repository: "zorkian/roundhouse",
        githubRepositoryId: 123,
        githubInstallationId: 456,
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
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
    const run = {
      ...createRun({
        id: "run_question",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "waiting",
      stage: "qualify",
      revision: 2,
      waitingReason: "clarification",
    } as const;
    await reporter.report(run, {
      id: "run_question_rev_1",
      runId: run.id,
      runRevision: 1,
      kind: "agent",
      stage: "qualify",
      role: "qualify",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    });
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
      const run = {
        ...createRun({
          id: `run_${classification}`,
          repository: "zorkian/roundhouse",
          issueNumber: 42,
          baseCommit: "a".repeat(40),
          profileVersion: "v2",
        }),
        status: "succeeded",
        stage: "qualify",
        revision: 2,
      } as const;
      const body = await reportedBody(run, {
        id: `${run.id}_rev_1`,
        runId: run.id,
        runRevision: 1,
        kind: "agent",
        stage: "qualify",
        role: "qualify",
        state: "completed",
        deadlineAt: Date.now() + 1_000,
        baseCommit: run.baseCommit,
        expectedHead: run.currentHead,
        result: {
          qualification: { classification, summary: "Here’s what I found." },
        },
      });
      expect(body).toContain(heading);
      expect(body).not.toContain("Roundhouse has stopped here");
    }
  });

  it("asks natural follow-up questions when reproduction is inconclusive", async () => {
    const run = {
      ...createRun({
        id: "run_not_reproduced",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "waiting",
      stage: "reproduce",
      revision: 3,
      waitingReason: "clarification",
    } as const;
    const body = await reportedBody(run, {
      id: "run_not_reproduced_rev_2",
      runId: run.id,
      runRevision: 2,
      kind: "agent",
      stage: "reproduce",
      role: "reproduce",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    });
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
    const run = {
      ...createRun({
        id: "run_reproduction",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      stage: "plan",
      revision: 3,
    } as const;
    const attempt = {
      id: "run_reproduction_rev_2",
      runId: run.id,
      runRevision: 2,
      kind: "agent",
      stage: "reproduce",
      role: "reproduce",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      result: {
        reproduction: {
          status: "confirmed",
          summary: "The focused test fails as reported by @maintainer.",
          expectedBehavior: "The test passes.",
          observedBehavior: "The test fails.",
          commands: [{ command: "pnpm test", exitCode: 1, output: "failed" }],
          relevantFiles: ["src/example.ts"],
        },
      },
    } satisfies Attempt;
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
  });

  it("describes feature investigation as current behavior rather than reproduction", async () => {
    const run = {
      ...createRun({
        id: "run_feature_investigation",
        repository: "zorkian/roundhouse",
        issueNumber: 43,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      stage: "plan",
      revision: 3,
    } as const;
    const body = await reportedBody(run, {
      id: "run_feature_investigation_rev_2",
      runId: run.id,
      runRevision: 2,
      kind: "agent",
      stage: "reproduce",
      role: "reproduce",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    });
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
    const run = {
      ...createRun({
        id: "run_plan",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      stage: "implement",
      revision: 4,
    } as const;
    const attempt = {
      id: "run_plan_rev_3",
      runId: run.id,
      runRevision: 3,
      kind: "agent",
      stage: "plan",
      role: "plan",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    } satisfies Attempt;
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
        (path.endsWith("/comments?per_page=100")
          ? []
          : path.includes("/pulls?state=open")
            ? []
            : { default_branch: "main" }) as T,
      post: post as GitHubApi["post"],
    });
    const run = {
      ...createRun({
        id: "run_implementation",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "succeeded",
      stage: "implement",
      revision: 5,
      currentHead: "b".repeat(40),
    } as const;
    const attempt = {
      id: "run_implementation_rev_4",
      runId: run.id,
      runRevision: 4,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: "a".repeat(40),
      acceptedHead: run.currentHead,
      result: {
        implementation: {
          summary: "Empty input now returns an empty list.",
          pullRequestTitle: "Handle empty input",
          pullRequestBody: "Fixes the empty-input behavior described in #42.",
          validation: [{ command: "pnpm test", exitCode: 0, output: "passed" }],
        },
      },
    } satisfies Attempt;

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
  });

  it("updates the same draft pull request after review findings", async () => {
    const post = vi.fn(async () => ({}));
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
    const run = {
      ...createRun({
        id: "run_remediation",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "active",
      stage: "review",
      revision: 7,
      currentHead: "c".repeat(40),
    } as const;
    await reporter.report(run, {
      id: "run_remediation_rev_6",
      runId: run.id,
      runRevision: 6,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
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
    });
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
    const post = vi.fn(async () => ({}));
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
    const run = {
      ...createRun({
        id: "run_review",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "active",
      stage: "ci",
      revision: 6,
      currentHead: head,
    } as const;
    await reporter.report(run, {
      id: "run_review_rev_5",
      runId: run.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: head,
      acceptedHead: head,
      result: {
        review: {
          status: "clean",
          summary: "The change matches the requested behavior.",
          findings: [],
        },
      },
    });
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
    const run = {
      ...createRun({
        id: "run_aggregated_review",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "active",
      stage: "implement",
      revision: 6,
      currentHead: head,
    } as const;

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
    const run = {
      ...createRun({
        id: attempt.runId,
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: attempt.baseCommit,
        profileVersion: "v2",
      }),
      status: "active",
      stage: "ci",
      revision: 6,
      currentHead: head,
    } as const;

    const body = await reportedBody(run, attempt);
    expect(body).toContain("Review complete");
    expect(body).toContain("review-holistic: Minor cleanup");
    expect(body).toContain("This name could be clearer.");
    expect(body).toContain("src/name.ts");
    expect(body).toContain(`Reviewed commit \`${head}\`. CI is next.`);
  });

  it("posts a concise completion after the exact-head merge", async () => {
    const post = vi.fn(async () => ({}));
    const reporter = new GitHubStageReporter({
      get: async <T>() => [] as T,
      post: post as GitHubApi["post"],
    });
    const mergeCommit = "d".repeat(40);
    const run = {
      ...createRun({
        id: "run_merge",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "succeeded",
      stage: "merge",
      revision: 8,
      currentHead: mergeCommit,
    } as const;
    await reporter.report(run, {
      id: "run_merge_rev_7",
      runId: run.id,
      runRevision: 7,
      kind: "external",
      stage: "merge",
      role: "github-merge",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
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
    const run = {
      ...createRun({
        id: "run_failed_merge",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "failed",
      stage: "merge",
      revision: 8,
      currentHead: "c".repeat(40),
    } as const;
    await new GitHubStageReporter(api).report(run, {
      id: "run_failed_merge_rev_7",
      runId: run.id,
      runRevision: 7,
      kind: "external",
      stage: "merge",
      role: "github-merge",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
    const run = {
      ...createRun({
        id: "run_failed_implementation",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "failed",
      stage: "implement",
      revision: 5,
    } as const;
    await new GitHubStageReporter(api).report(run, {
      id: "run_failed_implementation_rev_4",
      runId: run.id,
      runRevision: 4,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      result: { outcome: "ok", checkpoint: run.currentHead },
    });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("asks plan questions without exposing workflow status", async () => {
    const run = {
      ...createRun({
        id: "run_plan_question",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "v2",
      }),
      status: "waiting",
      stage: "plan",
      revision: 4,
      waitingReason: "clarification",
    } as const;
    const body = await reportedBody(run, {
      id: "run_plan_question_rev_3",
      runId: run.id,
      runRevision: 3,
      kind: "agent",
      stage: "plan",
      role: "plan",
      state: "completed",
      deadlineAt: Date.now() + 1_000,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
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
