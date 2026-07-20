// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const responseLogChunkSize = 4_000;
const secretFields = new Set([
  "authorization",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "secret",
  "clientsecret",
  "signature",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
]);
const secretHeader = /^(authorization|proxy-authorization|set-cookie)$/i;

function isSecretField(name) {
  return secretFields.has(name.replaceAll(/[-_]/g, "").toLowerCase());
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSecretField(key) ? "[REDACTED]" : redact(child),
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

function safeWrite(write, entry) {
  try {
    write(entry);
  } catch {
    // Diagnostics must never change the observed API call.
  }
}

function failedEntry(response, details, error) {
  return {
    message: "api_response_log_failed",
    ...details,
    status: response.status,
    error: error instanceof Error ? error.message : String(error),
  };
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

async function observeBufferedResponse(
  response,
  details,
  write = defaultWrite,
  options = {},
) {
  let text;
  try {
    text = await response.clone().text();
  } catch (error) {
    safeWrite(write, failedEntry(response, details, error));
    return response;
  }
  safeWrite(write, {
    message: "api_response",
    ...details,
    status: response.status,
    statusText: response.statusText,
    headers: headers(response),
    body: body(text),
  });
  try {
    options.onText?.(text);
    await options.onComplete?.();
  } catch (error) {
    safeWrite(write, failedEntry(response, details, error));
  }
  return response;
}

export async function observeResponse(response, details, options = {}) {
  return response.headers
    .get("content-type")
    ?.toLowerCase()
    .includes("text/event-stream")
    ? observeEventStream(response, details, options)
    : observeBufferedResponse(response, details, options.write, options);
}

async function observeEventStream(response, details, options = {}) {
  const write = options.write ?? defaultWrite;
  safeWrite(write, openedEntry(response, details));
  let sequence = 0;
  const complete = async () => {
    try {
      await options.onComplete?.();
    } catch (error) {
      safeWrite(write, failedEntry(response, details, error));
    }
    safeWrite(write, {
      message: "api_response_completed",
      ...details,
      status: response.status,
      bodyChunks: sequence,
    });
  };
  if (!response.body) {
    await complete();
    return response;
  }
  const decoder = new TextDecoder();
  const writeText = (text) => {
    if (!text) return;
    try {
      options.onText?.(text);
    } catch (error) {
      safeWrite(write, failedEntry(response, details, error));
    }
    for (let offset = 0; offset < text.length; offset += responseLogChunkSize) {
      safeWrite(write, {
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
        await complete();
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
