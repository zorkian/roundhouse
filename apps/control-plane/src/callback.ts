// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunRepository } from "@roundhouse/core";
import type { Checkpoint } from "./artifacts.js";

export interface AttemptCallback {
  readonly attemptId: string;
  readonly expectedRevision: number;
  readonly checkpoint: Checkpoint;
  readonly artifactTokenId: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly signature: string;
}

export interface CheckpointValidator {
  validate(input: AttemptCallback): Promise<void>;
}

const encoder = new TextEncoder();
function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stable(child)]),
    );
  return value;
}

export function callbackPayload(input: Omit<AttemptCallback, "signature">) {
  return JSON.stringify(stable(input));
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
  validator: CheckpointValidator,
  input: AttemptCallback,
): Promise<"completed" | "duplicate" | "stale" | "unauthorized"> {
  const { signature, ...unsigned } = input;
  if (!(await verifyCallback(secret, callbackPayload(unsigned), signature)))
    return "unauthorized";
  const attempt = await repository.getAttempt(input.attemptId);
  if (!attempt || attempt.runRevision !== input.expectedRevision)
    return "stale";
  if (attempt.state === "completed") return "duplicate";
  await validator.validate(input);
  return repository.completeAttempt(
    input.attemptId,
    input.expectedRevision,
    input.checkpoint.outputHead,
    input.result,
  );
}
