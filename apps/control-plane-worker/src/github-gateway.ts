// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  githubIssueSnapshotSchema,
  trustedPublicationManifestSchema,
  type GitHubIssueReference,
  type GitHubIssueSnapshot,
  type GitHubPublicationResult,
  type TrustedPublicationManifest,
} from "@roundhouse/self-development/cloudflare";
import { importPKCS8, SignJWT } from "jose";

import {
  renderPullRequestPackage,
  replacePullRequestPackageSection,
  type PullRequestPackage,
} from "./github-pr-package.js";

type Fetch = typeof fetch;

type GatewayConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
  repositoryFullName?: "zorkian/roundhouse";
  userAgent?: string;
};

type GitHubResponse<T> = { status: number; value: T };

export type GitHubIssueState = {
  repositoryFullName: string;
  issueNumber: number;
  state: "open" | "closed";
  updatedAt: string;
  closedAt?: string;
};

export type GitHubIssueStateReference = {
  schemaVersion: 1;
  owner: string;
  repository: string;
  number: number;
};

export class GitHubAppGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const owned = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  owned.set(bytes);
  return hex(await crypto.subtle.digest("SHA-256", owned));
}

function safeGitHubError(status: number): GitHubAppGatewayError {
  return new GitHubAppGatewayError(
    `api_status_${status}`,
    `GitHub API request failed with status ${status}`,
    status === 429 || status >= 500,
  );
}

function repositoryPath(repositoryFullName: string): string {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName))
    throw new GitHubAppGatewayError(
      "invalid_request",
      "GitHub repository identity is invalid",
    );
  const [owner, repository] = repositoryFullName.split("/");
  return `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repository!)}`;
}

export class GitHubAppGateway {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: GatewayConfig,
    private readonly fetcher: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  private get repositoryFullName(): "zorkian/roundhouse" {
    return this.config.repositoryFullName ?? "zorkian/roundhouse";
  }

  private get repositoryPath(): string {
    return repositoryPath(this.repositoryFullName);
  }

  private async appJwt(): Promise<string> {
    try {
      const now = Math.floor(this.now().getTime() / 1_000);
      const key = await importPKCS8(this.config.privateKey, "RS256");
      return await new SignJWT({})
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(this.config.appId)
        .setIssuedAt(now - 30)
        .setExpirationTime(now + 540)
        .sign(key);
    } catch {
      throw new GitHubAppGatewayError(
        "signing_failed",
        "GitHub App signing failed",
      );
    }
  }

