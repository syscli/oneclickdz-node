import { describe, it, expect, vi } from "vitest";
import { OneClickDZ } from "../src/client";
import type { FetchLike } from "../src/http";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OneClickDZ", () => {
  it("refuses to construct without a key", () => {
    expect(() => new OneClickDZ({ key: "" })).toThrow(/access token/);
  });

  it("falls back to the global fetch when none is passed", () => {
    expect(
      () => new OneClickDZ({ key: "k", fetch: undefined as unknown as FetchLike }),
    ).not.toThrow();
  });

  it("exposes every resource", () => {
    const client = new OneClickDZ({ key: "k", fetch: globalThis.fetch });
    expect(client.core).toBeDefined();
    expect(client.account).toBeDefined();
    expect(client.mobile).toBeDefined();
    expect(client.internet).toBeDefined();
    expect(client.giftCards).toBeDefined();
    expect(client.payments).toBeDefined();
  });

  it("sends the access token and hits the v3 base on a real call", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ success: true, data: { balance: 1000 } }),
    );
    const client = new OneClickDZ({ key: "secret-key", fetch: fetchImpl });
    const balance = await client.account.balance();
    expect(balance.balance).toBe(1000);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.oneclickdz.com/v3/account/balance");
    expect((init?.headers as Record<string, string>)["X-Access-Token"]).toBe(
      "secret-key",
    );
  });

  it("offers ping and validate shortcuts", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ success: true, data: { api: "ok", operators: {} } }),
    );
    const client = new OneClickDZ({ key: "k", fetch: fetchImpl });
    const health = await client.ping();
    expect(health.api).toBe("ok");
  });
});
