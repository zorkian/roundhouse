// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunStatus } from "@roundhouse/core";

export type StatusTone = "active" | "waiting" | "succeeded" | "failed";

export const statusPillStyles = `.status{display:inline-block;border-radius:999px;padding:.22rem .55rem;font-weight:700;color:#344054;background:#eef1f5}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.failed{background:#fee9e7;color:#b42318}.status.succeeded{background:#e8f7ee;color:#087443}`;

export function runStatusTone(status: RunStatus): StatusTone {
  switch (status) {
    case "active":
      return "active";
    case "waiting":
      return "waiting";
    case "succeeded":
      return "succeeded";
    case "failed":
    case "cancelled":
      return "failed";
  }
}
