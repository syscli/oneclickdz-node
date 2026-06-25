// The client. One instance holds the key and the transport, and exposes a
// resource per product. Construct it once and reuse it: the resources are thin
// and share the same HttpClient, so there is nothing to pool or close.

import { HttpClient, type FetchLike, type RetryConfig } from "./http";
import { Core } from "./resources/core";
import { Account } from "./resources/account";
import { Mobile } from "./resources/mobile";
import { Internet } from "./resources/internet";
import { GiftCards } from "./resources/giftcards";
import { Payments } from "./resources/payments";
import type { ServiceHealth, ValidateResult } from "./types";

const DEFAULT_BASE_URL = "https://api.oneclickdz.com/v3";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY: RetryConfig = { attempts: 3, respectRetryAfter: true };

export interface OneClickDZOptions {
  /** Your access token, sandbox or production, from the dashboard. */
  key: string;
  /** Defaults to the production v3 endpoint. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Override either retry field; the rest keep their defaults. */
  retry?: Partial<RetryConfig>;
  /** Supply a fetch for older runtimes or for tests. Defaults to the global. */
  fetch?: FetchLike;
}

export class OneClickDZ {
  readonly core: Core;
  readonly account: Account;
  readonly mobile: Mobile;
  readonly internet: Internet;
  readonly giftCards: GiftCards;
  readonly payments: Payments;

  private readonly http: HttpClient;

  constructor(options: OneClickDZOptions) {
    if (!options.key) {
      throw new Error("OneClickDZ needs an access token in options.key.");
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error(
        "No fetch is available. Run on Node 18+ or pass one in options.fetch.",
      );
    }

    this.http = new HttpClient({
      key: options.key,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retry: { ...DEFAULT_RETRY, ...options.retry },
      fetch: fetchImpl,
    });

    this.core = new Core(this.http);
    this.account = new Account(this.http);
    this.mobile = new Mobile(this.http);
    this.internet = new Internet(this.http);
    this.giftCards = new GiftCards(this.http);
    this.payments = new Payments(this.http);
  }

  /** Shortcut for `core.ping()`: the API and operator status. */
  ping(signal?: AbortSignal): Promise<ServiceHealth> {
    return this.core.ping(signal);
  }

  /** Shortcut for `core.validate()`: confirm the key and read its environment. */
  validate(signal?: AbortSignal): Promise<ValidateResult> {
    return this.core.validate(signal);
  }
}
