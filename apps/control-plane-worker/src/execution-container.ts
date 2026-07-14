// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container, ContainerProxy } from "@cloudflare/containers";
import {
  repositoryExecutionRequestSchema,
  repositoryExecutionResultSchema,
  independentReviewRequestSchema,
  independentReviewResultSchema,
  planningAgentRequestSchema,
  planningAgentResultSchema,
  trustedImplementationRequestSchema,
  trustedImplementationResultSchema,
  type RepositoryExecutionRequest,
  type RepositoryExecutionResult,
  type IndependentReviewRequest,
  type IndependentReviewResult,
  type PlanningAgentRequest,
  type PlanningAgentResult,
  type TrustedImplementationRequest,
  type TrustedImplementationResult,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";
import {
  allowedCheckoutHosts,
  isCheckoutRequestAllowed,
  modelRequestAuditAccepted,
} from "./execution-egress.js";

const modelHosts = ["chatgpt.com", "auth.openai.com"];
const reviewModelHosts = ["api.anthropic.com"];
const allModelHosts = [...modelHosts, ...reviewModelHosts];
const maximumModelRequestsPerAttempt = 256;

type ObservableRequest = { runId?: string; attemptId: string };

function boundedReason(error: unknown): string {
  return (error instanceof Error ? error.message : "unknown error")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 1_000);
}

function lifecycle(
  level: "info" | "error",
  event: string,
  request: ObservableRequest,
  details: Record<string, unknown> = {},
): void {
  console[level]("Roundhouse Container lifecycle", {
    event,
    runId: request.runId,
    attemptId: request.attemptId,
    occurredAt: new Date().toISOString(),
    ...details,
  });
}

export { ContainerProxy };

async function auditedCheckout(
  request: Request,
  env: ControlPlaneEnv,
  context: { containerId: string; params?: unknown },
): Promise<Response> {
  const url = new URL(request.url);
  if (!isCheckoutRequestAllowed(request))
    return new Response("Forbidden", { status: 403 });
  const params = context.params as { attemptId?: unknown } | undefined;
  const attemptId = params?.attemptId;
  if (typeof attemptId !== "string")
    return new Response("Forbidden", { status: 403 });
  await env.DB.prepare(
    "INSERT INTO execution_egress_events(event_id, attempt_id, container_id, hostname, method, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      attemptId,
      context.containerId,
      url.hostname,
      request.method,
      new Date().toISOString(),
    )
    .run();
  return fetch(request, { redirect: "manual" });
}

async function auditedModelTransport(
  request: Request,
  env: ControlPlaneEnv,
  context: { containerId: string; params?: unknown },
): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !allModelHosts.includes(url.hostname))
    return new Response("Forbidden", { status: 403 });
  const params = context.params as { attemptId?: unknown } | undefined;
  const attemptId = params?.attemptId;
  if (typeof attemptId !== "string")
    return new Response("Forbidden", { status: 403 });
  const inserted = await env.DB.prepare(
    `INSERT INTO execution_egress_events(event_id, attempt_id, container_id, hostname, method, occurred_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM execution_egress_events
            WHERE attempt_id = ? AND hostname IN ('chatgpt.com', 'auth.openai.com', 'api.anthropic.com')) < ?`,
  )
    .bind(
      crypto.randomUUID(),
      attemptId,
      context.containerId,
      url.hostname,
      request.method,
      new Date().toISOString(),
      attemptId,
      maximumModelRequestsPerAttempt,
    )
    .run();
  if (!modelRequestAuditAccepted(inserted.meta.changes))
    return new Response("Model request limit exceeded", { status: 429 });
  return fetch(request, { redirect: "manual" });
}

export class RoundhouseExecutionContainer extends Container<ControlPlaneEnv> {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
  override interceptHttps = true;
  override allowedHosts: string[] = [];

