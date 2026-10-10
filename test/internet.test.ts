import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Internet } from "../src/resources/internet";
import { Secret } from "../src/secret";
import { NetworkError, ValidationError } from "../src/errors";

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

describe("Internet.send validation", () => {
  it("rejects an ADSL number sent as 4G", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ success: true, data: {} }));
    await expect(
      new Internet(http(fetchImpl)).send({
        type: "4G",
        number: "033123456",
        value: 1500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a valid ADSL recharge and fills a reference", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ success: true, data: { topupId: "i1", topupRef: "r1" } }),
    );
    await new Internet(http(fetchImpl)).send({
      type: "ADSL",
      number: "033123456",
      value: 1500,
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(sent.ref).toMatch(/^ocd-/);
  });
});

describe("Internet card codes", () => {
  it("wraps card_code in a Secret that stays out of logs", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: {
          _id: "i1",
          ref: "r1",
          status: "FULFILLED",
          type: "ADSL",
          number: "033123456",
          topup_amount: 1500,
          card_code: "1234-5678-9012",
          created_at: "2026-06-25T00:00:00.000Z",
        },
      }),
    );
    const topup = await new Internet(http(fetchImpl)).checkByRef("r1");
    expect(topup.card_code).toBeInstanceOf(Secret);
    expect(JSON.stringify(topup)).not.toContain("1234-5678-9012");
    expect(topup.card_code?.reveal()).toBe("1234-5678-9012");
  });

  it("leaves card_code undefined while the order is still handling", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: {
          _id: "i1",
          status: "HANDLING",
          type: "ADSL",
          number: "033123456",
          topup_amount: 1500,
          created_at: "2026-06-25T00:00:00.000Z",
        },
      }),
    );
    const topup = await new Internet(http(fetchImpl)).checkById("i1");
    expect(topup.card_code).toBeUndefined();
  });
});

describe("Internet.list", () => {
  it("normalizes the topups field and the meta pagination shape", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: {
          topups: [
            {
              _id: "i1",
              status: "FULFILLED",
              type: "4G",
              number: "213778037340",
              topup_amount: 1000,
              card_code: "AAAA-BBBB",
              created_at: "2026-06-25T00:00:00.000Z",
            },
          ],
        },
        meta: {
          pagination: {
            currentPage: 1,
            totalPages: 3,
            totalItems: 7,
            hasNextPage: true,
          },
        },
      }),
    );
    const page = await new Internet(http(fetchImpl)).list();
    expect(page.page).toBe(1);
    expect(page.totalPages).toBe(3);
    expect(page.totalResults).toBe(7);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]?.card_code).toBeInstanceOf(Secret);
  });
});

describe("Internet order context and lookups", () => {
  const input = { type: "ADSL" as const, number: "036123456", value: 1000 };

  it("puts the generated ref on a send that never got an answer", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("socket hang up");
    });
    const error = await new Internet(http(fetchImpl)).send(input).catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.ref).toMatch(/^ocd-/);
  });

  it("sends, polls by id, and tags a mid-poll failure", async () => {
    let checks = 0;
    const fetchImpl = vi.fn<FetchLike>(async (url: string | URL | Request) => {
      if (String(url).endsWith("/internet/send")) {
        return jsonResponse({ success: true, data: { topupId: "i1", topupRef: "r" } });
      }
      if (checks++ === 0) {
        return jsonResponse({ success: true, data: { _id: "i1", status: "HANDLING" } });
      }
      throw new Error("socket hang up");
    });
    const error = await new Internet(http(fetchImpl))
      .sendAndWait({ ...input, ref: "mine" }, { intervalMs: 0 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.ref).toBe("mine");
    expect(error.orderId).toBe("i1");
  });

  it("resolves sendAndWait with the settled order", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url: string | URL | Request) => {
      if (String(url).endsWith("/internet/send")) {
        return jsonResponse({ success: true, data: { topupId: "i1", topupRef: "r" } });
      }
      return jsonResponse({
        success: true,
        data: { _id: "i1", status: "FULFILLED", card_code: "1234" },
      });
    });
    const topup = await new Internet(http(fetchImpl)).sendAndWait(input, {
      intervalMs: 0,
    });
    expect(topup.status).toBe("FULFILLED");
    expect(topup.card_code?.reveal()).toBe("1234");
  });

  it("reads products and checks a number", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url: string | URL | Request) => {
      if (String(url).includes("/internet/products")) {
        return jsonResponse({
          success: true,
          data: { type: "ADSL", products: [{ cost: 980, value: 1000, available: true }] },
        });
      }
      return jsonResponse({ success: true, data: { ncli: "12***", type: "ADSL" } });
    });
    const internet = new Internet(http(fetchImpl));
    const products = await internet.products("ADSL");
    expect(products.products[0]?.value).toBe(1000);
    const check = await internet.checkNumber("ADSL", "036123456");
    expect(check.ncli).toBe("12***");
    const calls = fetchImpl.mock.calls;
    expect(String(calls[0]![0])).toContain("/internet/products?type=ADSL");
    expect(String(calls[1]![0])).toContain(
      "/internet/check-number?type=ADSL&number=036123456",
    );
  });

  it("paginates past recharges", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get("page") ?? "1");
      return jsonResponse({
        success: true,
        data: { topups: [{ _id: `i${page}`, status: "FULFILLED" }] },
        meta: { pagination: { currentPage: page, totalPages: 2, totalItems: 2 } },
      });
    });
    const seen: string[] = [];
    for await (const t of new Internet(http(fetchImpl)).paginate()) seen.push(t._id);
    expect(seen).toEqual(["i1", "i2"]);
  });
});
