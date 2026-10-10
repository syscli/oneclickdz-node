import { describe, it, expect, vi } from "vitest";
import {
  HttpClient,
  encodeQuery,
  buildHeaders,
  parseRetryAfter,
  MAX_RETRY_AFTER_MS,
  type HttpClientConfig,
  type FetchLike,
} from "../src/http";
import {
  RateLimitError,
  ServiceError,
  NetworkError,
  ValidationError,
} from "../src/errors";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function client(fetchImpl: FetchLike, over: Partial<HttpClientConfig> = {}) {
  return new HttpClient({
    key: "test-key",
    baseUrl: "https://api.oneclickdz.com/v3",
    fetch: fetchImpl,
    timeoutMs: 1000,
    retry: { attempts: 3, respectRetryAfter: true },
    ...over,
  });
}

describe("encodeQuery", () => {
  it("drops null and undefined, stringifies booleans", () => {
    expect(encodeQuery({ type: "ADSL", page: 2, n: undefined, x: null })).toBe(
      "?type=ADSL&page=2",
    );
    expect(encodeQuery({ live: true })).toBe("?live=true");
    expect(encodeQuery({})).toBe("");
    expect(encodeQuery(undefined)).toBe("");
  });

  it("encodes reserved characters", () => {
    expect(encodeQuery({ number: "213 700" })).toBe("?number=213%20700");
  });
});

describe("buildHeaders", () => {
  it("sends the access token and adds content-type only with a body", () => {
    const config = {
      key: "abc",
      baseUrl: "x",
      fetch: globalThis.fetch,
      timeoutMs: 0,
      retry: { attempts: 1, respectRetryAfter: true },
    };
    expect(buildHeaders(config, false)).toEqual({
      "X-Access-Token": "abc",
      Accept: "application/json",
    });
    expect(buildHeaders(config, true)["Content-Type"]).toBe("application/json");
  });
});

describe("parseRetryAfter", () => {
  it("reads a seconds delta", () => {
    expect(parseRetryAfter("30")).toBe(30);
  });
  it("reads an HTTP date as a delta from now", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const seconds = parseRetryAfter(future);
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(6);
  });
  it("returns undefined for junk or null", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("HttpClient.request", () => {
  it("builds the URL with the v3 prefix and unwraps the envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { balance: 1326.13 } }),
    );
    const env = await client(fetchImpl).request<{ balance: number }>(
      "GET",
      "account/balance",
    );
    expect(env.data.balance).toBe(1326.13);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.oneclickdz.com/v3/account/balance");
    expect((init?.headers as Record<string, string>)["X-Access-Token"]).toBe(
      "test-key",
    );
  });

  it("keeps the v3 prefix even without a trailing slash on the base", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: 1 }));
    await client(fetchImpl, { baseUrl: "https://api.oneclickdz.com/v3" }).request(
      "GET",
      "ping",
    );
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.oneclickdz.com/v3/ping");
  });

  it("serializes a JSON body for POST", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { topupId: "t1", topupRef: "r1" } }),
    );
    await client(fetchImpl).request("POST", "mobile/send", {
      body: { plan_code: "PREPAID_DJEZZY", MSSIDN: "0778037340", amount: 500 },
    });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).amount).toBe(500);
  });

  it("throws a typed error from a failed envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { success: false, error: { code: "ERR_PHONE", message: "bad" } },
        { status: 400 },
      ),
    );
    await expect(client(fetchImpl).request("GET", "x")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("treats a 200 with success:false as the error it is", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: "ERR_STOCK", message: "no" } }),
    );
    await expect(client(fetchImpl).request("GET", "x")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("retries a 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse(
          { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "slow" } },
          { status: 429, headers: { "retry-after": "0" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "ok" }));

    const env = await client(fetchImpl).request<string>("GET", "ping");
    expect(env.data).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx for GET but not for POST", async () => {
    const fail = () =>
      jsonResponse(
        { success: false, error: { code: "INTERNAL_ERROR", message: "down" } },
        { status: 500 },
      );

    const getFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "ok" }));
    const env = await client(getFetch).request<string>("GET", "ping");
    expect(env.data).toBe("ok");
    expect(getFetch).toHaveBeenCalledTimes(2);

    const postFetch = vi.fn<FetchLike>().mockResolvedValue(fail());
    await expect(
      client(postFetch).request("POST", "mobile/send", { body: {} }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(postFetch).toHaveBeenCalledTimes(1);
  });

  it("wraps a transport failure as NetworkError and retries it only for GET", async () => {
    const boom = vi.fn<FetchLike>().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      client(boom).request("POST", "mobile/send", { body: {} }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(boom).toHaveBeenCalledTimes(1);
  });

  it("does not retry when attempts is 1", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "slow" } },
        { status: 429, headers: { "retry-after": "0" } },
      ),
    );
    await expect(
      client(fetchImpl, { retry: { attempts: 1, respectRetryAfter: true } }).request(
        "GET",
        "ping",
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  const limited = () =>
    jsonResponse(
      { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "slow" } },
      { status: 429, headers: { "retry-after": "0" } },
    );

  it("does not retry a POST on 429 by default", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(limited());
    await expect(
      client(fetchImpl).request("POST", "mobile/send", { body: {} }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a POST on 429 when opted in", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "ok" }));
    const env = await client(fetchImpl, {
      retry: { attempts: 3, respectRetryAfter: true, retryPostOn429: true },
    }).request<string>("POST", "mobile/send", { body: {} });
    expect(env.data).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps a long Retry-After at sixty seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(
          jsonResponse(
            { success: false, error: { code: "RATE_LIMIT_EXCEEDED" } },
            { status: 429, headers: { "retry-after": "3600" } },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ success: true, data: "ok" }));
      const pending = client(fetchImpl).request<string>("GET", "ping");
      await vi.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS);
      expect((await pending).data).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting between retries when the caller aborts", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "RATE_LIMIT_EXCEEDED" } },
        { status: 429, headers: { "retry-after": "30" } },
      ),
    );
    const controller = new AbortController();
    const pending = client(fetchImpl).request("GET", "ping", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("stop")), 10);
    await expect(pending).rejects.toThrow("stop");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out a body that never finishes", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () =>
            new Promise<string>((_, reject) =>
              init!.signal!.addEventListener("abort", () =>
                reject(new Error("aborted")),
              ),
            ),
        }) as unknown as Response,
    );
    await expect(
      client(fetchImpl as unknown as FetchLike, {
        timeoutMs: 20,
        retry: { attempts: 1, respectRetryAfter: true },
      }).request("GET", "ping"),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("removes its listener from the caller's signal", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ success: true, data: "ok" }));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await client(fetchImpl).request("GET", "ping", { signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
