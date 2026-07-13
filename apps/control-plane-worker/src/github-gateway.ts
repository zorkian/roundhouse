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

type Fetch = typeof fetch;

type GatewayConfig = {
  appId: string;
  installationId: string;
  privateKey: string;
  repositoryFullName?: "zorkian/roundhouse";
  userAgent?: string;
};

type GitHubResponse<T> = { status: number; value: T };

export class GitHubAppGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
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
    const marker = `<!-- roundhouse-status:${input.repositoryFullName}#${input.issueNumber} -->`;
    if (!input.body.startsWith(marker))
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

  async publish(input: {
    manifest: TrustedPublicationManifest;
    branch: string;
    expectedRemoteHead: string | null;
    commitMessage: string;
    pullRequestTitle: string;
    issueNumber: number;
    approvedAt: string;
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

    const existingPulls = (
      await this.api<
        Array<{ number: number; html_url: string; head: { sha: string } }>
      >(
        "GET",
        `${this.repositoryPath}/pulls?state=all&head=${encodeURIComponent(this.repositoryFullName.split("/")[0]!)}:${encodeURIComponent(input.branch)}`,
      )
    ).value;
    let pull = existingPulls.find((value) => value.head.sha === commit);
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
            body: `Roundhouse development dogfood for issue #${input.issueNumber}.`,
            draft: true,
          })
        ).value;
      } catch (error) {
        const reconciledPulls = (
          await this.api<
            Array<{ number: number; html_url: string; head: { sha: string } }>
          >(
            "GET",
            `${this.repositoryPath}/pulls?state=all&head=${encodeURIComponent(this.repositoryFullName.split("/")[0]!)}:${encodeURIComponent(input.branch)}`,
          )
        ).value;
        pull = reconciledPulls.find((value) => value.head.sha === commit);
        if (!pull) throw error;
        reconciled = true;
      }
    }
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
}
