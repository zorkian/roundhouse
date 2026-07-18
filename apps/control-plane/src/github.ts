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

export const enrolledRepository = Object.freeze({
  repository: "zorkian/roundhouse",
  profileVersion: "roundhouse-v2-development-1",
});

export interface GitHubEnv {
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_INSTALLATION_ID: string;
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

  private async installationToken(): Promise<string> {
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
    ? ["", "Questions:", ...questions.map((question) => `- ${question}`)]
    : [];
}

function reproductionComment(run: RunSnapshot, attempt: Attempt): string {
  const reproduction = attempt.result?.reproduction as
    Record<string, unknown> | undefined;
  const status = String(reproduction?.status ?? "blocked");
  const summary = String(
    reproduction?.summary ?? "Reproduction did not produce a summary.",
  );
  const expected = String(reproduction?.expectedBehavior ?? "Not reported.");
  const observed = String(reproduction?.observedBehavior ?? "Not reported.");
  const next =
    run.status === "waiting" ? "Please reply in prose." : "Next: planning.";
  return [
    `<!-- roundhouse:v2:reproduction:${attempt.id} -->`,
    `Roundhouse reproduction: **${status}**`,
    "",
    summary,
    "",
    `Expected: ${expected}`,
    "",
    `Observed: ${observed}`,
    ...questionLines(reproduction?.uncertainties),
    "",
    next,
  ].join("\n");
}

function planComment(run: RunSnapshot, attempt: Attempt): string {
  const plan = attempt.result?.plan as Record<string, unknown> | undefined;
  const status = String(plan?.status ?? "needs_clarification");
  const summary = String(
    plan?.summary ?? "Planning did not produce a summary.",
  );
  const acceptance = stringList(plan?.acceptanceCriteria);
  const validation = stringList(plan?.validation);
  const proposedChange = String(plan?.proposedChange ?? "Not reported.");
  const next =
    run.status === "waiting"
      ? "Please reply in prose."
      : "Next: implementation.";
  return [
    `<!-- roundhouse:v2:plan:${attempt.id} -->`,
    `Roundhouse plan: **${status}**`,
    "",
    summary,
    "",
    "Proposed change:",
    proposedChange,
    ...(acceptance.length
      ? ["", "Acceptance criteria:", ...acceptance.map((item) => `- ${item}`)]
      : []),
    ...(validation.length
      ? ["", "Validation:", ...validation.map((item) => `- ${item}`)]
      : []),
    ...questionLines(plan?.questions),
    "",
    next,
  ].join("\n");
}

export class GitHubStageReporter implements AttemptReporter {
  constructor(private readonly github: GitHubApi) {}

  async report(run: RunSnapshot, attempt: Attempt): Promise<void> {
    const phase =
      attempt.stage === "reproduce"
        ? "reproduction"
        : attempt.stage === "plan"
          ? "plan"
          : "qualification";
    const marker = `<!-- roundhouse:v2:${phase}:${attempt.id} -->`;
    const comments = await this.github.get<readonly { body?: string }[]>(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments?per_page=100`,
    );
    if (comments.some((comment) => comment.body?.includes(marker))) return;
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
      qualification?.summary ?? "Qualification did not produce a summary.",
    );
    const next =
      run.status === "waiting"
        ? "Please reply in prose."
        : run.stage === "reproduce"
          ? "Next: reproduction."
          : "Roundhouse has stopped here.";
    await this.github.post(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
      {
        body: [
          marker,
          `Roundhouse qualification: **${classification}**`,
          "",
          summary,
          ...questionLines(qualification?.uncertainties),
          "",
          next,
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
  if (comment.trim() !== "/roundhouse start") {
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
