// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export type DurableAttemptResultStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

/**
 * Retains the final result beside the attempt's named Container Durable Object.
 * A replacement Worker isolate can therefore finish the same logical attempt
 * without invoking the paid operation again after a deployment reset.
 */
export async function durableAttemptResult<T>(
  storage: DurableAttemptResultStorage,
  key: string,
  validate: (value: unknown) => T,
  execute: () => Promise<T>,
): Promise<T> {
  const existing = await storage.get(key);
  if (existing !== undefined) return validate(existing);
  const result = validate(await execute());
  await storage.put(key, result);
  return result;
}
