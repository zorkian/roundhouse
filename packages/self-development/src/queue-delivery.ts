// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ResumableCoordinator } from "./resumable-coordinator.js";

export type RunDelivery = {
  schemaVersion: 1;
  runId: string;
  deliveryId: string;
  expectedRevision: number;
};
export interface DeliveryMessage {
  body: RunDelivery;
  ack(): void;
  retry(): void;
}

export async function consumeRunDelivery(
  message: DeliveryMessage,
  coordinator: ResumableCoordinator,
): Promise<void> {
  try {
    await coordinator.workRun(
      message.body.runId,
      message.body.expectedRevision,
    );
    message.ack();
  } catch {
    message.retry();
  }
}
