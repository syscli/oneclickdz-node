import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { GiftCards } from "../src/resources/giftcards";
import { Secret } from "../src/secret";
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

describe("GiftCards.catalog", () => {
  it("keeps the top-level totals alongside the categories", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        totalCategories: 2,
        totalProducts: 5,
        data: {
          categories: [
            { title: "Gaming", products: [{ id: "psn", title: "PSN", enabled: true, region: "US" }] },
          ],
        },
      }),
    );
    const catalog = await new GiftCards(http(fetchImpl)).catalog();
    expect(catalog.totalCategories).toBe(2);
    expect(catalog.totalProducts).toBe(5);
    expect(catalog.categories[0]?.products[0]?.id).toBe("psn");
  });
});

describe("GiftCards.placeOrder", () => {
  it("rejects a quantity below one before sending", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await expect(
      new GiftCards(http(fetchImpl)).placeOrder({
        productId: "psn",
        typeId: "t500",
        quantity: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the order id on a valid order", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { orderId: "o1" } }),
    );
    const result = await new GiftCards(http(fetchImpl)).placeOrder({
      productId: "psn",
      typeId: "t500",
      quantity: 1,
    });
    expect(result.orderId).toBe("o1");
  });
});

describe("GiftCards.checkOrder", () => {
  it("wraps every card code and serial in a Secret", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          _id: "o1",
          status: "FULFILLED",
          quantity: 1,
          fulfilled_quantity: 1,
          fulfilled_amount: 500,
          price_per_card: 480,
          cards: [{ value: "CODE-XYZ", serial: "SER-123" }],
          product: "PSN",
          type: "PSN 500 DA",
          time: "2026-06-25T00:00:00.000Z",
        },
      }),
    );
    const order = await new GiftCards(http(fetchImpl)).checkOrder("o1");
    expect(order.cards[0]?.value).toBeInstanceOf(Secret);
    expect(order.cards[0]?.serial).toBeInstanceOf(Secret);
    expect(JSON.stringify(order)).not.toContain("CODE-XYZ");
    expect(order.cards[0]?.value.reveal()).toBe("CODE-XYZ");
  });
});

describe("GiftCards.placeOrderAndWait", () => {
  it("places the order then polls the order id until terminal", async () => {
    const statuses = ["HANDLING", "PARTIALLY_FILLED"];
    let check = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/gift-cards/placeOrder")) {
        return jsonResponse({ success: true, data: { orderId: "o1" } });
      }
      return jsonResponse({
        success: true,
        data: {
          _id: "o1",
          status: statuses[check++]!,
          quantity: 2,
          fulfilled_quantity: 1,
          fulfilled_amount: 500,
          price_per_card: 480,
          cards: [{ value: "CODE-XYZ", serial: "SER-123" }],
          product: "PSN",
          type: "PSN 500 DA",
          time: "2026-06-25T00:00:00.000Z",
        },
      });
    }) as unknown as FetchLike;

    const order = await new GiftCards(http(fetchImpl)).placeOrderAndWait(
      { productId: "psn", typeId: "t500", quantity: 2 },
      { intervalMs: 0 },
    );
    expect(order.status).toBe("PARTIALLY_FILLED");
    expect(String(fetchImpl.mock.calls[1]![0])).toContain(
      "/gift-cards/checkOrder/o1",
    );
  });
});
