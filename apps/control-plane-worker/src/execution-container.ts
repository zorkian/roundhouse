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
import { AttemptSingleFlight } from "./attempt-single-flight.js";
import { durableAttemptResult } from "./durable-attempt-result.js";
import {
  allowedCheckoutHosts,
  isCheckoutRequestAllowed,
  modelRequestAuditAccepted,
} from "./execution-egress.js";
import { recordExecutionPhase } from "./execution-progress.js";
import { validateIndependentReviewResult } from "./review-result-validation.js";
import { withContainerControlTimeout } from "./execution-control.js";
import {
  isValidAgentOutputTail,
  type AgentOutputRequest,
  type AgentOutputTail,
} from "./cloudflare-execution.js";

const modelHosts = ["chatgpt.com", "auth.openai.com"];
const reviewModelHosts = ["api.anthropic.com"];
const allModelHosts = [...modelHosts, ...reviewModelHosts];
const maximumModelRequestsPerAttempt = 256;

type ObservableRequest = { runId?: string; attemptId: string };

function validateRepositoryResult(
  request: RepositoryExecutionRequest,
  value: unknown,
): RepositoryExecutionResult {
  const result = repositoryExecutionResultSchema.parse(value);
  if (
    result.runId !== request.runId ||
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit ||
    result.checkoutCommit !== request.baseCommit
  )
    throw new Error("Durable repository result binding mismatch");
  return result;
}

function validateTrustedResult(
  request: TrustedImplementationRequest,
  value: unknown,
): TrustedImplementationResult {
  const result = trustedImplementationResultSchema.parse(value);
  if (
    result.runId !== request.runId ||
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit ||
    result.checkoutCommit !== request.baseCommit
  )
    throw new Error("Durable trusted result binding mismatch");
  return result;
}

function validatePlanningResult(
  request: PlanningAgentRequest,
  value: unknown,
): PlanningAgentResult {
  const result = planningAgentResultSchema.parse(value);
  if (
    result.attemptId !== request.attemptId ||
    result.baseCommit !== request.baseCommit
  )
    throw new Error("Durable planning result binding mismatch");
  return result;
}

