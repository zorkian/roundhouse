import { z } from "zod";

export const workItemStates = [
  "new",
  "qualifying",
  "needs_information",
  "awaiting_reporter",
  "reproducing",
  "reproduced",
  "not_reproduced",
  "human_triage_required",
  "planning",
  "awaiting_plan_approval",
  "implementing",
  "validating_local",
  "reviewing",
  "revising",
  "publishing_pr",
  "awaiting_ci",
  "awaiting_human_merge",
  "completed",
  "rejected",
  "cancelled",
  "failed",
  "budget_exhausted",
  "policy_blocked",
] as const;

export const workItemStateSchema = z.enum(workItemStates);
export type WorkItemState = z.infer<typeof workItemStateSchema>;
