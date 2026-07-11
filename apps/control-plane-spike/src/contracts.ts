import { z } from "zod";

export const startRunSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  subject: z.string().min(1).max(500),
  planRevision: z.number().int().positive(),
});

export const approvalSchema = z.object({
  actorId: z.string().min(1).max(200),
  planRevision: z.number().int().positive(),
});

export type StartRunInput = z.infer<typeof startRunSchema>;
export type ApprovalInput = z.infer<typeof approvalSchema>;

export type ApprovalWorkflowParams = {
  runId: string;
  subject: string;
  planRevision: number;
};

export const approvalEventSchema = z.object({
  approvalId: z.string().min(1),
  actorId: z.string().min(1),
  planRevision: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

export type ApprovalEvent = z.infer<typeof approvalEventSchema>;
