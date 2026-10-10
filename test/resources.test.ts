import { describe, it, expect, vi } from "vitest";
import { HttpClient, type FetchLike, type HttpClientConfig } from "../src/http";
import { Core } from "../src/resources/core";
import { Account } from "../src/resources/account";

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

describe("Core", () => {
  it("reads the service health from ping", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: { api: "ok", operators: { djezzy: "up", mobilis: "up" } },
      }),
    );
    const health = await new Core(http(fetchImpl)).ping();
    expect(health.api).toBe("ok");
    expect(health.operators.djezzy).toBe("up");
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://api.oneclickdz.com/v3/ping",
    );
  });

  it("reads the key environment from validate", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: {
          username: "boutique-batna",
          apiKey: {
            key: "sk_sandbox_abc",
            isEnabled: true,
            type: "SANDBOX",
            allowedips: [],
            scope: "READ-WRITE",
          },
        },
      }),
    );
    const result = await new Core(http(fetchImpl)).validate();
    expect(result.username).toBe("boutique-batna");
    expect(result.apiKey.type).toBe("SANDBOX");
    expect(result.apiKey.scope).toBe("READ-WRITE");
    expect(result.apiKey.key.reveal()).toBe("sk_sandbox_abc");
    expect(JSON.stringify(result)).not.toContain("sk_sandbox_abc");
  });
});

describe("Account", () => {
  it("reads the balance", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ success: true, data: { balance: 1326.13 } }),
    );
    const balance = await new Account(http(fetchImpl)).balance();
    expect(balance.balance).toBe(1326.13);
  });

  it("returns a transaction page with the right paging flags", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        success: true,
        data: {
          items: [{ _id: "t1", amount: 500 }],
          pagination: { page: 1, pageSize: 20, totalPages: 2, totalResults: 21 },
        },
      }),
    );
    const page = await new Account(http(fetchImpl)).transactions();
    expect(page.items).toHaveLength(1);
    expect(page.page).toBe(1);
    expect(page.totalResults).toBe(21);
    expect(page.hasMore).toBe(true);
  });

  it("walks every page through the async iterator", async () => {
    const pages: Record<string, unknown> = {
      "1": {
        success: true,
        data: {
          items: [{ _id: "t1" }, { _id: "t2" }],
          pagination: { page: 1, pageSize: 2, totalPages: 2, totalResults: 3 },
        },
      },
      "2": {
        success: true,
        data: {
          items: [{ _id: "t3" }],
          pagination: { page: 2, pageSize: 2, totalPages: 2, totalResults: 3 },
        },
      },
    };
    const fetchImpl = vi.fn<FetchLike>(async (url: string | URL | Request) => {
      const page = new URL(String(url)).searchParams.get("page") ?? "1";
      return jsonResponse(pages[page]);
    });

    const seen: string[] = [];
    for await (const tx of new Account(http(fetchImpl)).paginateTransactions()) {
      seen.push((tx as { _id: string })._id);
    }
    expect(seen).toEqual(["t1", "t2", "t3"]);
  });

  it("stops walking pages once the caller's signal aborts", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) throw new Error("aborted");
        return jsonResponse({
          success: true,
          data: {
            items: [{ _id: "t1" }],
            pagination: { page: 1, pageSize: 1, totalPages: 5, totalResults: 5 },
          },
        });
      },
    ) as unknown as FetchLike;

    const controller = new AbortController();
    const walk = new Account(http(fetchImpl)).paginateTransactions(
      {},
      controller.signal,
    );
    await walk.next();
    controller.abort();
    await expect(walk.next()).rejects.toThrow("aborted");
  });
});
