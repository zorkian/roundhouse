// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

function providerFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const separator = model.indexOf("/");
  return separator > 0 ? model.slice(0, separator) : undefined;
}

// Actual provider responses can use a bare model ID even when the route is
// provider-qualified. Keep qualified identities intact and qualify bare IDs
// only when the route supplies an unambiguous provider.
export function normalizeModelId(input: {
  readonly model: string;
  readonly provider?: string;
  readonly configuredModel?: string;
}): string {
  if (providerFromModel(input.model)) return input.model;
  const provider =
    input.provider?.trim() || providerFromModel(input.configuredModel);
  return provider ? `${provider}/${input.model}` : input.model;
}
