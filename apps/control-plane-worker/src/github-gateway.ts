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
};

type GitHubResponse<T> = { status: number; value: T };

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

function safeGitHubError(status: number): Error {
  return new Error(`GitHub API request failed with status ${status}`);
}

export class GitHubAppGateway {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: GatewayConfig,
    private readonly fetcher: Fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async appJwt(): Promise<string> {
    const now = Math.floor(this.now().getTime() / 1_000);
    const key = await importPKCS8(this.config.privateKey, "RS256");
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.config.appId)
      .setIssuedAt(now - 30)
      .setExpirationTime(now + 540)
      .sign(key);
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
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token ?? (await this.installationToken())}`,
        "content-type": "application/json",
        "user-agent": "roundhouse-dev-control-plane",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = (await response.json()) as T;
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
    if (issue.pull_request) throw new Error("GitHub reference is not an issue");
    const body = issue.body ?? "";
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
  }

  async mainHead(): Promise<string> {
    return (
      await this.api<{ object: { sha: string } }>(
        "GET",
        "/repos/zorkian/roundhouse/git/ref/heads/main",
      )
    ).value.object.sha;
  }

  private async existingRef(branch: string): Promise<string | null> {
    const response = await this.fetcher(
      `https://api.github.com/repos/zorkian/roundhouse/git/ref/heads/${encodeURIComponent(branch)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${await this.installationToken()}`,
          "user-agent": "roundhouse-dev-control-plane",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw safeGitHubError(response.status);
    const value = (await response.json()) as { object: { sha: string } };
    return value.object.sha;
  }

  async publish(input: {
    manifest: TrustedPublicationManifest;
    branch: string;
    commitMessage: string;
    pullRequestTitle: string;
    issueNumber: number;
    approvedAt: string;
  }): Promise<GitHubPublicationResult> {
    const manifest = trustedPublicationManifestSchema.parse(input.manifest);
    const baseCommit = (
      await this.api<{ tree: { sha: string } }>(
        "GET",
        `/repos/zorkian/roundhouse/git/commits/${manifest.baseCommit}`,
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
          "/repos/zorkian/roundhouse/git/blobs",
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
        "/repos/zorkian/roundhouse/git/trees",
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
        "/repos/zorkian/roundhouse/git/commits",
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
    if (existing !== null && existing !== commit)
      throw new Error("Publication branch already exists at another commit");
    if (existing === null) {
      try {
        await this.api("POST", "/repos/zorkian/roundhouse/git/refs", {
          ref: `refs/heads/${input.branch}`,
          sha: commit,
        });
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
        `/repos/zorkian/roundhouse/pulls?state=all&head=zorkian:${encodeURIComponent(input.branch)}`,
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
          }>("POST", "/repos/zorkian/roundhouse/pulls", {
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
            `/repos/zorkian/roundhouse/pulls?state=all&head=zorkian:${encodeURIComponent(input.branch)}`,
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
      }>("GET", `/repos/zorkian/roundhouse/git/commits/${commit}`)
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
      repository: "zorkian/roundhouse",
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
