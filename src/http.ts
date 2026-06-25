// Low-level transport for the OneClickDZ client. Everything that touches the
// network goes through here: the access-token header, query encoding, the
// timeout, the retry, envelope unwrapping, and JSON parsing. Resources call
// `request` and never build a URL or read the envelope themselves.

import {
  errorFromResponse,
  NetworkError,
  OneClickError,
  RateLimitError,
  ServiceError,
} from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A fetch implementation compatible with the platform global. */
export type FetchLike = typeof globalThis.fetch;

export interface RetryConfig {
  /** Total attempts including the first. 1 disables retrying. */
  attempts: number;
  /** Wait the Retry-After header when the API sends one. */
  respectRetryAfter: boolean;
}

/** Page numbers and totals the API returns on list endpoints. */
export interface Pagination {
  page: number;
  pageSize: number;
  totalPages: number;
  totalResults: number;
}

export interface ResponseMeta {
  timestamp?: string;
  pagination?: Pagination;
  [key: string]: unknown;
}

/**
 * The success envelope every endpoint returns. `data` is the endpoint payload;
 * a few endpoints (the gift-card catalog, for one) hang extra counts off the top
 * level, so unknown keys are preserved.
 */
export interface Envelope<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
  requestId?: string;
  [key: string]: unknown;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface HttpClientConfig {
  /** The API access token, sent as the X-Access-Token header. */
  key: string;
  /** Trailing slash is optional; it is added if missing. */
  baseUrl: string;
  fetch: FetchLike;
  timeoutMs: number;
  retry: RetryConfig;
}

export interface RequestOptions {
  query?: QueryParams;
  /** Serialized as JSON. Its presence is what adds the Content-Type header. */
  body?: unknown;
  /** Caller cancellation, merged with the per-request timeout. */
  signal?: AbortSignal;
}

/**
 * Turn a params object into a query string, including the leading `?`. Returns
 * an empty string when nothing survives filtering. `undefined` and `null` are
 * dropped; booleans go over the wire as `"true"` and `"false"`.
 */
export function encodeQuery(params: QueryParams | undefined): string {
  if (!params) return "";

  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }

  return parts.length ? `?${parts.join("&")}` : "";
}

/** The headers every request carries, plus Content-Type when sending a body. */
export function buildHeaders(
  config: HttpClientConfig,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Access-Token": config.key,
    Accept: "application/json",
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  return headers;
}

/**
 * Read a Retry-After header into seconds. The header is either a delta in
 * seconds or an HTTP date, so both are handled; anything else returns undefined.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    // new URL() treats a base without a trailing slash as a file and drops the
    // last path segment, which would silently delete the `/v3` prefix. Pin it.
    this.config = {
      ...config,
      baseUrl: config.baseUrl.endsWith("/")
        ? config.baseUrl
        : `${config.baseUrl}/`,
    };
  }

  /**
   * Send a request and return the unwrapped envelope.
   *
   * Retry policy is deliberately narrow. A 429 is always safe to retry, since
   * the request was rejected before processing. A 5xx or a dropped connection is
   * retried only for GET: a send that timed out may still have gone through, and
   * a blind retry could charge the account twice. Use a `ref` for safe resends.
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<Envelope<T>> {
    const maxAttempts = Math.max(1, this.config.retry.attempts);
    const idempotent = method === "GET";

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.send<T>(method, path, options);
      } catch (error) {
        if (attempt >= maxAttempts || !this.retryable(error, idempotent)) {
          throw error;
        }
        await sleep(this.backoffMs(error, attempt));
      }
    }
  }

  private retryable(error: unknown, idempotent: boolean): boolean {
    if (error instanceof RateLimitError) return true;
    if (error instanceof ServiceError) return idempotent;
    if (error instanceof NetworkError) return idempotent;
    return false;
  }

  /** Wait the API's Retry-After when offered, otherwise an exponential backoff. */
  private backoffMs(error: unknown, attempt: number): number {
    if (
      error instanceof RateLimitError &&
      this.config.retry.respectRetryAfter &&
      error.retryAfter !== undefined
    ) {
      return error.retryAfter * 1000;
    }
    return Math.min(2 ** (attempt - 1) * 500, 30_000);
  }

  private async send<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<Envelope<T>> {
    const hasBody = options.body !== undefined;
    const url = new URL(path, this.config.baseUrl);
    const target = `${url.toString()}${encodeQuery(options.query)}`;
    const headers = buildHeaders(this.config, hasBody);

    const controller = new AbortController();
    const timer =
      this.config.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.config.timeoutMs)
        : undefined;
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else
        options.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }

    let response: Response;
    try {
      response = await this.config.fetch(target, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      // A caller abort should surface as itself; a timeout or transport failure
      // becomes a NetworkError so the retry and the catch sites stay uniform.
      if (options.signal?.aborted) throw cause;
      const reason = cause instanceof Error ? cause.message : "request failed";
      throw new NetworkError(`Could not reach the API: ${reason}.`, { cause });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // Some gateway error pages are HTML, not JSON. Keep the raw text to report.
      body = text;
    }

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      throw errorFromResponse(response.status, body, retryAfter);
    }

    return this.toEnvelope<T>(body, response.status);
  }

  /** Confirm the body is a success envelope before handing it back. */
  private toEnvelope<T>(body: unknown, status: number): Envelope<T> {
    if (body && typeof body === "object" && "success" in body) {
      if ((body as { success?: unknown }).success === false) {
        // A 200 that still carries success:false. Treat it as the error it is.
        throw errorFromResponse(status, body);
      }
      return body as Envelope<T>;
    }
    throw new OneClickError(
      "The API returned a response in an unexpected shape.",
      "ERR_SERVICE",
      { status, body },
    );
  }
}
