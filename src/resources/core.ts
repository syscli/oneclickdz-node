// Service status and key validation. These two endpoints need no parameters and
// are the quickest way to confirm a key works and which environment it belongs
// to before any money moves.

import { Resource } from "./base";
import type { ServiceHealth, ValidateResult } from "../types";

export class Core extends Resource {
  /** Check the API and each operator's reachability. */
  ping(signal?: AbortSignal): Promise<ServiceHealth> {
    return this.getData<ServiceHealth>("ping", undefined, signal);
  }

  /** Confirm the key and read its environment, scope, and IP allowlist. */
  validate(signal?: AbortSignal): Promise<ValidateResult> {
    return this.getData<ValidateResult>("validate", undefined, signal);
  }
}
