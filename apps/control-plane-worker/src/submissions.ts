// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  D1DatabasePort,
  SelfDevelopmentTask,
} from "@roundhouse/self-development";

type SubmissionRow = {
  idempotency_key: string;
  request_hash: string;
  run_id: string;
  delivery_id: string;
  delivery_state: "pending" | "sent";
};

export const controlPlaneSubmissionMigration = `
CREATE TABLE IF NOT EXISTS control_plane_submissions (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  delivery_id TEXT NOT NULL,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'sent')),
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
`;

export class IdempotencyConflictError extends Error {}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function submissionIdentity(
  key: string,
  task: SelfDevelopmentTask,
): Promise<{ requestHash: string; runId: string; deliveryId: string }> {
  const requestHash = await digest(JSON.stringify(task));
  const keyHash = await digest(key);
  return {
    requestHash,
    runId: `run_${keyHash.slice(0, 40)}`,
    deliveryId: `delivery_${keyHash.slice(0, 40)}`,
  };
}

export async function reserveSubmission(
  db: D1DatabasePort,
  key: string,
  task: SelfDevelopmentTask,
  now: Date,
): Promise<{ row: SubmissionRow; created: boolean }> {
  const identity = await submissionIdentity(key, task);
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO control_plane_submissions(idempotency_key, request_hash, run_id, delivery_id, delivery_state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    )
    .bind(
      key,
      identity.requestHash,
      identity.runId,
      identity.deliveryId,
      now.toISOString(),
    )
    .run();
  const row = await db
    .prepare(
      "SELECT * FROM control_plane_submissions WHERE idempotency_key = ?",
    )
    .bind(key)
    .first<SubmissionRow>();
  if (!row) throw new Error("Submission reservation was not readable");
  if (row.request_hash !== identity.requestHash)
    throw new IdempotencyConflictError();
  return { row, created: (inserted.meta.changes ?? 0) === 1 };
}

export async function markDelivered(
  db: D1DatabasePort,
  key: string,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      "UPDATE control_plane_submissions SET delivery_state = 'sent', delivered_at = ? WHERE idempotency_key = ?",
    )
    .bind(now.toISOString(), key)
    .run();
}
