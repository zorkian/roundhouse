// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const checkoutHosts = new Set(["github.com"]);

export function isCheckoutRequestAllowed(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" && checkoutHosts.has(url.hostname);
}

export const allowedCheckoutHosts = [...checkoutHosts];

export function modelRequestAuditAccepted(
  changes: number | undefined,
): boolean {
  return changes === 1;
}
