// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import type { ControlPlaneEnv } from "./environment.js";
import {
  default as handler,
  executeTrustedExecutionWorkflow,
} from "./index.js";

export default handler;
export {
  ContainerProxy,
  RoundhouseExecutionContainer,
} from "./execution-container.js";

export class RoundhouseTrustedExecutionWorkflow extends WorkflowEntrypoint<
  ControlPlaneEnv,
  unknown
> {
  override run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return executeTrustedExecutionWorkflow(this.env, event.payload, step);
  }
}
