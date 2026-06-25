// Public entry point. The client and resource types are wired up in later steps.
export const VERSION = "0.1.0";

export {
  OneClickError,
  AuthError,
  ForbiddenError,
  InsufficientBalanceError,
  DuplicateRefError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  NetworkError,
  RequestError,
  errorFromResponse,
} from "./errors";
export type {
  OneClickErrorCode,
  OneClickErrorOptions,
  ValidationIssue,
  ValidationErrorOptions,
  RateLimitErrorOptions,
} from "./errors";

export type {
  HttpMethod,
  FetchLike,
  RetryConfig,
  Pagination,
  ResponseMeta,
  Envelope,
} from "./http";
