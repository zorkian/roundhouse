// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import type { AttemptReporter } from "./coordinator.js";
import { verifyCallback } from "./callback.js";

export interface GitHubIntakeRepository {
  get(runId: string): Promise<RunSnapshot | undefined>;
  create(run: RunSnapshot): Promise<void>;
  resumeClarification(
    runId: string,
    expectedRevision: number,
    issue: NonNullable<RunSnapshot["issue"]>,
  ): Promise<RunSnapshot | undefined>;
  recordGitHubDelivery(
    runId: string,
    deliveryId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<boolean>;
}

export interface GitHubApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export interface GitHubAutomationApi extends GitHubApi {
  put<T>(path: string, body: unknown): Promise<T>;
  graphql<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<T>;
}

export const enrolledRepository = Object.freeze({
  repository: "zorkian/roundhouse",
  profileVersion: "roundhouse-v2-development-1",
});

export interface GitHubEnv {
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_INSTALLATION_ID: string;
  readonly GITHUB_START_COMMAND: string;
  readonly ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: string;
  readonly ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: string;
}

interface CommentPayload {
  readonly action?: string;
  readonly repository?: { readonly full_name?: string };
  readonly sender?: { readonly login?: string; readonly type?: string };
  readonly issue?: {
    readonly number?: number;
    readonly title?: string;
    readonly body?: string | null;
    readonly html_url?: string;
  };
  readonly comment?: { readonly body?: string; readonly html_url?: string };
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function pemBytes(pem: string): ArrayBuffer {
  const encoded = pem.replace(/-----[^-]+-----/g, "").replaceAll(/\s/g, "");
  return Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)).buffer;
}

async function appJwt(env: GitHubEnv, now = Date.now()): Promise<string> {
  const header = bytesToBase64Url(
    new TextEncoder().encode('{"alg":"RS256","typ":"JWT"}'),
  );
  const issued = Math.floor(now / 1000) - 60;
  const claims = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iat: issued,
        exp: issued + 600,
        iss: env.GITHUB_APP_ID,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(env.ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `${unsigned}.${bytesToBase64Url(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    ),
  )}`;
}

export class GitHubClient {
  private token: Promise<string> | undefined;

  constructor(
    private readonly env: GitHubEnv,
    private readonly send: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}

  async installationToken(): Promise<string> {
    this.token ??= this.mintInstallationToken();
    return this.token;
  }

  private async mintInstallationToken(): Promise<string> {
    const response = await this.send(
      `https://api.github.com/app/installations/${this.env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${await appJwt(this.env)}`,
          "user-agent": "roundhouse-v2",
          "x-github-api-version": "2026-03-10",
        },
      },
    );
    if (!response.ok)
      throw new Error(`github_installation_token_${response.status}`);
    const value = (await response.json()) as { token?: string };
    if (!value.token) throw new Error("github_installation_token_missing");
    return value.token;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET");
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, "POST", body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, "PUT", body);
  }

  async graphql<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<T> {
    const response = await this.send("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await this.installationToken()}`,
        "content-type": "application/json",
        "user-agent": "roundhouse-v2",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({ query, variables }),
    });
    const value = (await response.json()) as {
      data?: T;
      errors?: readonly unknown[];
    };
    if (!response.ok || value.errors?.length || !value.data)
      throw new Error(`github_graphql_${response.status}`);
    return value.data;
  }

  private async request<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.send(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await this.installationToken()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "user-agent": "roundhouse-v2",
        "x-github-api-version": "2026-03-10",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`github_${method.toLowerCase()}_${response.status}`);
    return response.json<T>();
  }
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function questionLines(value: unknown): readonly string[] {
  const questions = stringList(value);
  return questions.length
    ? ["", "### Questions", ...questions.map((question) => `- ${question}`)]
    : [];
}

function qualificationHeading(classification: string): string {
  if (classification === "unclear") return "A few questions before I start";
  if (classification === "duplicate") return "This looks like a duplicate";
  if (classification === "already_satisfied")
    return "This appears to be already addressed";
  if (classification === "unsupported") return "I can’t take this on";
  return "I’m looking into this";
}

function reproductionHeading(status: string): string {
  if (status === "confirmed") return "I reproduced this";
  if (status === "not_reproduced") return "I couldn’t reproduce this yet";
  return "I need a little more information";
}

