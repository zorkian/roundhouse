// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunRepository, RunStage, Wakeup } from "@roundhouse/core";

const encoder = new TextEncoder();
function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export function callbackPayload(
  attemptId: string,
  expectedRevision: number,
  acceptedHead: string,
): string {
  return `${attemptId}\n${expectedRevision}\n${acceptedHead}`;
}
export async function signCallback(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
}
export async function verifyCallback(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const expected = await signCallback(secret, payload);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}
export async function acceptCallback(
  repository: RunRepository,
  secret: string,
  input: {
    attemptId: string;
    expectedRevision: number;
    acceptedHead: string;
    result: Readonly<Record<string, unknown>>;
    signature: string;
  },
): Promise<"completed" | "duplicate" | "stale" | "unauthorized"> {
  const payload = callbackPayload(
    input.attemptId,
    input.expectedRevision,
    input.acceptedHead,
  );
  if (!(await verifyCallback(secret, payload, input.signature)))
    return "unauthorized";
  return repository.completeAttempt(
    input.attemptId,
    input.expectedRevision,
    input.acceptedHead,
    input.result,
  );
}

const nextStage: Partial<Record<RunStage, RunStage>> = {
  qualify: "implement",
  implement: "validate",
  validate: "review",
};

export async function acceptCallbackAndAdvance(
  repository: RunRepository,
  secret: string,
  input: Parameters<typeof acceptCallback>[2],
  enqueue: (wakeup: Wakeup) => Promise<void>,
): Promise<Awaited<ReturnType<typeof acceptCallback>>> {
  const accepted = await acceptCallback(repository, secret, input);
  if (accepted === "unauthorized" || accepted === "stale") return accepted;
  const attempt = await repository.getAttempt(input.attemptId);
  if (!attempt) return "stale";
  const current = await repository.get(attempt.runId);
  if (!current) return "stale";
  if (current.revision === input.expectedRevision + 1) {
    if (current.status === "active")
      await enqueue({ runId: current.id, expectedRevision: current.revision });
    return accepted;
  }
  if (current.revision !== input.expectedRevision) return "stale";
  const stage = nextStage[attempt.stage];
  const next = await repository.transition(
    attempt.runId,
    input.expectedRevision,
    stage
      ? { status: "active", stage }
      : { status: "succeeded", stage: attempt.stage },
  );
  if (!next) {
    const reconciled = await repository.get(attempt.runId);
    if (
      reconciled?.revision === input.expectedRevision + 1 &&
      reconciled.status === "active"
    )
      await enqueue({
        runId: reconciled.id,
        expectedRevision: reconciled.revision,
      });
    return reconciled ? accepted : "stale";
  }
  if (next.status === "active")
    await enqueue({ runId: next.id, expectedRevision: next.revision });
  return accepted;
}
