// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  MemoryRunRepository,
  type Attempt,
  type Wakeup,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import { signCallback } from "./callback.js";
import {
  acceptGitHubStart,
  GitHubStageReporter,
  verifyGitHubWebhook,
  type GitHubApi,
  type GitHubEnv,
} from "./github.js";

const env = {
  GITHUB_APP_ID: "development-app",
  GITHUB_APP_INSTALLATION_ID: "development-installation",
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: "not-used-by-fake",
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "webhook-secret",
} satisfies GitHubEnv;

class IntakeRepository extends MemoryRunRepository {
  readonly deliveries = new Set<string>();

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
      return { default_branch: "main" };
    }) as GitHubApi["get"],
    post: vi.fn(async () => ({})) as GitHubApi["post"],
  };
}

async function delivery(id: string, command = "/roundhouse start") {
  const body = JSON.stringify({
    action: "created",
    repository: { full_name: "zorkian/roundhouse" },
    sender: { login: "maintainer" },
    issue: {
      number: 42,
      title: "Qualify this",
      body: "Acceptance details",
      html_url: "https://github.com/zorkian/roundhouse/issues/42",
    },
    comment: { body: command },
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

describe("GitHub intake", () => {
  it("verifies the raw delivery body before parsing", async () => {
    const raw = '{"comment":{"body":"/roundhouse start"}}';
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
      acceptGitHubStart(
        await delivery("delivery-1"),
        env,
        repository,
        async (wakeup) => {
          wakeups.push(wakeup);
        },
        github(),
      ),
    ).resolves.toBe("accepted");
    await expect(
      repository.get("run_zorkian_roundhouse_issue_42"),
    ).resolves.toMatchObject(
      createRun({
        id: "run_zorkian_roundhouse_issue_42",
        repository: "zorkian/roundhouse",
        issueNumber: 42,
        baseCommit: "a".repeat(40),
        profileVersion: "roundhouse-v2-development-1",
      }),
    );
    expect(wakeups).toEqual([
      { runId: "run_zorkian_roundhouse_issue_42", expectedRevision: 1 },
    ]);
  });

  it("deduplicates delivery replay and repeated start commands", async () => {
    const repository = new IntakeRepository();
    const wakeups: Wakeup[] = [];
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    const api = github();
    await acceptGitHubStart(
      await delivery("delivery-1"),
      env,
      repository,
      enqueue,
      api,
    );
    await expect(
      acceptGitHubStart(
        await delivery("delivery-1"),
        env,
        repository,
        enqueue,
        api,
      ),
    ).resolves.toBe("duplicate");
    await expect(
      acceptGitHubStart(
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
      acceptGitHubStart(
        await delivery("delivery-1", "/roundhouse start now"),
        env,
        repository,
        enqueue,
        github(),
      ),
    ).resolves.toBe("ignored");
    await expect(
      acceptGitHubStart(
        await delivery("delivery-2"),
        env,
        repository,
        enqueue,
        github("read"),
      ),
    ).resolves.toBe("unauthorized");
    expect(enqueue).not.toHaveBeenCalled();
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
          summary: "The focused test fails as reported.",
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
        body: expect.stringContaining("Roundhouse reproduction: **confirmed**"),
      },
    );
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("Next: planning."),
    });
  });
});
