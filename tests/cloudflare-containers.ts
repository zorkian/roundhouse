// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export class Container<Env = unknown> {
  static outboundByHost?: Record<string, unknown>;
  protected readonly env!: Env;
}

export class ContainerProxy {}

export const outboundParams = {};
export function getRandom() {}
export function loadBalance() {}
export function getContainer() {}
export function switchPort() {}
