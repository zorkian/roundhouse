// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { newId } from "@roundhouse/domain";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  approvalEventSchema,
  type ApprovalWorkflowParams,
} from "./contracts.js";
import { sha256 } from "./crypto.js";
import type { Env } from "./environment.js";

export class ApprovalWorkflow extends WorkflowEntrypoint<
  Env,
  ApprovalWorkflowParams
> {
  override async run(
    event: WorkflowEvent<ApprovalWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ artifactId: string }> {
    const params = event.payload;

    await step.do("mark awaiting approval", async () => {
      const now = new Date().toISOString();
      await this.env.DB.batch([
        this.env.DB.prepare(
          "UPDATE runs SET state = 'awaiting_plan_approval', updated_at = ?1 WHERE id = ?2",
        ).bind(now, params.runId),
        this.env.DB.prepare(
          `INSERT INTO events
            (id, run_id, type, schema_version, actor_type, actor_id, occurred_at, payload_json)
           VALUES (?1, ?2, 'run.awaiting_plan_approval', 1, 'system', 'approval-workflow', ?3, ?4)`,
        ).bind(
          newId("event"),
          params.runId,
          now,
          JSON.stringify({ planRevision: params.planRevision }),
        ),
      ]);
    });

    const rawApproval = await step.waitForEvent("wait for plan approval", {
      type: "plan_approved",
      timeout: "7 days",
    });
    const approval = approvalEventSchema.parse(rawApproval.payload);
    if (approval.planRevision !== params.planRevision) {
      throw new NonRetryableError(
        "Approval does not match the workflow plan revision",
      );
    }

    const prepared = await step.do("prepare approval artifact", async () => {
      const artifactId = newId("artifact");
      const body = JSON.stringify({
        schemaVersion: 1,
        runId: params.runId,
        subject: params.subject,
        planRevision: params.planRevision,
        approval,
      });
      const encoded = new TextEncoder().encode(body);
      const digest = await sha256(encoded);
      return { artifactId, body, sha256: digest.hex, size: encoded.byteLength };
    });

    const r2Key = `runs/${params.runId}/artifacts/${prepared.artifactId}.json`;
    await step.do("store approval artifact", async () => {
      await this.env.ARTIFACTS.put(r2Key, prepared.body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          runId: params.runId,
          artifactId: prepared.artifactId,
          sha256: prepared.sha256,
        },
      });
    });

    await step.do("complete run", async () => {
      const now = new Date().toISOString();
      await this.env.DB.batch([
        this.env.DB.prepare(
          "UPDATE runs SET state = 'completed', updated_at = ?1, completed_at = ?1 WHERE id = ?2",
        ).bind(now, params.runId),
        this.env.DB.prepare(
          `INSERT INTO artifacts
            (id, run_id, kind, r2_key, sha256, size_bytes, content_type, created_at)
           VALUES (?1, ?2, 'approval', ?3, ?4, ?5, 'application/json', ?6)`,
        ).bind(
          prepared.artifactId,
          params.runId,
          r2Key,
          prepared.sha256,
          prepared.size,
          now,
        ),
        this.env.DB.prepare(
          `INSERT INTO events
            (id, run_id, type, schema_version, actor_type, actor_id, occurred_at, payload_json)
           VALUES (?1, ?2, 'run.completed', 1, 'system', 'approval-workflow', ?3, ?4)`,
        ).bind(
          newId("event"),
          params.runId,
          now,
          JSON.stringify({ artifactId: prepared.artifactId }),
        ),
      ]);
    });

    return { artifactId: prepared.artifactId };
  }
}
