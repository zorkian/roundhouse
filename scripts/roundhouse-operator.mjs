#!/usr/bin/env node
// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";

const [command, target, inputPath] = process.argv.slice(2);
const origin = process.env.ROUNDHOUSE_ORIGIN;
const token = process.env.ROUNDHOUSE_ACCESS_TOKEN;
if (!origin || !token) {
  console.error("Set ROUNDHOUSE_ORIGIN and ROUNDHOUSE_ACCESS_TOKEN");
  process.exit(2);
}

const routes = {
  inspect: { method: "GET", path: `/v1/runs/${target}` },
  evidence: { method: "GET", path: `/v1/runs/${target}/implementation` },
  alerts: { method: "GET", path: "/v1/operations/alerts" },
  retention: { method: "GET", path: "/v1/operations/retention" },
  submit: { method: "POST", path: "/v1/runs" },
  cancel: { method: "POST", path: `/v1/runs/${target}/cancel` },
  retry: { method: "POST", path: `/v1/runs/${target}/retry` },
  approve: { method: "POST", path: `/v1/runs/${target}/approval` },
  publish: { method: "POST", path: `/v1/runs/${target}/publication` },
  recover: { method: "POST", path: "/v1/operations/recover" },
};
const route = routes[command];
if (!route) {
  console.error(`Unknown command: ${command ?? ""}`);
  process.exit(2);
}
const body = inputPath ? await readFile(inputPath, "utf8") : undefined;
const response = await fetch(new URL(route.path, origin), {
  method: route.method,
  headers: {
    authorization: `Bearer ${token}`,
    ...(body ? { "content-type": "application/json" } : {}),
    ...(route.method === "POST"
      ? {
          "idempotency-key":
            process.env.ROUNDHOUSE_IDEMPOTENCY_KEY ?? crypto.randomUUID(),
        }
      : {}),
  },
  body,
});
const text = await response.text();
console.log(text);
if (!response.ok) process.exit(1);
