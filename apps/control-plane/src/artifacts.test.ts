// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  validateCheckpointIdentity,
  type ArtifactAccess,
  type ArtifactRepository,
  type ArtifactsNamespace,
} from "./artifacts.js";

class FakeRepo implements ArtifactRepository {
  readonly id: string;
  readonly remote: string;
  readonly hostname: string;
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
  async importBase(name: string, _upstream: string) {
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
  it("covers scoped handoff, replacement, validation, revocation, and cleanup", async () => {
    const artifacts = new FakeArtifacts();
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const repo = await artifacts.importBase(
      "v2-run-opaque",
      "https://github.invalid/repo",
    );
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
    expect(await artifacts.importBase(repo.name, "ignored")).toBe(repo);
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