function reproductionComment(run: RunSnapshot, attempt: Attempt): string {
  const reproduction = attempt.result?.reproduction as
    Record<string, unknown> | undefined;
  const status = String(reproduction?.status ?? "blocked");
  const summary = String(
    reproduction?.summary ?? "I wasn’t able to summarize what happened.",
  );
  const expected = String(
    reproduction?.expectedBehavior ??
      "I couldn’t determine the expected behavior.",
  );
  const observed = String(
    reproduction?.observedBehavior ??
      "I couldn’t determine the current behavior.",
  );
  const waiting = run.status === "waiting";
  return [
    `<!-- roundhouse:v2:reproduction:${attempt.id} -->`,
    `## ${reproductionHeading(status)}`,
    "",
    summary,
    "",
    "### Expected",
    expected,
    "",
    "### What I found",
    observed,
    ...(waiting ? questionLines(reproduction?.uncertainties) : []),
    ...(waiting ? [] : ["", "I’ll put together a plan for the change next."]),
  ].join("\n");
}

function planComment(run: RunSnapshot, attempt: Attempt): string {
  const plan = attempt.result?.plan as Record<string, unknown> | undefined;
  const summary = String(
    plan?.summary ?? "I wasn’t able to prepare a proposed approach.",
  );
  const acceptance = stringList(plan?.acceptanceCriteria);
  const proposedChange = String(
    plan?.proposedChange ??
      "I need more information before I can propose a change.",
  );
  const waiting = run.status === "waiting";
  return [
    `<!-- roundhouse:v2:plan:${attempt.id} -->`,
    `## ${waiting ? "A few questions about the proposed change" : "Proposed approach"}`,
    "",
    summary,
    "",
    "### Proposed change",
    proposedChange,
    ...(acceptance.length
      ? ["", "### Done when", ...acceptance.map((item) => `- ${item}`)]
      : []),
    ...(waiting ? questionLines(plan?.questions) : []),
    ...(waiting ? [] : ["", "This is ready to be worked on."]),
  ].join("\n");
}

function implementationComment(
  attempt: Attempt,
  pullRequest: { readonly number: number; readonly html_url: string },
  created: boolean,
): string {
  const implementation = attempt.result?.implementation as
    Record<string, unknown> | undefined;
  const summary = String(
    implementation?.summary ?? "The requested change is ready for review.",
  );
  return [
    `<!-- roundhouse:v2:implementation:${attempt.id} -->`,
    `## I ${created ? "opened" : "updated"} the draft pull request`,
    "",
    summary,
    "",
    `[View draft pull request #${pullRequest.number}](${pullRequest.html_url})`,
  ].join("\n");
}

export interface OpenPullRequest {
  readonly number: number;
  readonly html_url: string;
  readonly node_id?: string;
  readonly draft?: boolean;
  readonly state?: string;
  readonly merged?: boolean;
  readonly merge_commit_sha?: string | null;
  readonly head?: { readonly sha?: string };
}

export async function findPullRequest(
  github: GitHubApi,
  run: RunSnapshot,
  state: "open" | "all" = "open",
): Promise<OpenPullRequest | undefined> {
  const owner = run.repository.split("/")[0];
  const head = encodeURIComponent(
    `${owner}:roundhouse/issue-${run.issueNumber}`,
  );
  const pulls = await github.get<readonly OpenPullRequest[]>(
    `/repos/${run.repository}/pulls?state=${state}&head=${head}`,
  );
  return pulls[0];
}

const findOpenPullRequest = (github: GitHubApi, run: RunSnapshot) =>
  findPullRequest(github, run, "open");

