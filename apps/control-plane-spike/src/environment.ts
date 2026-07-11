import type { ApprovalWorkflowParams } from "./contracts.js";

export type Env = {
  SPIKE_API_TOKEN: string;
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  APPROVAL_WORKFLOW: Workflow<ApprovalWorkflowParams>;
};
