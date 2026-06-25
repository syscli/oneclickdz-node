// A wrapper for values that must not end up in logs: gift-card codes, serials,
// and internet recharge codes. The docs are explicit that card codes should
// never be written out in plain text, so the SDK hands them back inside a Secret
// that renders as a placeholder everywhere a value is normally stringified, and
// only gives up the real value when you ask for it with `reveal()`.

const REDACTED = "[redacted]";

// The symbol Node's console and util.inspect look for. Referencing it by name
// rather than importing `util` keeps this file free of any Node-only import, so
// it works the same on edge runtimes.
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class Secret<T = string> {
  // A private field is neither enumerable nor reachable by Object.keys or a
  // spread, so the value cannot leak through ordinary object handling.
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  /** The real value. Calling this is the deliberate, searchable moment a secret is read. */
  reveal(): T {
    return this.#value;
  }

  /** Used by JSON.stringify, so a secret nested in an object serializes redacted. */
  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [INSPECT](): string {
    return `Secret(${REDACTED})`;
  }

  static of<T>(value: T): Secret<T> {
    return new Secret(value);
  }
}

export function isSecret(value: unknown): value is Secret<unknown> {
  return value instanceof Secret;
}

/** Reveal a value whether or not it is wrapped, for code that handles both. */
export function reveal<T>(value: Secret<T> | T): T {
  return value instanceof Secret ? value.reveal() : value;
}