function reviewComment(attempt: Attempt): string {
  const review = attempt.result?.review as Record<string, unknown> | undefined;
  const clean = review?.status === "clean";
  const summary = String(
    review?.summary ?? "The review could not be summarized.",
  );
  const findings = Array.isArray(review?.findings)
    ? review.findings.filter(
        (finding): finding is Record<string, unknown> =>
          Boolean(finding) && typeof finding === "object",
      )
    : [];
  return [
    `<!-- roundhouse:v2:review:${attempt.id} -->`,
    `## ${clean ? "Review complete" : "Review found changes to make"}`,
    "",
    summary,
    ...(clean
      ? ["", `Reviewed commit \`${attempt.expectedHead}\`. CI is next.`]
      : findings.flatMap((finding) => {
          const file = String(finding.file ?? "").trim();
          return [
            "",
            `- **${String(finding.title ?? "Finding")}**${file ? ` (\`${file}\`)` : ""}: ${String(finding.details ?? "")}`,
          ];
        })),
  ].join("\n");
}

function pullRequestBody(
  run: RunSnapshot,
  implementation?: Record<string, unknown>,
) {
  const summary = String(
    implementation?.pullRequestBody ??
      `Implements the change requested in #${run.issueNumber}.`,
  ).trim();
  return `${summary}\n\nFixes #${run.issueNumber}`;
}

export class GitHubStageReporter implements AttemptReporter {
  constructor(private readonly github: GitHubApi) {}

  async report(run: RunSnapshot, attempt: Attempt): Promise<void> {
    if (attempt.stage === "implement" && run.status === "failed") return;
    if (attempt.stage === "ci") return;
    if (attempt.stage === "merge") {
      const merge = attempt.result?.merge as
        Record<string, unknown> | undefined;
      const pullRequest = merge?.pullRequest as
        Record<string, unknown> | undefined;
      const marker = `<!-- roundhouse:v2:merge:${attempt.id} -->`;
      const comments = await this.github.get<readonly { body?: string }[]>(
        `/repos/${run.repository}/issues/${run.issueNumber}/comments?per_page=100`,
      );
      if (comments.some((comment) => comment.body?.includes(marker))) return;
      await this.github.post(
        `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
        {
          body: [
            marker,
            "## Merged",
            "",
            "The change passed review and CI and has been merged.",
            ...(pullRequest?.html_url
              ? [
                  "",
                  `[View pull request #${pullRequest.number}](${pullRequest.html_url})`,
                ]
              : []),
          ].join("\n"),
        },
      );
      return;
    }
    if (attempt.stage === "review") {
      const pullRequest = await findOpenPullRequest(this.github, run);
      if (!pullRequest) throw new Error("review_pull_request_missing");
      const marker = `<!-- roundhouse:v2:review:${attempt.id} -->`;
      const comments = await this.github.get<readonly { body?: string }[]>(
        `/repos/${run.repository}/issues/${pullRequest.number}/comments?per_page=100`,
      );
      if (comments.some((comment) => comment.body?.includes(marker))) return;
      await this.github.post(
        `/repos/${run.repository}/issues/${pullRequest.number}/comments`,
        { body: reviewComment(attempt).slice(0, 65_000) },
      );
      return;
    }
    const phase =
      attempt.stage === "reproduce"
        ? "reproduction"
        : attempt.stage === "plan"
          ? "plan"
          : attempt.stage === "implement"
            ? "implementation"
            : "qualification";
    const marker = `<!-- roundhouse:v2:${phase}:${attempt.id} -->`;
    const comments = await this.github.get<readonly { body?: string }[]>(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments?per_page=100`,
    );
    if (comments.some((comment) => comment.body?.includes(marker))) return;
    if (attempt.stage === "implement") {
      const implementation = attempt.result?.implementation as
        Record<string, unknown> | undefined;
      let pullRequest = await findOpenPullRequest(this.github, run);
      const created = !pullRequest;
      if (!pullRequest) {
        const repository = await this.github.get<{ default_branch?: string }>(
          `/repos/${run.repository}`,
        );
        pullRequest = await this.github.post<OpenPullRequest>(
          `/repos/${run.repository}/pulls`,
          {
            title: String(
              implementation?.pullRequestTitle ?? `Resolve #${run.issueNumber}`,
            ),
            head: `roundhouse/issue-${run.issueNumber}`,
            base: repository.default_branch ?? "main",
            body: pullRequestBody(run, implementation),
            draft: true,
          },
        );
      }
      await this.github.post(
        `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
        {
          body: implementationComment(attempt, pullRequest, created).slice(
            0,
            65_000,
          ),
        },
      );
      return;
    }
    if (attempt.stage === "reproduce") {
      await this.github.post(
        `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
        { body: reproductionComment(run, attempt).slice(0, 65_000) },
      );
      return;
    }
    if (attempt.stage === "plan") {
      await this.github.post(
        `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
        { body: planComment(run, attempt).slice(0, 65_000) },
      );
      return;
    }
    const qualification = attempt.result?.qualification as
      Record<string, unknown> | undefined;
    const classification = String(qualification?.classification ?? "unclear");
    const summary = String(
      qualification?.summary ??
        "I need more information before I can continue.",
    );
    const waiting = run.status === "waiting";
    await this.github.post(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
      {
        body: [
          marker,
          `## ${qualificationHeading(classification)}`,
          "",
          summary,
          ...(waiting ? questionLines(qualification?.uncertainties) : []),
          ...(run.stage === "reproduce"
            ? ["", "I’ll check what the project does today."]
            : []),
        ]
          .join("\n")
          .slice(0, 65_000),
      },
    );
  }
}

