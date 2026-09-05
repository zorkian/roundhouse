// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

const runtimeHostSecretNames = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

export function secretStoreRequirements(configs) {
  const requirements = new Map();
  for (const config of configs) {
    for (const secret of config.env?.production?.secrets_store_secrets ?? []) {
      const key = `${secret.store_id}\0${secret.secret_name}`;
      requirements.set(key, {
        storeId: secret.store_id,
        secretName: secret.secret_name,
      });
    }
  }
  return [...requirements.values()];
}

export function assertSecretStoreInventory(requirements, inventories) {
  for (const { storeId, secretName } of requirements) {
    const inventory = inventories.get(storeId);
    assert(Array.isArray(inventory), `missing inventory for store ${storeId}`);
    assert(
      inventory.some(
        (secret) =>
          secret?.name === secretName &&
          secret.status === "active" &&
          Array.isArray(secret.scopes) &&
          secret.scopes.includes("workers"),
      ),
      `missing active workers secret ${secretName}`,
    );
  }
}

export function assertRuntimeHostSecrets(settings) {
  const bindings = settings?.bindings;
  assert(Array.isArray(bindings), "runtime-host settings have no bindings");
  const names = new Set(
    bindings
      .filter((binding) => binding?.type === "secret_text")
      .map((binding) => binding.name),
  );
  for (const name of runtimeHostSecretNames)
    assert(names.has(name), `runtime-host is missing Worker secret ${name}`);
}

export async function cloudflareJson(
  url,
  apiToken,
  {
    attempts = 4,
    fetchImpl = fetch,
    retryDelayMs = 2_000,
    sleep = (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    timeoutMs = 30_000,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new Error(
          `Cloudflare API request failed with ${response.status}`,
        );
      const payload = await response.json();
      assert.equal(payload?.success, true, "Cloudflare API response failed");
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

export async function verifyProductionSecrets({
  accountId,
  apiToken,
  configPaths,
  requestOptions,
}) {
  assert(accountId, "CLOUDFLARE_ACCOUNT_ID is required");
  assert(apiToken, "CLOUDFLARE_API_TOKEN is required");
  assert(configPaths.length > 0, "at least one production config is required");

  const configs = await Promise.all(
    configPaths.map(async (path) => parse(await readFile(path, "utf8"))),
  );
  const requirements = secretStoreRequirements(configs);
  assert(
    requirements.length > 0,
    "production configs have no Secrets Store bindings",
  );

  const inventories = new Map();
  for (const { storeId } of requirements) {
    if (inventories.has(storeId)) continue;
    const result = await cloudflareJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/secrets_store/stores/${storeId}/secrets?per_page=100`,
      apiToken,
      requestOptions,
    );
    assert(Array.isArray(result), `invalid inventory for store ${storeId}`);
    inventories.set(storeId, result);
  }
  assertSecretStoreInventory(requirements, inventories);

  const runtimeHost = configs.find(
    (config) =>
      config.env?.production?.name === "roundhouse-v2-runtime-host-production",
  );
  assert(runtimeHost, "production runtime-host config is required");
  const settings = await cloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${runtimeHost.env.production.name}/settings`,
    apiToken,
    requestOptions,
  );
  assertRuntimeHostSecrets(settings);
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  await verifyProductionSecrets({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    configPaths: process.argv.slice(2),
  });
}
