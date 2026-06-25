// A small reference generator. Every send accepts a caller `ref`; when one is
// not given the client makes its own, so a resend after a dropped connection
// reuses the same reference and the API rejects the duplicate instead of
// charging the account a second time. That is the whole point of having a ref.

/** Build a unique-enough order reference with a readable prefix. */
export function generateRef(prefix = "ocd"): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}
