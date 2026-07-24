// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Process } from "@cloudflare/sandbox";
import type { NestedContainerRuntimeHost } from "./attempt-sandbox-components.js";

const containerCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const dockerBuilder = "roundhouse-host-v1";
const dockerBuilderImage =
  "moby/buildkit@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec";
const dockerBuilderConfig = "/etc/roundhouse-buildkitd.toml";

export class NestedContainerRuntime {
  constructor(private readonly host: NestedContainerRuntimeHost) {}

  async ensure(attemptId?: string): Promise<Process> {
    const startedAt = Date.now();
    let stepStartedAt = Date.now();
    await this.host.trace(attemptId, "docker_process_lookup_started");
    let docker = await this.host.getProcess("roundhouse-docker");
    const initialStatus = docker ? await docker.getStatus() : undefined;
    await this.host.trace(
      attemptId,
      "docker_process_lookup_completed",
      stepStartedAt,
      { found: Boolean(docker), status: initialStatus ?? null },
    );
    if (docker && !["starting", "running"].includes(initialStatus ?? "")) {
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "docker_stale_process_kill_started",
        undefined,
        { status: initialStatus },
      );
      await docker.kill().catch(() => undefined);
      await this.host.trace(
        attemptId,
        "docker_stale_process_kill_completed",
        stepStartedAt,
      );
      docker = null;
    }
    if (!docker) {
      stepStartedAt = Date.now();
      await this.host.trace(attemptId, "docker_process_start_started");
      docker = await this.host.startProcess(
        "/home/rootless/boot-docker-for-dind.sh",
        { processId: "roundhouse-docker" },
      );
      const startedStatus = await docker.getStatus();
      await this.host.trace(
        attemptId,
        "docker_process_start_completed",
        stepStartedAt,
        {
          processId: docker.id,
          pid: docker.pid,
          status: startedStatus,
        },
      );
    }
    stepStartedAt = Date.now();
    await this.host.trace(attemptId, "runtime_capacity_probe_started");
    const capacity = await this.host.exec(
      "df -k /workspace && getconf _NPROCESSORS_ONLN",
      { origin: "internal", timeout: 5_000 },
    );
    await this.host.trace(
      attemptId,
      "runtime_capacity_probe_completed",
      stepStartedAt,
      {
        success: capacity.success,
        exitCode: capacity.exitCode,
        stdout: capacity.stdout.slice(-2_000),
        stderr: capacity.stderr.slice(-1_000),
      },
    );
    if (!capacity.success) throw new Error("runtime_capacity_probe_failed");
    let probes = 0;
    let lastWaitingTraceAt = 0;
    while (Date.now() - startedAt < 30_000) {
      const probeStartedAt = Date.now();
      probes += 1;
      await this.host.trace(
        attemptId,
        "docker_daemon_probe_started",
        undefined,
        { probe: probes },
      );
      let status;
      try {
        status = await this.host.exec("docker version", {
          origin: "internal",
          timeout: 5_000,
        });
      } catch (error) {
        await this.host.trace(
          attemptId,
          "docker_daemon_probe_failed",
          probeStartedAt,
          {
            probe: probes,
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await this.host.trace(
        attemptId,
        "docker_daemon_probe_completed",
        probeStartedAt,
        {
          probe: probes,
          success: status.success,
          exitCode: status.exitCode,
          detail: status.stderr.slice(-1_000),
        },
      );
      if (status.success) {
        const driverStartedAt = Date.now();
        await this.host.trace(attemptId, "docker_storage_driver_probe_started");
        const driver = await this.host.exec(
          "docker info --format '{{.Driver}}'",
          {
            cwd: "/",
            origin: "internal",
            timeout: 5_000,
          },
        );
        await this.host.trace(
          attemptId,
          "docker_storage_driver_probe_completed",
          driverStartedAt,
          {
            success: driver.success,
            exitCode: driver.exitCode,
            driver: driver.stdout.trim(),
            detail: driver.stderr.slice(-1_000),
          },
        );
        if (!driver.success)
          throw new Error("docker_storage_driver_probe_failed");
        await this.host.trace(attemptId, "docker_daemon_ready", startedAt, {
          probes,
          probeDurationMs: Date.now() - probeStartedAt,
        });
        await this.ensureBuilder(attemptId);
        return docker;
      }
      if (
        lastWaitingTraceAt === 0 ||
        Date.now() - lastWaitingTraceAt >= 5_000
      ) {
        lastWaitingTraceAt = Date.now();
        const process = await this.host.getProcess("roundhouse-docker");
        const processStatus = process ? await process.getStatus() : null;
        await this.host.trace(attemptId, "docker_daemon_waiting", startedAt, {
          probes,
          probeDurationMs: Date.now() - probeStartedAt,
          exitCode: status.exitCode,
          processStatus,
          detail: status.stderr.slice(-1_000),
        });
        if (processStatus && !["starting", "running"].includes(processStatus)) {
          const logs = await this.host.getProcessLogs("roundhouse-docker");
          await this.host.trace(
            attemptId,
            "docker_process_exited_before_ready",
            startedAt,
            {
              processStatus,
              stdout: logs.stdout.slice(-4_000),
              stderr: logs.stderr.slice(-4_000),
            },
          );
          throw new Error("docker_process_exited_before_ready");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const process = await this.host.getProcess("roundhouse-docker");
    const processStatus = process ? await process.getStatus() : null;
    const logs = process
      ? await this.host.getProcessLogs("roundhouse-docker")
      : undefined;
    await this.host.trace(attemptId, "docker_daemon_timeout", startedAt, {
      probes,
      processStatus,
      ...(logs
        ? {
            stdout: logs.stdout.slice(-4_000),
            stderr: logs.stderr.slice(-4_000),
          }
        : {}),
    });
    throw new Error("docker_start_timeout");
  }

  private async ensureBuilder(attemptId?: string): Promise<void> {
    const startedAt = Date.now();
    await this.host.trace(
      attemptId,
      "docker_builder_inspect_started",
      undefined,
      { builder: dockerBuilder },
    );
    let stepStartedAt = Date.now();
    const existing = await this.host.exec(
      `docker buildx inspect ${dockerBuilder}`,
      { origin: "internal" },
    );
    await this.host.trace(
      attemptId,
      "docker_builder_inspect_completed",
      stepStartedAt,
      {
        builder: dockerBuilder,
        success: existing.success,
        exitCode: existing.exitCode,
        detail: existing.stderr.slice(-1_000),
      },
    );
    if (!existing.success) {
      stepStartedAt = Date.now();
      const builderContainer = `buildx_buildkit_${dockerBuilder}0`;
      await this.host.trace(
        attemptId,
        "docker_builder_stale_container_inspect_started",
        undefined,
        { builder: dockerBuilder, container: builderContainer },
      );
      const staleContainer = await this.host.exec(
        `docker container inspect ${builderContainer}`,
        { origin: "internal" },
      );
      await this.host.trace(
        attemptId,
        "docker_builder_stale_container_inspect_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          container: builderContainer,
          found: staleContainer.success,
          exitCode: staleContainer.exitCode,
          detail: staleContainer.stderr.slice(-1_000),
        },
      );
      if (staleContainer.success) {
        stepStartedAt = Date.now();
        await this.host.trace(
          attemptId,
          "docker_builder_stale_container_remove_started",
          undefined,
          { builder: dockerBuilder, container: builderContainer },
        );
        const removed = await this.host.exec(
          `docker rm --force ${builderContainer}`,
          { origin: "internal" },
        );
        await this.host.trace(
          attemptId,
          "docker_builder_stale_container_remove_completed",
          stepStartedAt,
          {
            builder: dockerBuilder,
            container: builderContainer,
            success: removed.success,
            exitCode: removed.exitCode,
            detail: removed.stderr.slice(-1_000),
          },
        );
        if (!removed.success)
          throw new Error("docker_builder_stale_container_remove_failed");
      }
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "docker_builder_create_started",
        undefined,
        {
          builder: dockerBuilder,
          image: dockerBuilderImage,
          config: dockerBuilderConfig,
          registryCa: containerCa,
        },
      );
      const created = await this.host.exec(
        `docker buildx create --name ${dockerBuilder} --driver docker-container --driver-opt network=host --driver-opt image=${dockerBuilderImage} --buildkitd-config ${dockerBuilderConfig} --buildkitd-flags '--oci-worker-net=host' --use --bootstrap`,
        { origin: "internal", timeout: 180_000 },
      );
      await this.host.trace(
        attemptId,
        "docker_builder_create_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: created.success,
          exitCode: created.exitCode,
          detail: created.stderr.slice(-4_000),
        },
      );
      if (!created.success) {
        await this.host.trace(
          attemptId,
          "docker_builder_create_failed",
          startedAt,
          { detail: created.stderr.slice(-4_000) },
        );
        throw new Error(
          `docker_builder_create_failed: ${created.stderr.slice(-4_000)}`,
        );
      }
    } else {
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "docker_builder_select_started",
        undefined,
        { builder: dockerBuilder },
      );
      const selected = await this.host.exec(
        `docker buildx use ${dockerBuilder}`,
        { origin: "internal" },
      );
      await this.host.trace(
        attemptId,
        "docker_builder_select_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: selected.success,
          exitCode: selected.exitCode,
          detail: selected.stderr.slice(-1_000),
        },
      );
      if (!selected.success)
        throw new Error(
          `docker_builder_select_failed: ${selected.stderr.slice(-4_000)}`,
        );
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "docker_builder_bootstrap_started",
        undefined,
        { builder: dockerBuilder, image: dockerBuilderImage },
      );
      const bootstrapped = await this.host.exec(
        `docker buildx inspect --bootstrap ${dockerBuilder}`,
        { origin: "internal", timeout: 180_000 },
      );
      await this.host.trace(
        attemptId,
        "docker_builder_bootstrap_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: bootstrapped.success,
          exitCode: bootstrapped.exitCode,
          detail: bootstrapped.stderr.slice(-4_000),
        },
      );
      if (!bootstrapped.success)
        throw new Error(
          `docker_builder_bootstrap_failed: ${bootstrapped.stderr.slice(-4_000)}`,
        );
    }
    stepStartedAt = Date.now();
    await this.host.trace(
      attemptId,
      "docker_builder_registry_ca_verify_started",
      undefined,
      { builder: dockerBuilder, registry: "ghcr.io" },
    );
    const caVerified = await this.host.exec(
      `outer_ca=$(sha256sum ${containerCa} | cut -d ' ' -f 1) && inner_ca=$(docker exec buildx_buildkit_${dockerBuilder}0 sha256sum /etc/buildkit/certs/ghcr.io/cloudflare-containers-ca.crt | cut -d ' ' -f 1) && builder_config=$(docker exec buildx_buildkit_${dockerBuilder}0 cat /etc/buildkit/buildkitd.toml) && printf 'outer_ca=%s\\ninner_ca=%s\\nbuilder_config=%s\\n' "$outer_ca" "$inner_ca" "$builder_config" && test "$outer_ca" = "$inner_ca"`,
      { origin: "internal", timeout: 5_000 },
    );
    await this.host.trace(
      attemptId,
      "docker_builder_registry_ca_verify_completed",
      stepStartedAt,
      {
        builder: dockerBuilder,
        registry: "ghcr.io",
        success: caVerified.success,
        exitCode: caVerified.exitCode,
        detail: caVerified.stdout.slice(-4_000),
        error: caVerified.stderr.slice(-1_000),
      },
    );
    if (!caVerified.success)
      throw new Error(
        `docker_builder_registry_ca_missing: ${caVerified.stderr.slice(-1_000)}`,
      );
    await this.host.trace(attemptId, "docker_builder_ready", startedAt, {
      builder: dockerBuilder,
      image: dockerBuilderImage,
    });
    console.log(
      JSON.stringify({
        message: "docker_builder_ready",
        ...(attemptId ? { attemptId } : {}),
        builder: dockerBuilder,
        image: dockerBuilderImage,
        durationMs: Date.now() - startedAt,
      }),
    );
  }
}