  private async installationToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now().getTime() + 60_000)
      return this.token.value;
    const response = await this.api<{ token: string; expires_at: string }>(
      "POST",
      `/app/installations/${this.config.installationId}/access_tokens`,
      {},
      await this.appJwt(),
    );
    this.token = {
      value: response.value.token,
      expiresAt: new Date(response.value.expires_at).getTime(),
    };
    return this.token.value;
  }

  private async api<T>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<GitHubResponse<T>> {
    let response: Response;
    try {
      const fetcher = this.fetcher;
      response = await fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token ?? (await this.installationToken())}`,
          "content-type": "application/json",
          "user-agent": this.config.userAgent ?? "roundhouse-control-plane",
          "x-github-api-version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof GitHubAppGatewayError) throw error;
      throw new GitHubAppGatewayError(
        "transport_failed",
        "GitHub API transport failed",
        true,
      );
    }
    let value: T;
    try {
      value = (await response.json()) as T;
    } catch {
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub API response was invalid",
      );
    }
    if (!response.ok) throw safeGitHubError(response.status);
    return { status: response.status, value };
  }

  private async rawApi(
    method: string,
    path: string,
    accept = "application/vnd.github+json",
  ): Promise<Response> {
    let response: Response;
    try {
      const fetcher = this.fetcher;
      response = await fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          accept,
          authorization: `Bearer ${await this.installationToken()}`,
          "user-agent": this.config.userAgent ?? "roundhouse-control-plane",
          "x-github-api-version": "2022-11-28",
        },
      });
    } catch (error) {
      if (error instanceof GitHubAppGatewayError) throw error;
      throw new GitHubAppGatewayError(
        "transport_failed",
        "GitHub API transport failed",
        true,
      );
    }
    if (!response.ok) throw safeGitHubError(response.status);
    return response;
  }

  async boundedActionsJobLogs(
    repositoryFullName: string,
    jobId: number,
    limit = 32_768,
  ): Promise<string> {
    if (
      !Number.isSafeInteger(jobId) ||
      jobId < 1 ||
      limit < 1 ||
      limit > 65_536
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub Actions job log request is invalid",
      );
    const response = await this.rawApi(
      "GET",
      `${repositoryPath(repositoryFullName)}/actions/jobs/${jobId}/logs`,
    );
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      length += chunk.byteLength;
      if (value.byteLength > remaining) {
        await reader.cancel();
        break;
      }
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  }

  async rerunActionsJob(
    repositoryFullName: string,
    jobId: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(jobId) || jobId < 1)
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub Actions job rerun request is invalid",
      );
    await this.rawApi(
      "POST",
      `${repositoryPath(repositoryFullName)}/actions/jobs/${jobId}/rerun`,
    );
  }

  async fetchIssue(
    reference: GitHubIssueReference,
  ): Promise<GitHubIssueSnapshot> {
    const issue = (
      await this.api<{
        number: number;
        node_id: string;
        html_url: string;
        title: string;
        body: string | null;
        updated_at: string;
        pull_request?: unknown;
      }>(
        "GET",
        `/repos/${reference.owner}/${reference.repository}/issues/${reference.number}`,
      )
    ).value;
    if (issue.pull_request !== undefined)
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub issue response was invalid",
      );
    const body = issue.body ?? "";
    try {
      return githubIssueSnapshotSchema.parse({
        schemaVersion: 1,
        owner: reference.owner,
        repository: reference.repository,
        number: issue.number,
        nodeId: issue.node_id,
        url: issue.html_url,
        title: issue.title,
        body,
        updatedAt: new Date(issue.updated_at).toISOString(),
        fetchedAt: this.now().toISOString(),
        contentSha256: await sha256(
          JSON.stringify({
            title: issue.title,
            body,
            updatedAt: new Date(issue.updated_at).toISOString(),
          }),
        ),
      });
    } catch {
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub issue response was invalid",
      );
    }
  }

  async fetchIssueState(
    reference: GitHubIssueStateReference,
  ): Promise<GitHubIssueState> {
    const repositoryFullName = `${reference.owner}/${reference.repository}`;
    if (
      repositoryFullName !== this.repositoryFullName ||
      !Number.isSafeInteger(reference.number) ||
      reference.number < 1
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub issue state request was invalid",
      );
    const issue = (
      await this.api<{
        number: number;
        html_url: string;
        state: string;
        updated_at: string;
        closed_at: string | null;
        pull_request?: unknown;
      }>(
        "GET",
        `/repos/${reference.owner}/${reference.repository}/issues/${reference.number}`,
      )
    ).value;
    try {
      if (
        issue.number !== reference.number ||
        issue.html_url !==
          `https://github.com/${repositoryFullName}/issues/${reference.number}` ||
        !["open", "closed"].includes(issue.state) ||
        issue.pull_request !== undefined
      )
        throw new Error("invalid issue state");
      return {
        repositoryFullName,
        issueNumber: issue.number,
        state: issue.state as "open" | "closed",
        updatedAt: new Date(issue.updated_at).toISOString(),
        ...(issue.closed_at
          ? { closedAt: new Date(issue.closed_at).toISOString() }
          : {}),
      };
    } catch {
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub issue state response was invalid",
      );
    }
  }

  async mainHead(): Promise<string> {
    return (
      await this.api<{ object: { sha: string } }>(
        "GET",
        `${this.repositoryPath}/git/ref/heads/main`,
      )
    ).value.object.sha;
  }

  async createIssueComment(
    repositoryFullName: string,
    issueNumber: number,
    body: string,
  ): Promise<{ id: number; url: string }> {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub issue number is invalid",
      );
    const base = repositoryPath(repositoryFullName);
    const value = (
      await this.api<{ id: number; html_url: string }>(
        "POST",
        `${base}/issues/${issueNumber}/comments`,
        { body },
      )
    ).value;
    const url = new URL(value.html_url);
    const expectedIssuePath = `/${repositoryFullName}/issues/${issueNumber}`;
    const expectedPullPath = `/${repositoryFullName}/pull/${issueNumber}`;
    if (
      !Number.isSafeInteger(value.id) ||
      value.id < 1 ||
      url.origin !== "https://github.com" ||
      (url.pathname !== expectedIssuePath &&
        url.pathname !== expectedPullPath) ||
      !/^#issuecomment-[1-9][0-9]*$/.test(url.hash)
    )
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub comment response was invalid",
      );
    return { id: value.id, url: value.html_url };
  }

  async upsertIssueStatusComment(input: {
    repositoryFullName: string;
    issueNumber: number;
    body: string;
    existingCommentId?: number;
  }): Promise<{ id: number; url: string }> {
    if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1)
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub issue number is invalid",
      );
    const base = repositoryPath(input.repositoryFullName);
    const marker = input.body.split("\n", 1)[0] ?? "";
    const statusMarkers = ["dev", "prod"].map(
      (namespace) =>
        `<!-- roundhouse-${namespace}-status:${input.repositoryFullName}#${input.issueNumber} -->`,
    );
    const progressPrefixes = ["dev", "prod"].map(
      (namespace) =>
        `<!-- roundhouse-${namespace}-progress:${input.repositoryFullName}#${input.issueNumber}:`,
    );
    const progressPrefix = progressPrefixes.find((prefix) =>
      marker.startsWith(prefix),
    );
    if (
      !statusMarkers.includes(marker) &&
      (!progressPrefix ||
        !/^[a-zA-Z0-9:_-]{1,200} -->$/.test(
          marker.slice(progressPrefix.length),
        ))
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub status comment marker is invalid",
      );
    type Comment = {
      id: number;
      html_url: string;
      body: string;
    };
    const validate = (value: Comment): { id: number; url: string } => {
      const url = new URL(value.html_url);
      const expectedIssuePath = `/${input.repositoryFullName}/issues/${input.issueNumber}`;
      const expectedPullPath = `/${input.repositoryFullName}/pull/${input.issueNumber}`;
      if (
        !Number.isSafeInteger(value.id) ||
        value.id < 1 ||
        url.origin !== "https://github.com" ||
        (url.pathname !== expectedIssuePath &&
          url.pathname !== expectedPullPath) ||
        !/^#issuecomment-[1-9][0-9]*$/.test(url.hash)
      )
        throw new GitHubAppGatewayError(
          "invalid_response",
          "GitHub comment response was invalid",
        );
      return { id: value.id, url: value.html_url };
    };
    const find = async (): Promise<Comment | undefined> =>
      (
        await this.api<Comment[]>(
          "GET",
          `${base}/issues/${input.issueNumber}/comments?per_page=100`,
        )
      ).value.find((value) => value.body.startsWith(marker));
    const update = async (id: number): Promise<{ id: number; url: string }> =>
      validate(
        (
          await this.api<Comment>("PATCH", `${base}/issues/comments/${id}`, {
            body: input.body,
          })
        ).value,
      );
    if (input.existingCommentId) {
      try {
        return await update(input.existingCommentId);
      } catch (error) {
        const reconciled = await find();
        if (reconciled?.body === input.body) return validate(reconciled);
        throw error;
      }
    }
    const existing = await find();
    if (existing) return update(existing.id);
    try {
      return validate(
        (
          await this.api<Comment>(
            "POST",
            `${base}/issues/${input.issueNumber}/comments`,
            { body: input.body },
          )
        ).value,
      );
    } catch (error) {
      const reconciled = await find();
      if (reconciled?.body === input.body) return validate(reconciled);
      throw error;
    }
  }

  async closeIssue(
    repositoryFullName: string,
    issueNumber: number,
  ): Promise<{ number: number; state: "closed"; url: string }> {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub issue number is invalid",
      );
    const value = (
      await this.api<{
        number: number;
        state: string;
        html_url: string;
        pull_request?: unknown;
      }>(
        "PATCH",
        `${repositoryPath(repositoryFullName)}/issues/${issueNumber}`,
        {
          state: "closed",
          state_reason: "completed",
        },
      )
    ).value;
    const expectedUrl = `https://github.com/${repositoryFullName}/issues/${issueNumber}`;
    if (
      value.number !== issueNumber ||
      value.state !== "closed" ||
      value.html_url !== expectedUrl ||
      value.pull_request !== undefined
    )
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub issue close response was invalid",
      );
    return { number: value.number, state: "closed", url: value.html_url };
  }

  async markPullRequestReady(input: {
    repositoryFullName: string;
    pullRequestNumber: number;
    expectedHeadSha: string;
  }): Promise<{ number: number; url: string; ready: true }> {
    if (
      !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber < 1 ||
      !/^[a-f0-9]{40}$/.test(input.expectedHeadSha)
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub pull request identity is invalid",
      );
    const pull = (
      await this.api<{
        number: number;
        node_id: string;
        html_url: string;
        draft: boolean;
        head: { sha: string };
      }>(
        "GET",
        `${repositoryPath(input.repositoryFullName)}/pulls/${input.pullRequestNumber}`,
      )
    ).value;
    const expectedUrl = `https://github.com/${input.repositoryFullName}/pull/${input.pullRequestNumber}`;
    if (
      pull.number !== input.pullRequestNumber ||
      !pull.node_id ||
      pull.html_url !== expectedUrl ||
      pull.head.sha !== input.expectedHeadSha
    )
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub pull request readiness binding did not match",
      );
    if (!pull.draft)
      return { number: pull.number, url: pull.html_url, ready: true };
    const response = (
      await this.api<{
        data?: {
          markPullRequestReadyForReview?: {
            pullRequest: { number: number; url: string; isDraft: boolean };
          };
        };
        errors?: unknown[];
      }>("POST", "/graphql", {
        query:
          "mutation MarkReady($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number url isDraft } } }",
        variables: { id: pull.node_id },
      })
    ).value;
    const ready = response.data?.markPullRequestReadyForReview?.pullRequest;
    if (
      response.errors?.length ||
      !ready ||
      ready.number !== input.pullRequestNumber ||
      ready.url !== expectedUrl ||
      ready.isDraft
    )
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub did not mark the pull request ready for review",
      );
    return { number: ready.number, url: ready.url, ready: true };
  }

  async mergePullRequest(input: {
    repositoryFullName: string;
    pullRequestNumber: number;
    expectedBaseSha: string;
    expectedHeadSha: string;
    approvedPaths?: string[];
  }): Promise<{
    number: number;
    url: string;
    headSha: string;
    mergeCommitSha: string;
    mergedAt: string;
    alreadyMerged: boolean;
  }> {
    if (
      !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber < 1 ||
      !/^[a-f0-9]{40}$/.test(input.expectedBaseSha) ||
      !/^[a-f0-9]{40}$/.test(input.expectedHeadSha)
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub pull request merge identity is invalid",
      );
    const path = `${repositoryPath(input.repositoryFullName)}/pulls/${input.pullRequestNumber}`;
    const expectedUrl = `https://github.com/${input.repositoryFullName}/pull/${input.pullRequestNumber}`;
    const read = async () =>
      (
        await this.api<{
          number: number;
          html_url: string;
          state: string;
          draft: boolean;
          merged: boolean;
          merge_commit_sha: string | null;
          merged_at: string | null;
          base: { sha: string; repo: { full_name: string } };
          head: { sha: string; repo: { full_name: string } };
        }>("GET", path)
      ).value;
    const validate = async (
      pull: Awaited<ReturnType<typeof read>>,
    ): Promise<void> => {
      if (
        pull.number !== input.pullRequestNumber ||
        pull.html_url !== expectedUrl ||
        pull.base.repo.full_name !== input.repositoryFullName ||
        pull.head.repo.full_name !== input.repositoryFullName
      )
        throw new GitHubAppGatewayError(
          "invalid_response",
          "GitHub pull request merge binding did not match",
        );
      if (pull.head.sha !== input.expectedHeadSha)
        throw new GitHubAppGatewayError(
          "stale_head",
          "GitHub pull request head changed before merge",
        );
      if (!pull.merged && !/^[a-f0-9]{40}$/.test(pull.base.sha))
        throw new GitHubAppGatewayError(
          "invalid_response",
          "GitHub pull request base was invalid before merge",
        );
      if (!pull.merged && pull.base.sha !== input.expectedBaseSha) {
        const approvedPaths = new Set(
          (input.approvedPaths ?? []).map((path) => path.toLowerCase()),
        );
        const comparison = (
          await this.api<{
            status: string;
            ahead_by: number;
            total_commits: number;
            base_commit: { sha: string };
            merge_base_commit: { sha: string };
            commits: Array<{ sha: string }>;
            files?: Array<{ filename: string }>;
          }>(
            "GET",
            `${repositoryPath(input.repositoryFullName)}/compare/${input.expectedBaseSha}...${pull.base.sha}?per_page=100&page=1`,
          )
        ).value;
        const interveningFiles = comparison.files;
        if (
          approvedPaths.size === 0 ||
          comparison.status !== "ahead" ||
          comparison.base_commit.sha !== input.expectedBaseSha ||
          comparison.merge_base_commit.sha !== input.expectedBaseSha ||
          comparison.ahead_by !== comparison.total_commits ||
          comparison.total_commits !== comparison.commits.length ||
          comparison.commits.at(-1)?.sha !== pull.base.sha ||
          !interveningFiles ||
          interveningFiles.length >= 100 ||
          new Set(interveningFiles.map((file) => file.filename)).size !==
            interveningFiles.length ||
          interveningFiles.some((file) =>
            approvedPaths.has(file.filename.toLowerCase()),
          )
        )
          throw new GitHubAppGatewayError(
            "stale_base",
            "GitHub pull request base changed before merge",
          );
      }
    };
    const reconciled = async (pull: Awaited<ReturnType<typeof read>>) => {
      await validate(pull);
      if (!pull.merged || !/^[a-f0-9]{40}$/.test(pull.merge_commit_sha ?? ""))
        return undefined;
      if (
        typeof pull.merged_at !== "string" ||
        !Number.isFinite(Date.parse(pull.merged_at))
      )
        throw new GitHubAppGatewayError(
          "invalid_response",
          "GitHub pull request merge timestamp was invalid",
        );
      return {
        number: pull.number,
        url: pull.html_url,
        headSha: pull.head.sha,
        mergeCommitSha: pull.merge_commit_sha!,
        mergedAt: pull.merged_at,
        alreadyMerged: true,
      };
    };
    const before = await read();
    const existing = await reconciled(before);
    if (existing) return existing;
    if (before.state !== "open")
      throw new GitHubAppGatewayError(
        "closed_unmerged",
        "GitHub pull request closed without merge",
      );
    if (before.draft)
      throw new GitHubAppGatewayError(
        "draft_pull_request",
        "GitHub pull request is still a draft",
      );
    let requestedSha: string | undefined;
    try {
      const response = (
        await this.api<{ sha: string; merged: boolean; message: string }>(
          "PUT",
          `${path}/merge`,
          { sha: input.expectedHeadSha, merge_method: "merge" },
        )
      ).value;
      if (!response.merged || !/^[a-f0-9]{40}$/.test(response.sha))
        throw new GitHubAppGatewayError(
          "merge_rejected",
          "GitHub rejected the exact pull request merge",
        );
      requestedSha = response.sha;
    } catch (error) {
      const afterFailure = await read().catch(() => undefined);
      const recovered = afterFailure
        ? await reconciled(afterFailure).catch((error) => {
            if (error instanceof GitHubAppGatewayError && !error.retryable)
              throw error;
            return undefined;
          })
        : undefined;
      if (recovered) return recovered;
      throw error;
    }
    const after = await read();
    const completed = await reconciled(after);
    if (!completed || completed.mergeCommitSha !== requestedSha)
      throw new GitHubAppGatewayError(
        "ambiguous_merge",
        "GitHub pull request merge could not be verified",
        true,
      );
    return { ...completed, alreadyMerged: false };
  }

  async manualReviewPullRequest(input: {
    repositoryFullName: string;
    pullRequestNumber: number;
    expectedHeadSha: string;
    expectedBaseSha?: string;
    approvedPaths?: string[];
  }): Promise<{
    number: number;
    url: string;
    branch: string;
    baseCommit: string;
    headCommit: string;
    patchSha256: string;
    patchSize: number;
    changedFiles: string[];
  }> {
    const base = repositoryPath(input.repositoryFullName);
    const pull = (
      await this.api<{
        number: number;
        html_url: string;
        base: { sha: string; repo: { full_name: string } };
        head: { sha: string; ref: string; repo: { full_name: string } };
      }>("GET", `${base}/pulls/${input.pullRequestNumber}`)
    ).value;
    const expectedUrl = `https://github.com/${input.repositoryFullName}/pull/${input.pullRequestNumber}`;
    if (
      pull.number !== input.pullRequestNumber ||
      pull.html_url !== expectedUrl ||
      pull.base.repo.full_name !== input.repositoryFullName ||
      pull.head.repo.full_name !== input.repositoryFullName ||
      pull.head.sha !== input.expectedHeadSha ||
      !/^[a-f0-9]{40}$/.test(pull.base.sha) ||
      (input.expectedBaseSha !== undefined &&
        !/^[a-f0-9]{40}$/.test(input.expectedBaseSha)) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(pull.head.ref)
    )
      throw new GitHubAppGatewayError(
        "stale_head",
        "Manual review pull request binding did not match",
      );
    if (
      input.expectedBaseSha !== undefined &&
      pull.base.sha !== input.expectedBaseSha
    ) {
      const comparison = (
        await this.api<{
          status: string;
          ahead_by: number;
          total_commits: number;
          base_commit: { sha: string };
          merge_base_commit: { sha: string };
          commits: Array<{ sha: string }>;
          files?: Array<{ filename: string }>;
        }>(
          "GET",
          `${base}/compare/${input.expectedBaseSha}...${pull.base.sha}?per_page=100&page=1`,
        )
      ).value;
      const interveningFiles = comparison.files;
      if (
        comparison.status !== "ahead" ||
        comparison.base_commit.sha !== input.expectedBaseSha ||
        comparison.merge_base_commit.sha !== input.expectedBaseSha ||
        comparison.ahead_by !== comparison.total_commits ||
        comparison.total_commits !== comparison.commits.length ||
        comparison.commits.at(-1)?.sha !== pull.base.sha ||
        !interveningFiles ||
        interveningFiles.length >= 100 ||
        new Set(interveningFiles.map((file) => file.filename)).size !==
          interveningFiles.length ||
        interveningFiles.some((file) =>
          input.approvedPaths?.includes(file.filename),
        )
      )
        throw new GitHubAppGatewayError(
          "base_advanced_out_of_scope",
          "Manual review pull request base advancement was not safe",
        );
    }
    const files = (
      await this.api<Array<{ filename: string }>>(
        "GET",
        `${base}/pulls/${pull.number}/files?per_page=100`,
      )
    ).value.map((file) => file.filename);
    if (
      files.length < 1 ||
      files.length > 50 ||
      new Set(files).size !== files.length ||
      files.some(
        (path) =>
          path.startsWith("/") ||
          path.includes("\\") ||
          path
            .split("/")
            .some((part) => !part || part === "." || part === ".."),
      )
    )
      throw new GitHubAppGatewayError(
        "invalid_response",
        "Manual review changed-file inventory was invalid",
      );
    const response = await this.rawApi(
      "GET",
      `${base}/pulls/${pull.number}`,
      "application/vnd.github.diff",
    );
    const patch = new Uint8Array(await response.arrayBuffer());
    if (patch.byteLength < 1 || patch.byteLength > 512 * 1024)
      throw new GitHubAppGatewayError(
        "invalid_response",
        "Manual review patch exceeded the bounded size",
      );
    const confirmed = (
      await this.api<{
        number: number;
        base: { sha: string; repo: { full_name: string } };
        head: { sha: string; repo: { full_name: string } };
      }>("GET", `${base}/pulls/${pull.number}`)
    ).value;
    if (
      confirmed.number !== pull.number ||
      confirmed.base.sha !== pull.base.sha ||
      confirmed.head.sha !== pull.head.sha ||
      confirmed.base.repo.full_name !== input.repositoryFullName ||
      confirmed.head.repo.full_name !== input.repositoryFullName
    )
      throw new GitHubAppGatewayError(
        "stale_head",
        "Manual review pull request changed while evidence was read",
      );
    return {
      number: pull.number,
      url: pull.html_url,
      branch: pull.head.ref,
      baseCommit: pull.base.sha,
      headCommit: pull.head.sha,
      patchSha256: await sha256(patch),
      patchSize: patch.byteLength,
      changedFiles: files,
    };
  }

  async upsertReviewCheck(input: {
    repositoryFullName: string;
    reviewId: string;
    headSha: string;
    status: "in_progress" | "completed";
    conclusion: "success" | "failure" | "neutral" | "action_required" | null;
    title: string;
    summary: string;
    detailsUrl: string;
    existingCheckRunId?: number;
  }): Promise<{ id: number; url: string }> {
    if (
      !/^review_[a-f0-9]{40}$/.test(input.reviewId) ||
      !/^[a-f0-9]{40}$/.test(input.headSha) ||
      (input.status === "in_progress") !== (input.conclusion === null)
    )
      throw new GitHubAppGatewayError(
        "invalid_request",
        "GitHub review Check projection is invalid",
      );
    const base = repositoryPath(input.repositoryFullName);
    type Check = {
      id: number;
      html_url: string;
      external_id: string;
      head_sha: string;
      status: string;
      conclusion: string | null;
      details_url: string;
      output: { title: string; summary: string };
    };
    const payload = {
      name: "Roundhouse independent review",
      head_sha: input.headSha,
      external_id: input.reviewId,
      details_url: input.detailsUrl,
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      output: { title: input.title, summary: input.summary },
    };
    const validate = (value: Check): { id: number; url: string } => {
      const url = new URL(value.html_url);
      if (
        !Number.isSafeInteger(value.id) ||
        value.id < 1 ||
        value.external_id !== input.reviewId ||
        value.head_sha !== input.headSha ||
        url.origin !== "https://github.com" ||
        !url.pathname.startsWith(`/${input.repositoryFullName}/runs/`)
      )
        throw new GitHubAppGatewayError(
          "invalid_response",
          "GitHub Check response was invalid",
        );
      return { id: value.id, url: value.html_url };
    };
    const exact = (value: Check): boolean =>
      value.status === input.status &&
      value.conclusion === input.conclusion &&
      value.details_url === input.detailsUrl &&
      value.output.title === input.title &&
      value.output.summary === input.summary;
    const find = async (): Promise<Check | undefined> =>
      (
        await this.api<{ check_runs: Check[] }>(
          "GET",
          `${base}/commits/${input.headSha}/check-runs?check_name=${encodeURIComponent("Roundhouse independent review")}&filter=all&per_page=100`,
        )
      ).value.check_runs.find((value) => value.external_id === input.reviewId);
    const update = async (id: number): Promise<{ id: number; url: string }> =>
      validate(
        (await this.api<Check>("PATCH", `${base}/check-runs/${id}`, payload))
          .value,
      );
    const known = input.existingCheckRunId
      ? ({ id: input.existingCheckRunId } as Check)
      : await find();
    if (known) {
      try {
        return await update(known.id);
      } catch (error) {
        const reconciled = await find();
        if (reconciled && exact(reconciled)) return validate(reconciled);
        throw error;
      }
    }
    try {
      return validate(
        (await this.api<Check>("POST", `${base}/check-runs`, payload)).value,
      );
    } catch (error) {
      const reconciled = await find();
      if (reconciled && exact(reconciled)) return validate(reconciled);
      throw error;
    }
  }

  private async existingRef(branch: string): Promise<string | null> {
    let response: Response;
    try {
      const fetcher = this.fetcher;
      response = await fetcher(
        `https://api.github.com${this.repositoryPath}/git/ref/heads/${encodeURIComponent(branch)}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${await this.installationToken()}`,
            "user-agent": this.config.userAgent ?? "roundhouse-control-plane",
            "x-github-api-version": "2022-11-28",
          },
        },
      );
    } catch (error) {
      if (error instanceof GitHubAppGatewayError) throw error;
      throw new GitHubAppGatewayError(
        "transport_failed",
        "GitHub API transport failed",
        true,
      );
    }
    if (response.status === 404) return null;
    if (!response.ok) throw safeGitHubError(response.status);
    try {
      const value = (await response.json()) as { object?: { sha?: unknown } };
      if (typeof value.object?.sha !== "string") throw new Error();
      return value.object.sha;
    } catch {
      throw new GitHubAppGatewayError(
        "invalid_response",
        "GitHub API response was invalid",
      );
    }
  }

  private async reconcileOpenPullRequest(
    branch: string,
    expectedHeadSha: string,
  ): Promise<{
    number: number;
    html_url: string;
    head: { sha: string };
  } | null> {
    let stalePullFound = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pulls = (
        await this.api<
          Array<{ number: number; html_url: string; head: { sha: string } }>
        >(
          "GET",
          `${this.repositoryPath}/pulls?state=open&head=${encodeURIComponent(this.repositoryFullName.split("/")[0]!)}:${encodeURIComponent(branch)}`,
        )
      ).value;
      const exact = pulls.find((pull) => pull.head.sha === expectedHeadSha);
      if (exact) return exact;
      stalePullFound ||= pulls.length > 0;
      if (attempt < 2) await this.sleep(500 * (attempt + 1));
    }
    if (stalePullFound)
      throw new GitHubAppGatewayError(
        "publication_ambiguous",
        "GitHub pull request head metadata did not converge",
        true,
      );
    return null;
  }

  async publish(input: {
    manifest: TrustedPublicationManifest;
    branch: string;
    expectedRemoteHead: string | null;
    commitMessage: string;
    pullRequestTitle: string;
    issueNumber: number;
    approvedAt: string;
    reviewPackage: PullRequestPackage;
  }): Promise<GitHubPublicationResult> {
    const manifest = trustedPublicationManifestSchema.parse(input.manifest);
    const baseCommit = (
      await this.api<{ tree: { sha: string } }>(
        "GET",
        `${this.repositoryPath}/git/commits/${manifest.baseCommit}`,
      )
    ).value;
    const entries: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string | null;
    }> = [];
    for (const file of manifest.files) {
      if (file.operation === "delete") {
        entries.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: null,
        });
        continue;
      }
      const blob = (
        await this.api<{ sha: string }>(
          "POST",
          `${this.repositoryPath}/git/blobs`,
          { content: file.contentBase64, encoding: "base64" },
        )
      ).value;
      entries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
    const tree = (
      await this.api<{ sha: string }>(
        "POST",
        `${this.repositoryPath}/git/trees`,
        { base_tree: baseCommit.tree.sha, tree: entries },
      )
    ).value.sha;
    const identity = {
      name: "Roundhouse Development",
      email: "roundhouse@example.invalid",
      date: input.approvedAt,
    };
    const commit = (
      await this.api<{ sha: string }>(
        "POST",
        `${this.repositoryPath}/git/commits`,
        {
          message: input.commitMessage,
          tree,
          parents: [manifest.baseCommit],
          author: identity,
          committer: identity,
        },
      )
    ).value.sha;

    const existing = await this.existingRef(input.branch);
    let reconciled = existing !== null;
    if (existing !== commit && existing !== input.expectedRemoteHead)
      throw new Error("Publication branch does not match the expected head");
    if (existing === null) {
      if (input.expectedRemoteHead !== null)
        throw new Error("Publication branch expected an existing head");
      try {
        await this.api("POST", `${this.repositoryPath}/git/refs`, {
          ref: `refs/heads/${input.branch}`,
          sha: commit,
        });
      } catch (error) {
        const after = await this.existingRef(input.branch);
        if (after !== commit) throw error;
        reconciled = true;
      }
    } else if (existing !== commit) {
      try {
        await this.api(
          "PATCH",
          `${this.repositoryPath}/git/refs/heads/${encodeURIComponent(input.branch)}`,
          { sha: commit, force: false },
        );
      } catch (error) {
        const after = await this.existingRef(input.branch);
        if (after !== commit) throw error;
        reconciled = true;
      }
    }

    let pull = await this.reconcileOpenPullRequest(input.branch, commit);
    if (!pull) {
      try {
        pull = (
          await this.api<{
            number: number;
            html_url: string;
            head: { sha: string };
          }>("POST", `${this.repositoryPath}/pulls`, {
            title: input.pullRequestTitle,
            head: input.branch,
            base: "main",
            body: renderPullRequestPackage({
              ...input.reviewPackage,
              headSha: commit,
            }),
            draft: true,
          })
        ).value;
      } catch (error) {
        pull = await this.reconcileOpenPullRequest(input.branch, commit);
        if (!pull) throw error;
        reconciled = true;
      }
    }
    await this.api("PATCH", `${this.repositoryPath}/pulls/${pull.number}`, {
      body: renderPullRequestPackage({
        ...input.reviewPackage,
        headSha: commit,
      }),
    });
    const verifiedCommit = (
      await this.api<{
        sha: string;
        tree: { sha: string };
        parents: Array<{ sha: string }>;
      }>("GET", `${this.repositoryPath}/git/commits/${commit}`)
    ).value;
    if (
      verifiedCommit.sha !== commit ||
      verifiedCommit.tree.sha !== tree ||
      verifiedCommit.parents.length !== 1 ||
      verifiedCommit.parents[0]?.sha !== manifest.baseCommit ||
      pull.head.sha !== commit
    )
      throw new Error("Published GitHub objects failed verification");
    return {
      schemaVersion: 1,
      repository: this.repositoryFullName,
      baseCommit: manifest.baseCommit,
      patchSha256: manifest.patchSha256,
      tree,
      commit,
      branch: input.branch,
      pullRequestNumber: pull.number,
      pullRequestUrl: pull.html_url,
      verifiedAt: this.now().toISOString(),
      reconciled,
    };
  }

  async updatePullRequestPackage(input: {
    repositoryFullName: string;
    pullRequestNumber: number;
    expectedHeadSha: string;
    sections: Partial<
      Record<"review" | "ci" | "limitations" | "action", string>
    >;
  }): Promise<void> {
    const base = repositoryPath(input.repositoryFullName);
    const pull = (
      await this.api<{
        number: number;
        body: string | null;
        head: { sha: string };
      }>("GET", `${base}/pulls/${input.pullRequestNumber}`)
    ).value;
    if (
      pull.number !== input.pullRequestNumber ||
      pull.head.sha !== input.expectedHeadSha
    )
      throw new GitHubAppGatewayError(
        "stale_head",
        "Pull request package update does not match the current head",
      );
    let body = pull.body ?? "";
    for (const [name, value] of Object.entries(input.sections))
      if (value !== undefined)
        body = replacePullRequestPackageSection(
          body,
          name as "review" | "ci" | "limitations" | "action",
          value,
        );
    await this.api("PATCH", `${base}/pulls/${input.pullRequestNumber}`, {
      body,
    });
  }
}
