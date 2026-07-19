// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const secretField =
  /^(authorization|credential|password|private[_-]?key|secret|signature|token)$/i;
const secretHeader = /^(authorization|proxy-authorization|set-cookie)$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      secretField.test(key) ? "[REDACTED]" : redact(child),
    ]),
  );
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = secretHeader.test(name) ? "[REDACTED]" : value;
  });
  return headers;
}

function responseBody(text: string): unknown {
  if (!text) return null;
  try {
    return redact(JSON.parse(text));
  } catch {
    return text;
  }
}

export interface ApiResponseDetails {
  readonly api: string;
  readonly operation: string;
  readonly attemptId?: string;
}

export function writeApiResponseLog(
  response: Response,
  body: string,
  details: ApiResponseDetails,
): void {
  console.log(
    JSON.stringify({
      message: "api_response",
      ...details,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
      body: responseBody(body),
    }),
  );
}

export async function readJsonApiResponse<T>(
  response: Response,
  details: ApiResponseDetails,
): Promise<T> {
  const body = await response.text();
  writeApiResponseLog(response, body, details);
  return JSON.parse(body) as T;
}

export async function captureApiResponse(
  response: Response,
  details: ApiResponseDetails,
): Promise<Response> {
  const body = await response.text();
  writeApiResponseLog(response, body, details);
  return new Response(body || null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