function runId(issueNumber: number): string {
  return `run_zorkian_roundhouse_issue_${issueNumber}`;
}

export async function verifyGitHubWebhook(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  return verifyCallback(secret, body, signature.slice(7));
}

export async function acceptGitHubComment(
  request: Request,
  env: GitHubEnv,
  repository: GitHubIntakeRepository,
  enqueue: (wakeup: Wakeup) => Promise<void>,
  github: GitHubApi = new GitHubClient(env),
): Promise<"accepted" | "duplicate" | "ignored" | "unauthorized"> {
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!deliveryId || event !== "issue_comment") return "ignored";
  const raw = await request.text();
  if (
    !(await verifyGitHubWebhook(
      raw,
      signature,
      env.ROUNDHOUSE_GITHUB_WEBHOOK_SECRET,
    ))
  )
    return "unauthorized";
  const payload = JSON.parse(raw) as CommentPayload;
  if (
    payload.action !== "created" ||
    payload.repository?.full_name !== enrolledRepository.repository
  )
    return "ignored";
  const actor = payload.sender?.login;
  const issueNumber = payload.issue?.number;
  const comment = payload.comment?.body;
  if (!actor || !issueNumber || !comment) return "ignored";
  const id = runId(issueNumber);
  let run = await repository.get(id);
  if (comment.trim() !== env.GITHUB_START_COMMAND) {
    if (
      payload.sender?.type === "Bot" ||
      comment.includes("<!-- roundhouse:v2:") ||
      !run?.issue ||
      run.status !== "waiting" ||
      run.waitingReason !== "clarification"
    )
      return "ignored";
    const fresh = await repository.recordGitHubDelivery(id, deliveryId, {
      event,
      actor,
      issueNumber,
    });
    if (!fresh) return "duplicate";
    run = await repository.resumeClarification(id, run.revision, {
      ...run.issue,
      title: payload.issue?.title ?? run.issue.title,
      body: payload.issue?.body ?? run.issue.body,
      url: payload.issue?.html_url ?? run.issue.url,
      clarifications: [
        ...(run.issue.clarifications ?? []),
        {
          actor,
          body: comment,
          ...(payload.comment?.html_url
            ? { url: payload.comment.html_url }
            : {}),
        },
      ],
    });
    if (!run) return "ignored";
    await enqueue({ runId: id, expectedRevision: run.revision });
    return "accepted";
  }
  const permission = await github.get<{ permission?: string }>(
    `/repos/${enrolledRepository.repository}/collaborators/${encodeURIComponent(actor)}/permission`,
  );
  if (!new Set(["admin", "maintain", "write"]).has(permission.permission ?? ""))
    return "unauthorized";
  const repo = await github.get<{ default_branch: string }>(
    `/repos/${enrolledRepository.repository}`,
  );
  const commit = await github.get<{ sha: string }>(
    `/repos/${enrolledRepository.repository}/commits/${encodeURIComponent(repo.default_branch)}`,
  );
  const existing = Boolean(run);
  if (!run) {
    run = createRun({
      id,
      repository: enrolledRepository.repository,
      issueNumber,
      baseCommit: commit.sha,
      profileVersion: enrolledRepository.profileVersion,
      issue: {
        title: payload.issue?.title ?? "",
        body: payload.issue?.body ?? "",
        url: payload.issue?.html_url ?? "",
        actor,
      },
    });
    await repository.create(run);
  }
  const fresh = await repository.recordGitHubDelivery(id, deliveryId, {
    event,
    actor,
    issueNumber,
  });
  if (!fresh) return "duplicate";
  if (existing) return "duplicate";
  await enqueue({ runId: id, expectedRevision: run.revision });
  return "accepted";
}
