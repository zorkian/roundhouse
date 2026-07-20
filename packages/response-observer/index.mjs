// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const responseLogChunkSize = 4_000;
const secretField =
  /^(authorization|credential|password|private[_-]?key|secret|signature|token)$/i;
const secretHeader = /^(authorization|proxy-authorization|set-cookie)$/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      secretField.test(key) ? "[REDACTED]" : redact(child),
    ]),
  );
}

function headers(response) {
  const values = {};
  response.headers.forEach((value, name) => {
    values[name] = secretHeader.test(name) ? "[REDACTED]" : value;
  });
  return values;
}

function body(text) {
  if (!text) return null;
  try {
    return redact(JSON.parse(text));
  } catch {
    return text;
  }
}

function defaultWrite(entry) {
  console.log(JSON.stringify(entry));
}

function openedEntry(response, details) {
  return {
    message: "api_response_opened",
    ...details,
    status: response.status,
    statusText: response.statusText,
    headers: headers(response),
    hasBody: Boolean(response.body),
  };
}

export async function observeBufferedResponse(
  response,
  details,
  write = defaultWrite,
  options = {},
) {
  try {
    const text = await response.clone().text();
    write({
      message: "api_response",
      ...details,
      status: response.status,
      statusText: response.statusText,
      headers: headers(response),
      body: body(text),
    });
    options.onText?.(text);
    await options.onComplete?.();
  } catch (error) {
    write({
      message: "api_response_log_failed",
      ...details,
      status: response.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return response;
}

export async function observeResponse(response, details, options = {}) {
  return response.headers.get("content-type")?.includes("text/event-stream")
    ? observeStreamingResponse(response, details, options)
    : observeBufferedResponse(response, details, options.write, options);
}

export function observeStreamingResponse(response, details, options = {}) {
  const write = options.write ?? defaultWrite;
  write(openedEntry(response, details));
  if (!response.body) {
    write({
      message: "api_response_completed",
      ...details,
      status: response.status,
      bodyChunks: 0,
    });
    return response;
  }
  const decoder = new TextDecoder();
  let sequence = 0;
  const writeText = (text) => {
    options.onText?.(text);
    for (let offset = 0; offset < text.length; offset += responseLogChunkSize) {
      write({
        message: "api_response_body",
        ...details,
        sequence: sequence++,
        body: text.slice(offset, offset + responseLogChunkSize),
      });
    }
  };
  const stream = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        writeText(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      async flush() {
        writeText(decoder.decode());
        await options.onComplete?.();
        write({
          message: "api_response_completed",
          ...details,
          status: response.status,
          bodyChunks: sequence,
        });
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
