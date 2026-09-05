// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export interface SecretStoreBinding {
  get(): Promise<string>;
}

export type SecretText = string | SecretStoreBinding;

export async function resolveSecretText(
  secret: SecretText | undefined,
  missingError: string,
): Promise<string> {
  if (secret === undefined) throw new Error(missingError);
  const value = typeof secret === "string" ? secret : await secret.get();
  if (!value) throw new Error(missingError);
  return value;
}
