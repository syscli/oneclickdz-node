import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Mobile } from "../src/resources/mobile";
import { NetworkError, ValidationError } from "../src/errors";
import { PollTimeoutError } from "../src/poll";

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
  it("sends, then polls by topup id until the status is terminal", async () => {
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
    // It polls by the topup id from the send response, which is unambiguous.
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("/mobile/check-id/t1");
  });
});

describe("Mobile.getOffers", () => {
  it("sends a GETMENU probe and returns the offers off the refunded order", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/mobile/send")) {
        return jsonResponse({
          success: true,
          data: { topupId: "g1", topupRef: "r1" },
        });
      }
      return jsonResponse({
        success: true,
        data: {
          _id: "g1",
          ref: "r1",
          status: "REFUNDED",
          plan_code: "GETMENU_Djezzy",
          MSSIDN: "0798037340",
          refund_message: "offers available",
          suggested_offers: [
            { typename: "HAYLA 100", plan_code: "MIX100_DJEZZY", amount: 100 },
            { typename: "HAYLA 500", plan_code: "MIX500_DJEZZY", amount: 500 },
          ],
        },
      });
    }) as unknown as FetchLike;

    const offers = await new Mobile(http(fetchImpl)).getOffers(
      "Djezzy",
      "0798037340",
      { intervalMs: 0 },
    );
    expect(offers).toHaveLength(2);
    expect(offers[0]?.plan_code).toBe("MIX100_DJEZZY");

    const sent = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(sent.plan_code).toBe("GETMENU_Djezzy");
  });

  it("rejects a malformed number without sending", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await expect(
      new Mobile(http(fetchImpl)).getOffers("Mobilis", "123"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
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

describe("Mobile order context on failure", () => {
  const input = { plan_code: "PREPAID_DJEZZY", MSSIDN: "0778037340", amount: 500 };

  it("puts the generated ref on a send that never got an answer", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as FetchLike;
    const error = await new Mobile(http(fetchImpl)).send(input).catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.ref).toMatch(/^ocd-/);
    const sent = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body,
    );
    expect(error.ref).toBe(sent.ref);
  });

  it("puts the ref and topup id on a wait that fails mid-poll", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/mobile/send")) {
        return jsonResponse({ success: true, data: { topupId: "t9", topupRef: "x" } });
      }
      throw new Error("socket hang up");
    }) as unknown as FetchLike;
    const error = await new Mobile(http(fetchImpl))
      .sendAndWait({ ...input, ref: "mine" }, { intervalMs: 0 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.ref).toBe("mine");
    expect(error.orderId).toBe("t9");
  });

  it("puts the ref and topup id on a wait that times out", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/mobile/send")) {
        return jsonResponse({ success: true, data: { topupId: "t9", topupRef: "x" } });
      }
      return jsonResponse({ success: true, data: { _id: "t9", status: "HANDLING" } });
    }) as unknown as FetchLike;
    const error = await new Mobile(http(fetchImpl))
      .sendAndWait(input, { intervalMs: 0, maxAttempts: 2 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(PollTimeoutError);
    expect(error.ref).toMatch(/^ocd-/);
    expect(error.orderId).toBe("t9");
  });

  it("sends the caller's ref on the GETMENU probe", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/mobile/send")) {
        return jsonResponse({ success: true, data: { topupId: "g1", topupRef: "p" } });
      }
      return jsonResponse({ success: true, data: { _id: "g1", status: "REFUNDED" } });
    }) as unknown as FetchLike;
    const offers = await new Mobile(http(fetchImpl)).getOffers(
      "Ooredoo",
      "0551234567",
      { intervalMs: 0, ref: "probe-1" },
    );
    expect(offers).toEqual([]);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.parse(calls[0]![1]!.body).ref).toBe("probe-1");
  });
});

describe("Mobile lookups and history", () => {
  it("encodes the reference in checkByRef", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { _id: "t1", status: "FULFILLED" } }),
    );
    await new Mobile(http(fetchImpl)).checkByRef("a/b c");
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "/mobile/check-ref/a%2Fb%20c",
    );
  });

  it("reads a top-up by id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { _id: "t1", status: "REFUNDED" } }),
    );
    const topup = await new Mobile(http(fetchImpl)).checkById("t1");
    expect(topup.status).toBe("REFUNDED");
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/mobile/check-id/t1");
  });

  it("lists and paginates past top-ups", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
      return jsonResponse({
        success: true,
        data: {
          items: [{ _id: `t${page}` }],
          pagination: { page, pageSize: 1, totalPages: 2, totalResults: 2 },
        },
      });
    }) as unknown as FetchLike;
    const mobile = new Mobile(http(fetchImpl));
    const first = await mobile.list({ pageSize: 1 });
    expect(first.hasMore).toBe(true);
    const seen: string[] = [];
    for await (const t of mobile.paginate({ pageSize: 1 })) seen.push(t._id);
    expect(seen).toEqual(["t1", "t2"]);
  });
});
