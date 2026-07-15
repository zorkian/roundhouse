// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const containerControlTimeoutMs = 30_000;

export async function withContainerControlTimeout<T>(
  operation: string,
  action: () => Promise<T>,
  timeoutMs = containerControlTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Container ${operation} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