  private async phase<T>(
    request: ObservableRequest,
    phase: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    lifecycle("info", "phase.started", request, { phase });
    try {
      const result = await action();
      lifecycle("info", "phase.completed", request, {
        phase,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      lifecycle("error", "phase.failed", request, {
        phase,
        durationMs: Date.now() - started,
        reason: boundedReason(error),
      });
      throw error;
    }
  }

  private async post(path: string, request: unknown) {
    const response = await this.containerFetch(`http://container${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const text = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        `Container runner ${path} returned non-JSON HTTP ${response.status}`,
      );
    }
    if (!response.ok) {
      const detail =
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
          ? value.error.slice(0, 160)
          : "unknown runner error";
      throw new Error(
        `Container runner ${path} failed with HTTP ${response.status}: ${detail}`,
      );
    }
    return value;
  }

  async runJob(
    input: RepositoryExecutionRequest,
  ): Promise<RepositoryExecutionResult> {
    const request = repositoryExecutionRequestSchema.parse(input);
    const startupStarted = Date.now();
    lifecycle("info", "attempt.started", request, { mode: "profile" });
    try {
      await this.setAllowedHosts(allowedCheckoutHosts);
      await this.setOutboundByHosts({
        "github.com": {
          method: "auditedCheckout",
          params: { attemptId: request.attemptId },
        },
      });
      await this.phase(request, "container.start", () =>
        this.startAndWaitForPorts({
          ports: 8080,
          startOptions: {
            enableInternet: false,
            envVars: {},
            labels: { attemptId: request.attemptId },
          },
          cancellationOptions: {
            instanceGetTimeoutMS: 30_000,
            portReadyTimeoutMS: 60_000,
            waitInterval: 250,
          },
        }),
      );
      const startupDurationMs = Date.now() - startupStarted;
      const prepared = (await this.phase(request, "checkout", () =>
        this.post("/prepare", request),
      )) as {
        checkoutDurationMs?: unknown;
      };
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      const result = repositoryExecutionResultSchema.parse({
        ...((await this.phase(request, "profile.execute", () =>
          this.post("/execute", request),
        )) as object),
        startupDurationMs,
        checkoutDurationMs: prepared.checkoutDurationMs,
      });
      lifecycle("info", "attempt.completed", request, { mode: "profile" });
      return result;
    } finally {
      lifecycle("info", "cleanup.started", request, { mode: "profile" });
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.destroy(),
      ]);
      const failures = cleanup.filter((result) => result.status === "rejected");
      if (failures.length > 0)
        console.warn("Cloudflare Container cleanup was incomplete", {
          attemptId: request.attemptId,
          failures: failures.length,
        });
      lifecycle("info", "cleanup.completed", request, {
        mode: "profile",
        failures: failures.length,
      });
    }
  }

  async runTrustedJob(
    input: TrustedImplementationRequest,
    codexAuthJson: string,
  ): Promise<TrustedImplementationResult> {
    const request = trustedImplementationRequestSchema.parse(input);
    const startupStarted = Date.now();
    lifecycle("info", "attempt.started", request, { mode: "trusted-agent" });
    try {
      await this.setAllowedHosts(allowedCheckoutHosts);
      await this.setOutboundByHosts({
        "github.com": {
          method: "auditedCheckout",
          params: { attemptId: request.attemptId },
        },
      });
      await this.phase(request, "container.start", () =>
        this.startAndWaitForPorts({
          ports: 8080,
          startOptions: {
            enableInternet: false,
            envVars: {},
            labels: { attemptId: request.attemptId, mode: "trusted-agent" },
          },
          cancellationOptions: {
            instanceGetTimeoutMS: 30_000,
            portReadyTimeoutMS: 60_000,
            waitInterval: 250,
          },
        }),
      );
      const startupDurationMs = Date.now() - startupStarted;
      const prepared = (await this.phase(request, "checkout", () =>
        this.post("/trusted/prepare", request),
      )) as {
        checkoutDurationMs?: unknown;
      };
      await this.setAllowedHosts(modelHosts);
      await this.setOutboundByHosts(
        Object.fromEntries(
          modelHosts.map((host) => [
            host,
            {
              method: "auditedModelTransport",
              params: { attemptId: request.attemptId },
            },
          ]),
        ),
      );
      await this.phase(request, "credential.install", () =>
        this.post("/trusted/credential", {
          request,
          authJson: codexAuthJson,
        }),
      );
      await this.phase(request, "agent.implement", () =>
        this.post("/trusted/implement", request),
      );
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      const result = trustedImplementationResultSchema.parse({
        ...((await this.phase(request, "validation", () =>
          this.post("/trusted/validate", request),
        )) as object),
        startupDurationMs,
        checkoutDurationMs: prepared.checkoutDurationMs,
      });
      lifecycle("info", "attempt.completed", request, {
        mode: "trusted-agent",
        validationOutcome: result.validationOutcome,
        patchBytes: result.patchBytes,
        changedFiles: result.changedFiles.length,
      });
      return result;
    } finally {
      lifecycle("info", "cleanup.started", request, {
        mode: "trusted-agent",
      });
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.destroy(),
      ]);
      const failures = cleanup.filter((result) => result.status === "rejected");
      if (failures.length > 0)
        console.warn("Trusted Container cleanup was incomplete", {
          attemptId: request.attemptId,
          failures: failures.length,
        });
      lifecycle("info", "cleanup.completed", request, {
        mode: "trusted-agent",
        failures: failures.length,
      });
    }
  }

  async runPlanningJob(
    input: PlanningAgentRequest,
    codexAuthJson: string,
  ): Promise<PlanningAgentResult> {
    const request = planningAgentRequestSchema.parse(input);
    lifecycle("info", "attempt.started", request, { mode: "planning-agent" });
    try {
      await this.setAllowedHosts(allowedCheckoutHosts);
      await this.setOutboundByHosts({
        "github.com": {
          method: "auditedCheckout",
          params: { attemptId: request.attemptId },
        },
      });
      await this.phase(request, "container.start", () =>
        this.startAndWaitForPorts({
          ports: 8080,
          startOptions: {
            enableInternet: false,
            envVars: {},
            labels: { attemptId: request.attemptId, mode: "planning-agent" },
          },
          cancellationOptions: {
            instanceGetTimeoutMS: 30_000,
            portReadyTimeoutMS: 60_000,
            waitInterval: 250,
          },
        }),
      );
      await this.phase(request, "checkout", () =>
        this.post("/planning/prepare", request),
      );
      await this.setAllowedHosts(modelHosts);
      await this.setOutboundByHosts(
        Object.fromEntries(
          modelHosts.map((host) => [
            host,
            {
              method: "auditedModelTransport",
              params: { attemptId: request.attemptId },
            },
          ]),
        ),
      );
      await this.phase(request, "credential.install", () =>
        this.post("/planning/credential", {
          request,
          authJson: codexAuthJson,
        }),
      );
      const result = planningAgentResultSchema.parse(
        await this.phase(request, "agent.plan", () =>
          this.post("/planning/run", request),
        ),
      );
      lifecycle("info", "attempt.completed", request, {
        mode: "planning-agent",
        status: result.status,
      });
      return result;
    } finally {
      lifecycle("info", "cleanup.started", request, {
        mode: "planning-agent",
      });
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.destroy(),
      ]);
      if (cleanup.some((result) => result.status === "rejected"))
        console.warn("Planning Container cleanup was incomplete", {
          attemptId: request.attemptId,
        });
      lifecycle("info", "cleanup.completed", request, {
        mode: "planning-agent",
        failures: cleanup.filter((result) => result.status === "rejected")
          .length,
      });
    }
  }

  async runReviewJob(
    input: IndependentReviewRequest,
    claudeAuthJson: string,
  ): Promise<IndependentReviewResult> {
    const request = independentReviewRequestSchema.parse(input);
    const startupStarted = Date.now();
    lifecycle("info", "attempt.started", request, {
      mode: "independent-review",
    });
    try {
      await this.setAllowedHosts(allowedCheckoutHosts);
      await this.setOutboundByHosts({
        "github.com": {
          method: "auditedCheckout",
          params: { attemptId: request.attemptId },
        },
      });
      await this.phase(request, "container.start", () =>
        this.startAndWaitForPorts({
          ports: 8080,
          startOptions: {
            enableInternet: false,
            envVars: {},
            labels: {
              attemptId: request.attemptId,
              mode: "independent-review",
            },
          },
          cancellationOptions: {
            instanceGetTimeoutMS: 30_000,
            portReadyTimeoutMS: 60_000,
            waitInterval: 250,
          },
        }),
      );
      const startupDurationMs = Date.now() - startupStarted;
      await this.phase(request, "checkout", () =>
        this.post("/review/prepare", request),
      );
      await this.setAllowedHosts(reviewModelHosts);
      await this.setOutboundByHosts({
        "api.anthropic.com": {
          method: "auditedModelTransport",
          params: { attemptId: request.attemptId },
        },
      });
      await this.phase(request, "credential.install", () =>
        this.post("/review/credential", {
          request,
          authJson: claudeAuthJson,
        }),
      );
      await this.phase(request, "agent.review", () =>
        this.post("/review/run", request),
      );
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      const result = independentReviewResultSchema.parse({
        ...((await this.phase(request, "review.finalize", () =>
          this.post("/review/result", request),
        )) as object),
        startupDurationMs,
      });
      lifecycle("info", "attempt.completed", request, {
        mode: "independent-review",
        findings: result.findings.length,
      });
      return result;
    } finally {
      lifecycle("info", "cleanup.started", request, {
        mode: "independent-review",
      });
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.destroy(),
      ]);
      const failures = cleanup.filter((result) => result.status === "rejected");
      if (failures.length > 0)
        console.warn("Independent review Container cleanup was incomplete", {
          attemptId: request.attemptId,
          failures: failures.length,
        });
      lifecycle("info", "cleanup.completed", request, {
        mode: "independent-review",
        failures: failures.length,
      });
    }
  }
}

RoundhouseExecutionContainer.outboundHandlers = {
  auditedCheckout,
  auditedModelTransport,
};
