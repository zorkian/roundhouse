// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { ResumableCoordinator } from "./resumable-coordinator.js";
import type { SelfDevelopmentRun } from "./task.js";

export const runDeliverySchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  deliveryId: z.string().min(1).max(200),
  expectedRevision: z.number().int().positive(),
});
export type RunDelivery = z.infer<typeof runDeliverySchema>;
export interface DeliveryMessage {
  body: unknown;
  ack(): void;
  retry(): void;
}

export async function consumeRunDelivery(
  message: DeliveryMessage,
  coordinator: ResumableCoordinator,
): Promise<SelfDevelopmentRun | null> {
  const parsed = runDeliverySchema.safeParse(message.body);
  if (!parsed.success) {
    message.ack();
    return null;
  }
  try {
    const run = await coordinator.workRun(
      parsed.data.runId,
      parsed.data.expectedRevision,
    );
    message.ack();
    return run;
  } catch {
    message.retry();
    return null;
  }
}
