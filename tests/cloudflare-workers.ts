// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export class DurableObject<Env = unknown> {
  protected readonly ctx: unknown;
  protected readonly env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown, Properties = unknown> {
  protected readonly env!: Env;
  protected readonly ctx!: ExecutionContext<Properties>;
}

export class RpcTarget {}
