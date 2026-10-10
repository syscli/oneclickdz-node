import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Payments } from "../src/resources/payments";
import { ValidationError } from "../src/errors";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function http(fetchImpl: FetchLike) {
  const config: HttpClientConfig = {
    key: "k",
    baseUrl: "https://api.oneclickdz.com/v3",
    fetch: fetchImpl,
    timeoutMs: 1000,
    retry: { attempts: 1, respectRetryAfter: true },
  };
  return new HttpClient(config);
}

describe("Payments.createLink validation", () => {
  it("rejects an amount below the floor before sending", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await expect(
      new Payments(http(fetchImpl)).createLink({
        productInfo: { title: "Order 1043", amount: 100 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown fee mode and a bad redirect", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    const payments = new Payments(http(fetchImpl));
    await payments
      .createLink({
        productInfo: { title: "Order", amount: 1000 },
        feeMode: "HALF" as never,
        redirectUrl: "ftp://example.test",
      })
      .catch((error: ValidationError) => {
        expect(error).toBeInstanceOf(ValidationError);
        const fields = error.issues.map((i) => i.field);
        expect(fields).toContain("feeMode");
        expect(fields).toContain("redirectUrl");
      });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a valid request and returns the URL", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          paymentLink: { uid: "u1", ref: "pay_1", isSandbox: true },
          paymentUrl: "https://pay.oneclickdz.com/pay_1",
          paymentRef: "pay_1",
        },
      }),
    );
    const result = await new Payments(http(fetchImpl)).createLink({
      productInfo: { title: "Order 1043", amount: 1000 },
      feeMode: "CUSTOMER_FEE",
    });
    expect(result.paymentUrl).toBe("https://pay.oneclickdz.com/pay_1");
    expect(result.paymentRef).toBe("pay_1");
  });
});

describe("Payments.waitForPayment", () => {
  it("polls the reference until the status is terminal", async () => {
    const statuses = ["PENDING", "PENDING", "CONFIRMED"];
    let check = 0;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          status: statuses[check++]!,
          message: "ok",
          paymentRef: "pay_1",
          transactionDetails: {
            amount: 1000,
            currency: "DZD",
            isSandbox: true,
            createdDate: "2026-06-25T00:00:00.000Z",
          },
        },
      }),
    );
    const result = await new Payments(http(fetchImpl)).waitForPayment("pay_1", {
      intervalMs: 0,
    });
    expect(result.status).toBe("CONFIRMED");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("Payments.checkPayment", () => {
  it("reads a pending payment and encodes the reference", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          status: "PENDING",
          message: "waiting",
          paymentRef: "pay 1",
          transactionDetails: { amount: 1000, currency: "DZD", isSandbox: true },
        },
      }),
    );
    const check = await new Payments(http(fetchImpl)).checkPayment("pay 1");
    expect(check.status).toBe("PENDING");
    expect(check.transactionDetails.createdDate).toBeUndefined();
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "/ocpay/checkPayment/pay%201",
    );
  });
});
