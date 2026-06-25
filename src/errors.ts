// The error hierarchy. Every failure the client raises is an instance of
// OneClickError, so callers can catch one type and branch on `instanceof` or on
// the stable `code` string the API returns. HTTP failures are mapped from the
// envelope's `error.code` first and the status second; ValidationError is also
// raised client-side, before any request leaves.

/**
 * The machine-readable error codes. The API's own codes are kept verbatim so
 * `error.code` matches what the docs list. `network` is the one code the client
 * adds itself, for a request that never reached the server.
 */
export type OneClickErrorCode =
  | "MISSING_ACCESS_TOKEN"
  | "INVALID_ACCESS_TOKEN"
  | "ERR_AUTH"
  | "NO_BALANCE"
  | "INSUFFICIENT_BALANCE"
  | "DUPLICATED_REF"
  | "IP_BLOCKED"
  | "IP_NOT_ALLOWED"
  | "ERR_VALIDATION"
  | "ERR_PHONE"
  | "ERR_STOCK"
  | "NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_SERVER_ERROR"
  | "INTERNAL_ERROR"
  | "ERR_SERVICE"
  | "network"
  | (string & {});

export interface OneClickErrorOptions {
  status?: number;
  /** The `error.details` object the API attaches to some failures. */
  details?: unknown;
  /** The request id from the envelope, handy when opening a support ticket. */
  requestId?: string;
  /** The full parsed response body, kept so callers can read everything. */
  body?: unknown;
  cause?: unknown;
}

export class OneClickError extends Error {
  /** HTTP status, or undefined for a client-side or network error. */
  readonly status?: number;
  readonly code: OneClickErrorCode;
  readonly details: unknown;
  readonly requestId?: string;
  readonly body: unknown;

