export async function sha256(
  value: Uint8Array,
): Promise<{ bytes: ArrayBuffer; hex: string }> {
  const bytes = await crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  const hex = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { bytes, hex };
}

export async function workflowInstanceId(
  idempotencyKey: string,
): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(idempotencyKey));
  return `rh-${digest.hex.slice(0, 48)}`;
}
