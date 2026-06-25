import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Internet } from "../src/resources/internet";
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

describe("Internet.send validation", () => {
  it("rejects an ADSL number sent as 4G", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
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
    const fetchImpl = vi.fn(async () =>
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
    const fetchImpl = vi.fn(async () =>
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
    const fetchImpl = vi.fn(async () =>
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
    const fetchImpl = vi.fn(async () =>
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
