// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  artifactIdentity,
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
  validateReadOnlyCheckpoint,
  type ArtifactAccess,
  type ArtifactRepository,
  type ArtifactsNamespace,
} from "./artifacts.js";

it("accepts only unchanged checkpoints from read-only attempts", () => {
  const checkpoint = {
    repositoryId: "artifact-repo-id",
    repository: "v2-run-1",
    baseCommit: "a".repeat(40),
    inputHead: "b".repeat(40),
    outputHead: "b".repeat(40),
    ref: "refs/heads/roundhouse/run-1",
    changedPaths: [],
  };

  expect(() => validateReadOnlyCheckpoint(checkpoint)).not.toThrow();
  expect(() =>
    validateReadOnlyCheckpoint({
      ...checkpoint,
      outputHead: "c".repeat(40),
    }),
  ).toThrow("read_only_head_changed");
  expect(() =>
    validateReadOnlyCheckpoint({
      ...checkpoint,
      changedPaths: ["README.md"],
    }),
  ).toThrow("read_only_paths_changed");
});

class FakeRepo implements ArtifactRepository {
  readonly id: string;
  readonly remote: string;
  readonly hostname: string;
  readonly empty = false;
  readonly tokens = new Map<string, ArtifactAccess>();
  head: string;
  constructor(
    readonly name: string,
    readonly base: string,
  ) {
    this.id = `repo-${name}`;
    this.remote = `https://artifacts.invalid/${name}`;
    this.hostname = "artifacts.invalid";
    this.head = base;
  }
  async createToken(access: ArtifactAccess, _ttlSeconds: number) {
    const id = `token-${this.tokens.size}`;
    this.tokens.set(id, access);
    return { id, plaintext: `secret-${id}`, access, expiresAt: 10_000 };
  }
  async revokeToken(id: string) {
    this.tokens.delete(id);
  }
  async revokeActiveTokens() {
    this.tokens.clear();
  }
  clone(token: string) {
    const id = token.replace("secret-", "");
    const access = this.tokens.get(id);
    if (!access) throw new Error("token_revoked");
    const repository = this;
    return {
      access,
      head: repository.head,
      push(nextHead: string) {
        if (access !== "write") throw new Error("read_only_token");
        repository.head = nextHead;
        this.head = nextHead;
      },
    };
  }
}

class FakeArtifacts implements ArtifactsNamespace {
  readonly repos = new Map<string, FakeRepo>();
  async ensure(name: string) {
    const existing = this.repos.get(name);
    if (existing) return existing;
    const repo = new FakeRepo(name, "a".repeat(40));
    this.repos.set(name, repo);
    return repo;
  }
  async get(name: string) {
    return this.repos.get(name);
  }
  async delete(name: string) {
    this.repos.delete(name);
  }
}

describe("Artifacts workspace contract", () => {
  it("creates an empty workspace and revokes its initial secret", async () => {
    let createInput:
      { name: string; opts?: Parameters<Artifacts["create"]>[1] } | undefined;
    let revoked: string | undefined;
    let created = false;
    const repo = {
      lastPushAt: null,
      revokeToken: async (token: string) => {
        revoked = token;
        return true;
      },
    } as unknown as ArtifactsRepo;
    const binding = {
      get: async () => {
        if (!created)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return repo;
      },
      create: async (
        name: string,
        opts?: Parameters<Artifacts["create"]>[1],
      ) => {
        createInput = { name, opts };
        created = true;
        return { token: "bootstrap" };
      },
    } as unknown as Artifacts;
    const workspace = await new CloudflareArtifactsNamespace(binding, {
      namespace: "development",
      remoteOrigin: "https://account.artifacts.cloudflare.net",
    }).ensure("run_1");
    expect(createInput).toEqual({
      name: "run_1",
      opts: {
        description: "Roundhouse V2 run workspace",
        setDefaultBranch: "main",
      },
    });
    expect(revoked).toBe("bootstrap");
    expect(workspace.empty).toBe(true);
  });

  it("derives one stable repository identity from its configured namespace", () => {
    expect(
      artifactIdentity("run_1", {
        namespace: "roundhouse-v2-development",
        remoteOrigin: "https://account.artifacts.cloudflare.net",
      }),
    ).toEqual({
      id: "artifacts:roundhouse-v2-development/run_1",
      name: "run_1",
      remote:
        "https://account.artifacts.cloudflare.net/git/roundhouse-v2-development/run_1.git",
      hostname: "account.artifacts.cloudflare.net",
    });
  });

  it("covers scoped handoff, replacement, validation, revocation, and cleanup", async () => {
    const artifacts = new FakeArtifacts();
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const repo = await artifacts.ensure("v2-run-opaque");
    const writer = await repo.createToken("write", 300);
    const reviewer = await repo.createToken("read", 300);
    expect(repo.hostname).toBe("artifacts.invalid");
    const first = (repo as FakeRepo).clone(writer.plaintext);
    expect(first.head).toBe(base);
    first.push(head);
    expect((repo as FakeRepo).clone(reviewer.plaintext).head).toBe(head);
    expect((repo as FakeRepo).clone(writer.plaintext).head).toBe(head);
    expect(() =>
      (repo as FakeRepo).clone(reviewer.plaintext).push("c".repeat(40)),
    ).toThrow("read_only_token");
    validateCheckpointIdentity(
      {
        repositoryId: repo.id,
        repository: repo.name,
        baseCommit: base,
        inputHead: base,
        outputHead: head,
        ref: "refs/heads/roundhouse/run",
        changedPaths: ["src/fix.ts"],
      },
      {
        repositoryId: repo.id,
        repository: repo.name,
        baseCommit: base,
        inputHead: base,
        ref: "refs/heads/roundhouse/run",
        protectedPaths: [".github/workflows"],
      },
    );
    expect(() =>
      validateCheckpointIdentity(
        {
          repositoryId: repo.id,
          repository: repo.name,
          baseCommit: base,
          inputHead: base,
          outputHead: head,
          ref: "refs/heads/roundhouse/run",
          changedPaths: [".github/workflows/release.yml"],
        },
        {
          repositoryId: repo.id,
          repository: repo.name,
          baseCommit: base,
          inputHead: base,
          ref: "refs/heads/roundhouse/run",
          protectedPaths: [".github/workflows"],
        },
      ),
    ).toThrow("protected_path_changed");
    expect(await artifacts.ensure(repo.name)).toBe(repo);
    await repo.revokeToken(writer.id);
    await repo.revokeToken(reviewer.id);
    expect((repo as FakeRepo).tokens.size).toBe(0);
    expect(() => (repo as FakeRepo).clone(writer.plaintext)).toThrow(
      "token_revoked",
    );
    await artifacts.delete(repo.name);
    expect(await artifacts.get(repo.name)).toBeUndefined();
  });
});
