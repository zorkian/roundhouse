// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  validateCheckpoint,
  type ArtifactAccess,
  type ArtifactRepository,
  type ArtifactsNamespace,
} from "./artifacts.js";

class FakeRepo implements ArtifactRepository {
  readonly remote: string;
  readonly tokens = new Map<string, ArtifactAccess>();
  head: string;
  constructor(
    readonly name: string,
    readonly base: string,
  ) {
    this.remote = `https://artifacts.invalid/${name}`;
    this.head = base;
  }
  async createToken(access: ArtifactAccess, _ttlSeconds: number) {
    const value = `${access}-${this.tokens.size}`;
    this.tokens.set(value, access);
    return { value, access, expiresAt: 10_000 };
  }
  async revokeToken(value: string) {
    this.tokens.delete(value);
  }
  clone(token: string) {
    const access = this.tokens.get(token);
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
  async importBase(name: string, _upstream: string, baseCommit: string) {
    const existing = this.repos.get(name);
    if (existing) return existing;
    const repo = new FakeRepo(name, baseCommit);
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
  it("covers import, scoped handoff, reconnection, validation, revocation, idempotency, and cleanup", async () => {
    const artifacts = new FakeArtifacts();
    const base = "a".repeat(40),
      head = "b".repeat(40);
    const repo = await artifacts.importBase(
      "v2-run-opaque",
      "https://github.com/zorkian/roundhouse",
      base,
    );
    const writer = await repo.createToken("write", 300);
    const reviewer = await repo.createToken("read", 300);
    expect(writer.access).toBe("write");
    expect(reviewer.access).toBe("read");
    const firstContainer = repo.clone(writer.value);
    expect(firstContainer.head).toBe(base);
    firstContainer.push(head);
    expect(repo.clone(reviewer.value).head).toBe(head);
    const replacementContainer = repo.clone(writer.value);
    expect(replacementContainer.head).toBe(head);
    expect(() => repo.clone(reviewer.value).push("c".repeat(40))).toThrow(
      "read_only_token",
    );
    expect((await artifacts.get(repo.name))?.remote).toBe(repo.remote);
    validateCheckpoint(
      {
        repository: repo.name,
        baseCommit: base,
        acceptedHead: head,
        changedPaths: ["src/fix.ts"],
      },
      {
        repository: repo.name,
        baseCommit: base,
        previousHead: base,
        protectedPaths: [".github/workflows"],
      },
      (ancestor, candidate) => ancestor === base && candidate === head,
    );
    expect(() =>
      validateCheckpoint(
        {
          repository: repo.name,
          baseCommit: base,
          acceptedHead: head,
          changedPaths: [".github/workflows/release.yml"],
        },
        {
          repository: repo.name,
          baseCommit: base,
          previousHead: base,
          protectedPaths: [".github/workflows"],
        },
        () => true,
      ),
    ).toThrow("protected_path_changed");
    expect(await artifacts.importBase(repo.name, "ignored", base)).toBe(repo);
    await repo.revokeToken(writer.value);
    await repo.revokeToken(reviewer.value);
    expect(repo.tokens.size).toBe(0);
    expect(() => repo.clone(writer.value)).toThrow("token_revoked");
    await artifacts.delete(repo.name);
    expect(await artifacts.get(repo.name)).toBeUndefined();
  });
});
