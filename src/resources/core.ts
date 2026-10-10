// Service status and key validation. These two endpoints need no parameters and
// are the quickest way to confirm a key works and which environment it belongs
// to before any money moves.

import { Resource } from "./base";
import type { ApiKeyInfo, ServiceHealth, ValidateResult } from "../types";
import { Secret } from "../secret";

interface RawValidateResult {
  username: string;
  apiKey: Omit<ApiKeyInfo, "key"> & { key?: string };
}

export class Core extends Resource {
  /** Check the API and each operator's reachability. */
  ping(signal?: AbortSignal): Promise<ServiceHealth> {
    return this.getData<ServiceHealth>("ping", undefined, signal);
  }

  /**
   * Confirm the key and read its environment, scope, and IP allowlist. The key
   * the API echoes back comes wrapped in a Secret.
   */
  async validate(signal?: AbortSignal): Promise<ValidateResult> {
    const raw = await this.getData<RawValidateResult>(
      "validate",
      undefined,
      signal,
    );
    return {
      ...raw,
      apiKey: { ...raw.apiKey, key: Secret.of(raw.apiKey?.key ?? "") },
    };
  }
}
