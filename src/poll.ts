// The polling engine behind every `*AndWait` helper. The recharge endpoints are
// asynchronous: you send an order, then check its status until it settles.
// Webhooks are not available yet, so polling is the only way to learn the
// outcome. This keeps the loop in one place so each resource just supplies a
// fetcher and a "done yet?" predicate.

import { OneClickError } from "./errors";

export interface PollOptions {
  /** Milliseconds between checks. The docs recommend a fixed 5s. */
  intervalMs?: number;
  /** How many checks before giving up. */
  maxAttempts?: number;
  /** Cancel the wait early. The pending delay rejects at once when aborted. */
  signal?: AbortSignal;
}

/** Raised when a status never reaches a terminal state within the attempt budget. */
export class PollTimeoutError extends OneClickError {
  /** The most recent value seen before time ran out. */
  readonly last: unknown;

  constructor(message: string, last: unknown, attempts: number) {
    super(message, "poll_timeout", { details: { attempts } });
    this.last = last;
  }
}

/**
 * Call `fetchOnce` until `isDone` accepts the result, then return that result.
 * The first check happens immediately; the interval only applies between checks,
 * so a status that is already settled returns without an extra wait.
 */
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 5000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 60);

  let last: T | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(options.signal);
    last = await fetchOnce();
    if (isDone(last)) return last;
    if (attempt < maxAttempts) await delay(intervalMs, options.signal);
  }

  throw new PollTimeoutError(
    `Gave up after ${maxAttempts} checks without a final status.`,
    last,
    maxAttempts,
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const error = new Error("The wait was aborted.");
  error.name = "AbortError";
  return error;
}

/** A sleep that rejects the moment its signal aborts, rather than after the full wait. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
