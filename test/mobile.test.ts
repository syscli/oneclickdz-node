import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Mobile } from "../src/resources/mobile";
import { ValidationError } from "../src/errors";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function http(fetchImpl: FetchLike, over: Partial<HttpClientConfig> = {}) {
  return new HttpClient({
    key: "k",
    baseUrl: "https://api.oneclickdz.com/v3",
    fetch: fetchImpl,
    timeoutMs: 1000,
    retry: { attempts: 1, respectRetryAfter: true },
    ...over,
  });
}

describe("Mobile.send", () => {
  it("rejects a malformed number before any request leaves", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    const mobile = new Mobile(http(fetchImpl));
    await expect(
      mobile.send({ plan_code: "PREPAID_DJEZZY", MSSIDN: "0478000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generates a reference when none is given", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { topupId: "t1", topupRef: "r1" } }),
    );
    await new Mobile(http(fetchImpl)).send({
      plan_code: "PREPAID_DJEZZY",
      MSSIDN: "0778037340",
      amount: 500,
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(sent.ref).toMatch(/^ocd-/);
  });

  it("keeps a caller-supplied reference", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { topupId: "t1", topupRef: "mine" } }),
    );
    await new Mobile(http(fetchImpl)).send({
      plan_code: "PREPAID_DJEZZY",
      MSSIDN: "0778037340",
      amount: 500,
      ref: "mine",
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(sent.ref).toBe("mine");
  });
});

describe("Mobile.sendAndWait", () => {
  it("sends, then polls by reference until the status is terminal", async () => {
    const statuses = ["PENDING", "HANDLING", "FULFILLED"];
    let check = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/mobile/send")) {
        return jsonResponse({
          success: true,
          data: { topupId: "t1", topupRef: "r1" },
        });
      }
      return jsonResponse({
        success: true,
        data: { _id: "t1", ref: "r1", status: statuses[check++]!, MSSIDN: "0778037340" },
      });
    }) as unknown as FetchLike;

    const result = await new Mobile(http(fetchImpl)).sendAndWait(
      { plan_code: "PREPAID_DJEZZY", MSSIDN: "0778037340", amount: 500 },
      { intervalMs: 0 },
    );
    expect(result.status).toBe("FULFILLED");
    // One send plus three status checks.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    // It polls by the reference it generated and sent, not the response echo.
    const sentRef = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).ref;
    expect(String(fetchImpl.mock.calls[1]![0])).toContain(
      `/mobile/check-ref/${sentRef}`,
    );
  });
});

describe("Mobile.plans", () => {
  it("returns the dynamic and fixed plan lists", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          dynamicPlans: [
            {
              code: "PREPAID_DJEZZY",
              name: "Djezzy",
              operator: "Djezzy",
              cost: 0,
              isEnabled: true,
              min_amount: 50,
              max_amount: 10000,
            },
          ],
          fixedPlans: [],
        },
      }),
    );
    const plans = await new Mobile(http(fetchImpl)).plans();
    expect(plans.dynamicPlans[0]?.max_amount).toBe(10000);
    expect(plans.fixedPlans).toEqual([]);
  });
});
