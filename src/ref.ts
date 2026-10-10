// A small reference generator. Every send accepts a caller `ref`; when one is
// not given the client makes its own and puts it on `error.ref` if the send
// fails. Each call to `send` without a ref gets a fresh one, so calling `send`
// again after a dropped connection is a new order. Reconcile with the ref from
// the error first; resend only with that same ref, which the API rejects as a
// duplicate if the first one went through.

/** Build a unique-enough order reference with a readable prefix. */
export function generateRef(prefix = "ocd"): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}
