// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export interface ApiResponseDetails {
  readonly api: string;
  readonly operation: string;
  readonly attemptId?: string;
  readonly model?: string;
}

export type ApiResponseLogEntry = Readonly<Record<string, unknown>> & {
  readonly message: string;
};

export type ApiResponseLogWriter = (entry: ApiResponseLogEntry) => void;

export function observeBufferedResponse(
  response: Response,
  details: ApiResponseDetails,
  write?: ApiResponseLogWriter,
): Promise<Response>;

export function observeStreamingResponse(
  response: Response,
  details: ApiResponseDetails,
  options?: {
    readonly write?: ApiResponseLogWriter;
    readonly onText?: (text: string) => void;
    readonly onComplete?: () => void | Promise<void>;
  },
): Response;
