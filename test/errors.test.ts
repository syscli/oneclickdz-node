import { describe, it, expect } from "vitest";
import {
  errorFromResponse,
  AuthError,
  ForbiddenError,
  InsufficientBalanceError,
  DuplicateRefError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  OneClickError,
} from "../src/errors";

function envelope(code: string, message = "boom", details?: unknown) {
  return {
    success: false,
    error: { code, message, details },
    requestId: "req_test_1",
  };
}

describe("errorFromResponse", () => {
  it("maps auth codes to AuthError and keeps the code", () => {
    const err = errorFromResponse(401, envelope("INVALID_ACCESS_TOKEN"));
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("INVALID_ACCESS_TOKEN");
    expect(err.status).toBe(401);
    expect(err.message).toBe("boom");
    expect(err.requestId).toBe("req_test_1");
  });

  it("maps balance codes to InsufficientBalanceError, a ForbiddenError", () => {
    const err = errorFromResponse(403, envelope("INSUFFICIENT_BALANCE"));
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("maps DUPLICATED_REF to its own catchable class", () => {
    const err = errorFromResponse(403, envelope("DUPLICATED_REF"));
    expect(err).toBeInstanceOf(DuplicateRefError);
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("carries error details through to the instance", () => {
    const err = errorFromResponse(
      400,
      envelope("ERR_PHONE", "bad number", { number: "06", reason: "too short" }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe("ERR_PHONE");
    expect((err as ValidationError).issues).toEqual([]);
    expect(err.details).toEqual({ number: "06", reason: "too short" });
  });

  it("maps NOT_FOUND, rate limit, and service codes", () => {
    expect(errorFromResponse(404, envelope("NOT_FOUND"))).toBeInstanceOf(
      NotFoundError,
    );
    const limited = errorFromResponse(429, envelope("RATE_LIMIT_EXCEEDED"), 12);
    expect(limited).toBeInstanceOf(RateLimitError);
    expect((limited as RateLimitError).retryAfter).toBe(12);
    expect(errorFromResponse(503, envelope("ERR_SERVICE"))).toBeInstanceOf(
      ServiceError,
    );
  });

  it("falls back to the status when the code is unknown", () => {
    const err = errorFromResponse(418, envelope("SOMETHING_NEW"));
    expect(err).toBeInstanceOf(OneClickError);
    expect(err.code).toBe("SOMETHING_NEW");
  });

  it("falls back to the status when there is no error body at all", () => {
    const err = errorFromResponse(500, "<html>gateway</html>");
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(500);
  });
});

describe("ValidationError", () => {
  it("carries client-side issues and defaults the code", () => {
    const err = new ValidationError("check failed", {
      issues: [{ field: "MSSIDN", message: "is required", ref: "order-1" }],
    });
    expect(err.code).toBe("ERR_VALIDATION");
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]?.ref).toBe("order-1");
    expect(err).toBeInstanceOf(OneClickError);
  });
});
