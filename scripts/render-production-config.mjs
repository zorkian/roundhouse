// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const productionConfigs = [
  "apps/control-plane/wrangler.jsonc",
  "apps/runtime-host/wrangler.jsonc",
  "apps/model-broker/wrangler.jsonc",
];

const inputs = [
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    sentinel: "00000000000000000000000000000000",
    pattern: /^[a-f0-9]{32}$/,
    description: "a 32-character lowercase hexadecimal Cloudflare account ID",
  },
  {
    name: "CLOUDFLARE_V2_D1_DATABASE_ID",
    sentinel: "00000000-0000-0000-0000-000000000000",
    pattern:
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    description: "a lowercase UUID for the isolated V2 production D1 database",
  },
  {
    name: "CLOUDFLARE_WORKERS_SUBDOMAIN",
    sentinel: "replace-me",
    pattern: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    description: "the account workers.dev subdomain without a hostname suffix",
  },
  {
    name: "ROUNDHOUSE_GITHUB_APP_ID",
    sentinel: "9999999",
    pattern: /^[1-9][0-9]*$/,
    description: "a numeric GitHub App ID",
  },
  {
    name: "ROUNDHOUSE_GITHUB_CLIENT_ID",
    sentinel: "Iv000000000000000000",
    pattern: /^[A-Za-z0-9]{10,64}$/,
    description: "a GitHub App OAuth client ID",
  },
];

export function readProductionInputs(environment = process.env) {
  return Object.fromEntries(
    inputs.map(({ name, pattern, description }) => {
      const value = environment[name];
      if (typeof value !== "string" || !pattern.test(value)) {
        throw new Error(`${name} must be ${description}`);
      }
      return [name, value];
    }),
  );
}

export async function renderProductionConfigs({
  environment = process.env,
  outputName = "wrangler.production.jsonc",
} = {}) {
  if (!/^wrangler\.production(?:\.[a-z0-9-]+)?\.jsonc$/.test(outputName)) {
    throw new Error(
      "outputName must be an ignored wrangler.production*.jsonc filename",
    );
  }

  const values = readProductionInputs(environment);
  const seen = new Set();
  const renderedConfigs = await Promise.all(
    productionConfigs.map(async (relativePath) => {
      const inputPath = resolve(repositoryRoot, relativePath);
      let rendered = await readFile(inputPath, "utf8");

      for (const { name, sentinel } of inputs) {
        if (rendered.includes(sentinel)) seen.add(name);
        rendered = rendered.replaceAll(sentinel, values[name]);
      }

      return {
        outputPath: resolve(dirname(inputPath), outputName),
        rendered,
      };
    }),
  );

  const missingSentinels = inputs
    .map(({ name }) => name)
    .filter((name) => !seen.has(name));
  if (missingSentinels.length > 0) {
    throw new Error(
      `Production config sentinels are missing for: ${missingSentinels.join(", ")}`,
    );
  }

  await Promise.all(
    renderedConfigs.map(({ outputPath, rendered }) =>
      writeFile(outputPath, rendered, { encoding: "utf8", mode: 0o600 }),
    ),
  );

  return renderedConfigs.map(({ outputPath }) => outputPath);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputs = await renderProductionConfigs();
  for (const output of outputs) {
    console.log(`Rendered ${output}`);
  }
}