  constructor(
    message: string,
    code: OneClickErrorCode,
    options: OneClickErrorOptions = {},
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = new.target.name;
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

/** 401. The key is missing, malformed, or rejected. */
export class AuthError extends OneClickError {}

/**
 * 403. The key is valid but the action is not allowed: a blocked or unlisted IP,
 * for instance. Balance and duplicate-ref cases have their own subclasses below
 * so they can be caught on their own.
 */
export class ForbiddenError extends OneClickError {}

/** 403 with NO_BALANCE or INSUFFICIENT_BALANCE. Top up the account first. */
export class InsufficientBalanceError extends ForbiddenError {}

/**
 * 403 with DUPLICATED_REF. The reference was already used, so the original order
 * stands and nothing was charged twice. Look the first one up by its ref rather
 * than sending again.
 */
export class DuplicateRefError extends ForbiddenError {}

export interface ValidationIssue {
  field: string;
  message: string;
  /** The order reference this issue belongs to, when checking a batch. */
  ref?: string;
}

export interface ValidationErrorOptions extends OneClickErrorOptions {
  /** The API code for a server-side 400; defaults to ERR_VALIDATION. */
  code?: OneClickErrorCode;
  /** Filled when the client caught the problem before sending. */
  issues?: ValidationIssue[];
}

/**
 * A 400 from the API, or a client-side check. `issues` is filled when the client
 * caught the problem before sending; for a server 400 it is empty and the detail
 * sits in `code`, `message`, and `details`.
 */
export class ValidationError extends OneClickError {
  readonly issues: ValidationIssue[];

  constructor(message: string, options: ValidationErrorOptions = {}) {
    super(message, options.code ?? "ERR_VALIDATION", options);
    this.issues = options.issues ?? [];
  }
}

/** 404. No order, product, or payment matches the id or reference. */
export class NotFoundError extends OneClickError {}

export interface RateLimitErrorOptions extends OneClickErrorOptions {
  /** Seconds to wait before retrying, read from the Retry-After header. */
  retryAfter?: number;
}

/** 429. Too many requests inside the per-minute window. */
export class RateLimitError extends OneClickError {
  readonly retryAfter?: number;

  constructor(message: string, options: RateLimitErrorOptions = {}) {
    super(message, "RATE_LIMIT_EXCEEDED", options);
    this.retryAfter = options.retryAfter;
  }
}

/**
 * 500 or 503. The request may or may not have been processed. For a top-up this
 * matters: the docs say not to refund a server error for 24 hours, since the
 * recharge can still settle. The client never auto-retries a send on a 5xx for
 * the same reason.
 */
export class ServiceError extends OneClickError {}

/** The request never reached the server: DNS, socket, or a timeout abort. */
export class NetworkError extends OneClickError {
  constructor(message: string, options: OneClickErrorOptions = {}) {
    super(message, "network", options);
  }
}

/** Any other 4xx the client does not model on its own. */
export class RequestError extends OneClickError {}

interface ApiErrorBody {
  code?: OneClickErrorCode;
  message?: string;
  details?: unknown;
}

/**
 * Build the right error from a failed envelope. The API's `error.code` decides
 * the class where we recognise it; otherwise the HTTP status does. The code is
 * passed through verbatim so `error.code` matches the documentation.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfter?: number,
): OneClickError {
  const apiError = readApiError(body);
  const code = apiError.code;
  const message = apiError.message ?? `Request failed with status ${status}.`;
  const options: OneClickErrorOptions = {
    status,
    body,
    requestId: readRequestId(body),
    details: apiError.details,
  };

  switch (code) {
    case "MISSING_ACCESS_TOKEN":
    case "INVALID_ACCESS_TOKEN":
    case "ERR_AUTH":
      return new AuthError(message, code, options);
    case "NO_BALANCE":
    case "INSUFFICIENT_BALANCE":
      return new InsufficientBalanceError(message, code, options);
    case "DUPLICATED_REF":
      return new DuplicateRefError(message, code, options);
    case "IP_BLOCKED":
    case "IP_NOT_ALLOWED":
      return new ForbiddenError(message, code, options);
    case "ERR_VALIDATION":
    case "ERR_PHONE":
    case "ERR_STOCK":
      return new ValidationError(message, { ...options, code });
    case "NOT_FOUND":
      return new NotFoundError(message, code, options);
    case "RATE_LIMIT_EXCEEDED":
      return new RateLimitError(message, { ...options, retryAfter });
    case "INTERNAL_SERVER_ERROR":
    case "INTERNAL_ERROR":
    case "ERR_SERVICE":
      return new ServiceError(message, code, options);
  }

  // No code we recognise. Fall back to the status, keeping any code the API did
  // send so a new server-side code still reaches the caller through `error.code`.
  return errorFromStatus(status, message, options, code, retryAfter);
}

function errorFromStatus(
  status: number,
  message: string,
  options: OneClickErrorOptions,
  code: OneClickErrorCode | undefined,
  retryAfter?: number,
): OneClickError {
  if (status === 401) return new AuthError(message, code ?? "ERR_AUTH", options);
  if (status === 403)
    return new ForbiddenError(message, code ?? "ERR_AUTH", options);
  if (status === 404)
    return new NotFoundError(message, code ?? "NOT_FOUND", options);
  if (status === 429)
    return new RateLimitError(message, { ...options, retryAfter });
  if (status >= 500)
    return new ServiceError(message, code ?? "INTERNAL_SERVER_ERROR", options);
  return new RequestError(message, code ?? "ERR_VALIDATION", options);
}

function readApiError(body: unknown): ApiErrorBody {
  if (body && typeof body === "object" && "error" in body) {
    const inner = (body as { error?: unknown }).error;
    if (inner && typeof inner === "object") {
      const e = inner as { code?: unknown; message?: unknown; details?: unknown };
      return {
        code: typeof e.code === "string" ? e.code : undefined,
        message: typeof e.message === "string" ? e.message : undefined,
        details: e.details,
      };
    }
  }
  return {};
}

function readRequestId(body: unknown): string | undefined {
  if (body && typeof body === "object" && "requestId" in body) {
    const id = (body as { requestId?: unknown }).requestId;
    if (typeof id === "string") return id;
  }
  return undefined;
}
