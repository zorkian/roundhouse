// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export type ArtifactAccess = "read" | "write";
export interface ArtifactToken {
  readonly value: string;
  readonly access: ArtifactAccess;
  readonly expiresAt: number;
}
export interface ArtifactRepository {
  readonly name: string;
  readonly remote: string;
  createToken(
    access: ArtifactAccess,
    ttlSeconds: number,
  ): Promise<ArtifactToken>;
  revokeToken(value: string): Promise<void>;
}
export interface ArtifactsNamespace {
  importBase(
    name: string,
    upstream: string,
    baseCommit: string,
  ): Promise<ArtifactRepository>;
  get(name: string): Promise<ArtifactRepository | undefined>;
  delete(name: string): Promise<void>;
}
export interface Checkpoint {
  readonly repository: string;
  readonly baseCommit: string;
  readonly acceptedHead: string;
  readonly changedPaths: readonly string[];
}

export function validateCheckpoint(
  checkpoint: Checkpoint,
  expected: {
    repository: string;
    baseCommit: string;
    previousHead: string;
    protectedPaths: readonly string[];
  },
  isAncestor: (ancestor: string, head: string) => boolean,
): void {
  if (checkpoint.repository !== expected.repository)
    throw new Error("unexpected_repository");
  if (checkpoint.baseCommit !== expected.baseCommit)
    throw new Error("unexpected_base");
  if (!isAncestor(expected.previousHead, checkpoint.acceptedHead))
    throw new Error("unexpected_ancestry");
  if (
    checkpoint.changedPaths.some((path) =>
      expected.protectedPaths.some(
        (protectedPath) =>
          path === protectedPath || path.startsWith(`${protectedPath}/`),
      ),
    )
  )
    throw new Error("protected_path_changed");
}
