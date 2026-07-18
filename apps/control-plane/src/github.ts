// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import type { QualificationReporter } from "./coordinator.js";
import { verifyCallback } from "./callback.js";

export interface GitHubIntakeRepository {
  get(runId: string): Promise<RunSnapshot | undefined>;
  create(run: RunSnapshot): Promise<void>;
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
  readonly sender?: { readonly login?: string };
  readonly issue?: {
    readonly number?: number;
    readonly title?: string;
    readonly body?: string | null;
    readonly html_url?: string;
  };
  readonly comment?: { readonly body?: string };
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
    private readonly send: typeof fetch = fetch,
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

export class GitHubQualificationReporter implements QualificationReporter {
  constructor(private readonly github: GitHubApi) {}

  async report(run: RunSnapshot, attempt: Attempt): Promise<void> {
    const marker = `<!-- roundhouse:v2:qualification:${run.id} -->`;
    const comments = await this.github.get<readonly { body?: string }[]>(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments?per_page=100`,
    );
    if (comments.some((comment) => comment.body?.includes(marker))) return;
    const qualification = attempt.result?.qualification as
      Record<string, unknown> | undefined;
    const classification = String(qualification?.classification ?? "unclear");
    const summary = String(
      qualification?.summary ?? "Qualification did not produce a summary.",
    ).slice(0, 4_000);
    const next =
      run.stage === "reproduce"
        ? "Next: reproduction."
        : "Roundhouse has stopped here.";
    await this.github.post(
      `/repos/${run.repository}/issues/${run.issueNumber}/comments`,
      {
        body: `${marker}\nRoundhouse qualification: **${classification}**\n\n${summary}\n\n${next}`,
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

export async function acceptGitHubStart(
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
    payload.repository?.full_name !== enrolledRepository.repository ||
    payload.comment?.body?.trim() !== "/roundhouse start"
  )
    return "ignored";
  const actor = payload.sender?.login;
  const issueNumber = payload.issue?.number;
  if (!actor || !issueNumber) return "ignored";
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
  const id = runId(issueNumber);
  let run = await repository.get(id);
  const existing = Boolean(run);
  if (!run) {
    run = createRun({
      id,
      repository: enrolledRepository.repository,
      issueNumber,
      baseCommit: commit.sha,
      profileVersion: enrolledRepository.profileVersion,
      issue: {
        title: (payload.issue?.title ?? "").slice(0, 1_000),
        body: (payload.issue?.body ?? "").slice(0, 50_000),
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
