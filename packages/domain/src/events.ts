// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import { idSchema } from "./ids.js";

export const eventActorSchema = z.object({
  type: z.enum(["human", "github", "system", "agent"]),
  id: z.string().min(1),
});

export const eventEnvelopeSchema = <T extends z.ZodType>(payload: T) =>
  z.object({
    id: idSchema("event"),
    type: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    installationId: z.string().min(1),
    repositoryId: idSchema("repository"),
    workItemId: idSchema("workItem").optional(),
    runId: idSchema("run").optional(),
    stageId: idSchema("stage").optional(),
    attemptId: idSchema("attempt").optional(),
    actor: eventActorSchema,
    correlationId: idSchema("correlation"),
    causationId: idSchema("event").optional(),
    payload,
    rawArtifactId: idSchema("artifact").optional(),
  });

export type EventEnvelope<T> = z.infer<
  ReturnType<typeof eventEnvelopeSchema<z.ZodType<T>>>
>;
