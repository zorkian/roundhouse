// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export class AttemptSingleFlight<T> {
  private active?: { attemptId: string; promise: Promise<T> };

  run(attemptId: string, action: () => Promise<T>): Promise<T> {
    if (this.active) {
      if (this.active.attemptId !== attemptId)
        return Promise.reject(
          new Error("Container attempt identity conflicts with active work"),
        );
      return this.active.promise;
    }
    let retained!: Promise<T>;
    retained = Promise.resolve()
      .then(action)
      .catch((error) => {
        if (this.active?.promise === retained) this.active = undefined;
        throw error;
      });
    this.active = { attemptId, promise: retained };
    return retained;
  }
}
