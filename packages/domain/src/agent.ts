export type AgentCapability =
  | "cancel"
  | "resume"
  | "structured-events"
  | "tool-restrictions"
  | "usage-reporting";

export type AgentCapabilities = ReadonlySet<AgentCapability>;

export type AgentRunInput = {
  attemptId: string;
  prompt: string;
  workspace: string;
  allowedTools: readonly string[];
};

export type AgentMessage = { prompt: string };

export type AgentEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "message"; role: "assistant"; text: string }
  | { type: "tool.started"; name: string; callId: string; input: unknown }
  | {
      type: "tool.completed";
      callId: string;
      output: unknown;
      durationMs: number;
    }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      estimatedUsd?: number;
    }
  | {
      type: "completed";
      outcome: "succeeded" | "failed" | "cancelled";
      detail?: string;
    };

export interface AgentAdapter {
  readonly name: string;
  capabilities(): Promise<AgentCapabilities>;
  start(input: AgentRunInput): AsyncIterable<AgentEvent>;
  resume(sessionId: string, input: AgentMessage): AsyncIterable<AgentEvent>;
  cancel(attemptId: string): Promise<void>;
}