function boundedReason(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : "Error")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\/(?:[^\s/:]+\/)+[^\s:]+/g, "[path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 240);
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
  // Every backend names this Durable Object by the exact attemptId. Successful
  // results are also retained in Durable Object storage so a Worker rollout can
  // reconnect after the Container RPC that produced them has returned.
  private readonly profileAttempts =
    new AttemptSingleFlight<RepositoryExecutionResult>();
  private readonly trustedAttempts =
    new AttemptSingleFlight<TrustedImplementationResult>();
  private readonly planningAttempts =
    new AttemptSingleFlight<PlanningAgentResult>();
  private readonly reviewAttempts =
    new AttemptSingleFlight<IndependentReviewResult>();

  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = false;
  override interceptHttps = true;
  override allowedHosts: string[] = [];

  async readAgentOutput(input: AgentOutputRequest): Promise<AgentOutputTail> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.attemptId))
      throw new Error("Invalid agent-output attempt identity");
    if (
      input.cursor !== undefined &&
      (!Number.isSafeInteger(input.cursor) || input.cursor < 0)
    )
      throw new Error("Invalid agent-output cursor");
    const query = new URLSearchParams({ attemptId: input.attemptId });
    if (input.cursor !== undefined)
      query.set("cursor", input.cursor.toString());
    const response = await this.containerFetch(
      `http://container/agent-output?${query.toString()}`,
    );
    if (!response.ok)
      throw new Error(`Agent output unavailable: HTTP ${response.status}`);
    const value = (await response.json()) as Partial<AgentOutputTail>;
    if (!isValidAgentOutputTail(value, input))
      throw new Error("Agent output binding mismatch");
    return value;
  }

  override onStop({
    exitCode,
    reason,
  }: {
    exitCode: number;
    reason: "exit" | "runtime_signal";
  }): void {
    console.info("Roundhouse Container lifecycle", {
      event: "container.stopped",
      exitCode,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }

  override onError(error: unknown): void {
    console.error("Roundhouse Container lifecycle", {
      event: "container.error",
      reason: boundedReason(error),
      occurredAt: new Date().toISOString(),
    });
    throw error;
  }

  async releaseCanary(expectedCommit: string): Promise<{
    schemaVersion: 1;
    ok: true;
    releaseCommit: string;
  }> {
    if (!/^[a-f0-9]{40}$/.test(expectedCommit))
      throw new Error("Invalid release canary commit");
    const request = { attemptId: `release_canary_${expectedCommit}` };
    lifecycle("info", "release-canary.started", request);
    try {
      await this.startAndWaitForPorts({
        ports: 8080,
        startOptions: {
          enableInternet: false,
          envVars: {},
          labels: { releaseCommit: expectedCommit, mode: "release-canary" },
        },
        cancellationOptions: {
          instanceGetTimeoutMS: 30_000,
          portReadyTimeoutMS: 90_000,
          waitInterval: 250,
        },
      });
      const response = await this.containerFetch("http://container/ping");
      const value = (await response.json()) as {
        schemaVersion?: unknown;
        ok?: unknown;
        releaseCommit?: unknown;
      };
      if (
        !response.ok ||
        value.schemaVersion !== 1 ||
        value.ok !== true ||
        value.releaseCommit !== expectedCommit
      )
        throw new Error("Container release canary identity mismatch");
      lifecycle("info", "release-canary.completed", request);
      return {
        schemaVersion: 1,
        ok: true,
        releaseCommit: expectedCommit,
      };
    } finally {
      await this.stop();
    }
  }

  private async phase<T>(
    request: ObservableRequest,
    phase: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    lifecycle("info", "phase.started", request, { phase });
    await this.observePhase(request, phase, "running", {});
    try {
      const result = await action();
      await this.observePhase(request, phase, "completed", {
        durationMs: Date.now() - started,
      });
      lifecycle("info", "phase.completed", request, {
        phase,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      await this.observePhase(request, phase, "failed", {
        durationMs: Date.now() - started,
      });
      lifecycle("error", "phase.failed", request, {
        phase,
        durationMs: Date.now() - started,
        reason: boundedReason(error),
      });
      throw error;
    }
  }

  private async observePhase(
    request: ObservableRequest,
    phase: string,
    status: "running" | "completed" | "failed",
    detail: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!request.runId) return;
    try {
      await recordExecutionPhase(this.env, {
        runId: request.runId,
        attemptId: request.attemptId,
        phase,
        status,
        occurredAt: new Date().toISOString(),
        detail,
      });
    } catch (error) {
      console.warn("Container progress recording was deferred", {
        runId: request.runId,
        attemptId: request.attemptId,
        phase,
        reason: boundedReason(error),
      });
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
    return this.profileAttempts.run(request.attemptId, () =>
      durableAttemptResult(
        this.ctx.storage,
        "attempt-result:profile:v1",
        (value) => validateRepositoryResult(request, value),
        () => this.executeJob(request),
      ),
    );
  }

  private async executeJob(
    request: RepositoryExecutionRequest,
  ): Promise<RepositoryExecutionResult> {
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
      const result = await this.phase(request, "profile.execute", async () =>
        repositoryExecutionResultSchema.parse({
          ...((await this.post("/execute", request)) as object),
          startupDurationMs,
          checkoutDurationMs: prepared.checkoutDurationMs,
        }),
      );
      lifecycle("info", "attempt.completed", request, { mode: "profile" });
      return result;
    } finally {
      lifecycle("info", "cleanup.started", request, { mode: "profile" });
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.stop(),
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
    return this.trustedAttempts.run(request.attemptId, () =>
      durableAttemptResult(
        this.ctx.storage,
        "attempt-result:trusted:v1",
        (value) => validateTrustedResult(request, value),
        () => this.executeTrustedJob(request, codexAuthJson),
      ),
    );
  }

  private async executeTrustedJob(
    request: TrustedImplementationRequest,
    codexAuthJson: string,
  ): Promise<TrustedImplementationResult> {
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
      await this.phase(request, "network.revoke", async () => {
        await withContainerControlTimeout("outbound revocation", () =>
          this.setOutboundByHosts({}),
        );
        await withContainerControlTimeout("allowlist revocation", () =>
          this.setAllowedHosts([]),
        );
      });
      const result = await this.phase(request, "validation", async () =>
        trustedImplementationResultSchema.parse({
          ...((await this.post("/trusted/validate", request)) as object),
          startupDurationMs,
          checkoutDurationMs: prepared.checkoutDurationMs,
        }),
      );
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
        withContainerControlTimeout("cleanup outbound revocation", () =>
          this.setOutboundByHosts({}),
        ),
        withContainerControlTimeout("cleanup allowlist revocation", () =>
          this.setAllowedHosts([]),
        ),
        withContainerControlTimeout("cleanup stop", () => this.stop()),
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
    return this.planningAttempts.run(request.attemptId, () =>
      durableAttemptResult(
        this.ctx.storage,
        "attempt-result:planning:v1",
        (value) => validatePlanningResult(request, value),
        () => this.executePlanningJob(request, codexAuthJson),
      ),
    );
  }

  private async executePlanningJob(
    request: PlanningAgentRequest,
    codexAuthJson: string,
  ): Promise<PlanningAgentResult> {
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
      const result = await this.phase(request, "agent.plan", async () =>
        planningAgentResultSchema.parse(
          await this.post("/planning/run", request),
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
        this.stop(),
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
    return this.reviewAttempts.run(request.attemptId, () =>
      durableAttemptResult(
        this.ctx.storage,
        "attempt-result:review:v1",
        (value) => validateIndependentReviewResult(request, value),
        () => this.executeReviewJob(request, claudeAuthJson),
      ),
    );
  }

  private async executeReviewJob(
    request: IndependentReviewRequest,
    claudeAuthJson: string,
  ): Promise<IndependentReviewResult> {
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
      const result = await this.phase(request, "review.finalize", async () =>
        independentReviewResultSchema.parse({
          ...((await this.post("/review/result", request)) as object),
          startupDurationMs,
        }),
      );
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
        this.stop(),
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
